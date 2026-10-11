import asyncio
import socketio
from datetime import datetime, timezone
from uuid import UUID
from typing import Dict, Any, Optional
from sqlalchemy import select, and_, cast
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID, ST_X, ST_Y
from geoalchemy2.elements import WKTElement

from app.core.config import settings
from app.core.security import decode_token
from app.db.postgres import async_session_maker
from app.models.user import User
from app.models.map_entity import MapEntity
from app.models.threat import Threat

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.CORS_ORIGINS,
    logger=False,
    engineio_logger=False,
)

# Active connected client sessions: sid -> dict
# {"user_id": UUID, "username": str, "role": str, "area": str, "lat": float, "lon": float}
_connected_clients: Dict[str, Dict[str, Any]] = {}

# Active threats cache in memory for instantaneous danger zone checks without database queries
_active_threats_cache: Dict[str, dict] = {}
_active_danger_breaches: set = set()



def calculate_area_from_lat(lat: float) -> str:
    if lat >= settings.LAT_NORTH_MIN:
        return "North"
    elif lat >= settings.LAT_CENTER_MIN:
        return "Center"
    else:
        return "South"


@sio.event
async def connect(sid: str, environ: dict, auth: Optional[dict] = None):
    if not auth or "token" not in auth:
        return False

    raw_token = auth["token"]
    if raw_token.startswith("Bearer "):
        token = raw_token[7:]
    else:
        token = raw_token

    try:
        payload = decode_token(token)
        user_id_str = payload.get("sub")
        if not user_id_str or payload.get("type") != "access":
            return False
        user_id = UUID(user_id_str)
        role = payload.get("role", "Squad")
        area = payload.get("area", "Center")
    except Exception as e:
        print(f"[AUTH EXCEPTION] Invalid JWT handshake: {e}")
        return False

    client_info = {
        "user_id": user_id,
        "username": payload.get("name") or payload.get("username") or str(user_id),
        "role": role,
        "area": area,
        "lat": None,
        "lon": None,
    }
    _connected_clients[sid] = client_info

    try:
        await sio.save_session(sid, client_info)
    except Exception:
        pass

    # Automatically join role & zone rooms after handshake completes
    async def _join_rooms():
        await asyncio.sleep(0.05)
        try:
            await sio.enter_room(sid, f"role_{role}")
            if area:
                await sio.enter_room(sid, f"zone_{area}")
        except Exception:
            pass

    asyncio.create_task(_join_rooms())
    return True


@sio.event
async def disconnect(sid: str):
    client = _connected_clients.pop(sid, None)
    if client:
        sq_id = str(client.get("user_id"))
        prefix = f"{sq_id}_"
        for k in list(_active_danger_breaches):
            if k.startswith(prefix):
                _active_danger_breaches.discard(k)


@sio.event
async def heartbeat(sid: str, data: dict):
    client = _connected_clients.get(sid)
    if not client:
        return

    async with async_session_maker() as session:
        stmt = select(MapEntity).where(MapEntity.id == client["user_id"])
        res = await session.execute(stmt)
        map_ent = res.scalar_one_or_none()
        if map_ent:
            map_ent.updated_at = datetime.now(timezone.utc)
            await session.commit()


@sio.event
async def location_update(sid: str, data: dict):
    client = _connected_clients.get(sid)
    if not client:
        return

    # Only field units can emit location updates
    if client["role"] not in ["Squad", "SapperSquad", "Radar"]:
        return

    lat = data.get("lat")
    lon = data.get("lon")
    heading = data.get("heading", 0.0)

    if lat is None or lon is None:
        return

    # Validate theater bounds
    if not (settings.LAT_MIN <= lat <= settings.LAT_MAX and settings.LON_MIN <= lon <= settings.LON_MAX):
        return

    client["lat"] = lat
    client["lon"] = lon

    new_area = calculate_area_from_lat(lat)
    now = datetime.now(timezone.utc)

    # 1. Update in-memory unit state immediately
    client["lat"] = lat
    client["lon"] = lon
    old_area = client.get("area")
    client["area"] = new_area

    # 2. Broadcast squad_moved payload with zero DB latency
    squad_moved_payload = {
        "id": str(client["user_id"]),
        "lat": lat,
        "lon": lon,
        "heading": heading,
        "area": new_area,
        "updated_at": now.isoformat(),
    }
    await broadcast_to_visibility_range(
        origin_lat=lat,
        origin_lon=lon,
        origin_area=new_area,
        event_name="squad_moved",
        payload=squad_moved_payload,
    )

    # 3. Immediately evaluate danger zone perimeter breach
    await check_and_broadcast_danger_alerts(squad_sid=sid, squad_info=client)

    # 4. Handle zone room migration if border crossed
    if old_area and old_area != new_area:
        try:
            await sio.leave_room(sid, f"zone_{old_area}")
            await sio.enter_room(sid, f"zone_{new_area}")
        except Exception:
            pass

    # 5. Persist to Postgres safely without blocking real-time WebSocket telemetry
    try:
        async with async_session_maker() as session:
            map_stmt = select(MapEntity).where(MapEntity.id == client["user_id"])
            map_res = await session.execute(map_stmt)
            map_ent = map_res.scalar_one_or_none()

            if map_ent:
                map_ent.geom = WKTElement(f"POINT({lon} {lat})", srid=4326)
                map_ent.heading = heading
                map_ent.updated_at = now
            else:
                map_ent = MapEntity(
                    id=client["user_id"],
                    geom=WKTElement(f"POINT({lon} {lat})", srid=4326),
                    heading=heading,
                    status="active",
                    updated_at=now,
                )
                session.add(map_ent)

            if old_area and old_area != new_area:
                user_stmt = select(User).where(User.id == client["user_id"])
                user_res = await session.execute(user_stmt)
                user_obj = user_res.scalar_one_or_none()
                if user_obj:
                    user_obj.area = new_area

            # Preload _active_threats_cache if empty
            if not _active_threats_cache:
                threats_q = await session.execute(
                    select(Threat, ST_Y(Threat.geom), ST_X(Threat.geom)).where(Threat.status == "active")
                )
                for t, t_lat, t_lon in threats_q.all():
                    _active_threats_cache[str(t.id)] = {
                        "id": str(t.id),
                        "name": t.name,
                        "threat_type": t.threat_type,
                        "severity_level": t.severity_level,
                        "engagement_status": t.engagement_status,
                        "radius": t.radius,
                        "lat": t_lat,
                        "lon": t_lon,
                        "altitude": t.altitude,
                        "status": t.status,
                    }

            await session.commit()
    except Exception:
        # Prevent database session spikes from interrupting real-time location stream
        pass


import math


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


async def check_and_broadcast_danger_alerts(
    squad_sid: Optional[str] = None,
    squad_info: Optional[dict] = None,
    threat_dict: Optional[dict] = None,
):
    """
    Checks if a field squad enters a threat's danger radius (dist <= radius)
    and broadcasts 'danger_zone_alert' ONLY to the affected squad on entry.
    Clears the breach and notifies when the squad exits the danger zone.
    """
    if squad_info and squad_info.get("lat") is not None and squad_info.get("lon") is not None:
        sq_lat = squad_info["lat"]
        sq_lon = squad_info["lon"]
        sq_id = str(squad_info.get("user_id"))
        sq_name = squad_info.get("username", "Squad")

        for t in list(_active_threats_cache.values()):
            if t.get("status") == "inactive" or t.get("engagement_status") == "resolved":
                continue
            t_lat = t.get("lat")
            t_lon = t.get("lon")
            if t_lat is None or t_lon is None:
                continue

            radius = float(t.get("radius") or 150.0)
            t_id = str(t.get("id"))
            breach_key = f"{sq_id}_{t_id}"
            dist = haversine_distance_meters(sq_lat, sq_lon, t_lat, t_lon)

            if dist <= radius:
                # Trigger alert ONCE upon intrusion into the danger zone
                if breach_key not in _active_danger_breaches:
                    _active_danger_breaches.add(breach_key)
                    alert_payload = {
                        "id": breach_key,
                        "threat_id": t_id,
                        "threat_name": t.get("name"),
                        "threat_type": t.get("threat_type"),
                        "severity_level": t.get("severity_level"),
                        "squad_id": sq_id,
                        "squad_name": sq_name,
                        "distance_meters": round(dist, 1),
                        "danger_radius_meters": radius,
                        "message": f"CRITICAL: {sq_name} is INSIDE danger perimeter of {t.get('name')} ({round(dist, 1)}m <= {radius}m)!",
                    }
                    if squad_sid:
                        await sio.emit("danger_zone_alert", alert_payload, room=squad_sid)
            else:
                # Squad has exited the danger zone -> clear breach state
                if breach_key in _active_danger_breaches:
                    _active_danger_breaches.remove(breach_key)
                    if squad_sid:
                        await sio.emit("danger_zone_cleared", {"id": breach_key, "squad_id": sq_id, "threat_id": t_id}, room=squad_sid)

    elif threat_dict and threat_dict.get("lat") is not None and threat_dict.get("lon") is not None:
        if threat_dict.get("status") != "inactive" and threat_dict.get("engagement_status") != "resolved":
            t_lat = threat_dict["lat"]
            t_lon = threat_dict["lon"]
            radius = float(threat_dict.get("radius") or 150.0)
            t_id = str(threat_dict.get("id"))
            t_name = threat_dict.get("name")

            for c_sid, c_info in list(_connected_clients.items()):
                if c_info.get("role") in ["Squad", "SapperSquad"]:
                    sq_lat = c_info.get("lat")
                    sq_lon = c_info.get("lon")
                    if sq_lat is not None and sq_lon is not None:
                        sq_id = str(c_info.get("user_id"))
                        sq_name = c_info.get("username", "Squad")
                        breach_key = f"{sq_id}_{t_id}"
                        dist = haversine_distance_meters(sq_lat, sq_lon, t_lat, t_lon)

                        if dist <= radius:
                            if breach_key not in _active_danger_breaches:
                                _active_danger_breaches.add(breach_key)
                                alert_payload = {
                                    "id": breach_key,
                                    "threat_id": t_id,
                                    "threat_name": t_name,
                                    "threat_type": threat_dict.get("threat_type"),
                                    "severity_level": threat_dict.get("severity_level"),
                                    "squad_id": sq_id,
                                    "squad_name": sq_name,
                                    "distance_meters": round(dist, 1),
                                    "danger_radius_meters": radius,
                                    "message": f"CRITICAL: {sq_name} is INSIDE danger perimeter of {t_name} ({round(dist, 1)}m <= {radius}m)!",
                                }
                                await sio.emit("danger_zone_alert", alert_payload, room=c_sid)
                        else:
                            if breach_key in _active_danger_breaches:
                                _active_danger_breaches.remove(breach_key)
                                await sio.emit("danger_zone_cleared", {"id": breach_key, "squad_id": sq_id, "threat_id": t_id}, room=c_sid)


async def broadcast_to_visibility_range(
    origin_lat: float,
    origin_lon: float,
    origin_area: str,
    event_name: str,
    payload: dict,
):
    """
    Broadcasts event according to Tactical Pulse visibility rules:
    - MainCommandCenter receives everything globally
    - AreaCommandCenter receives if event is in its assigned zone
    - Field units receive if within 20 km radius
    """
    for client_sid, info in list(_connected_clients.items()):
        role = info.get("role")
        area = info.get("area")

        if role == "MainCommandCenter":
            await sio.emit(event_name, payload, room=client_sid)
        elif role == "AreaCommandCenter" and area == origin_area:
            await sio.emit(event_name, payload, room=client_sid)
        elif role in ["Squad", "SapperSquad", "Radar"]:
            client_lat = info.get("lat")
            client_lon = info.get("lon")
            if client_lat is not None and client_lon is not None:
                dist = haversine_distance_meters(origin_lat, origin_lon, client_lat, client_lon)
                if dist <= settings.VISIBILITY_RADIUS_METERS:
                    await sio.emit(event_name, payload, room=client_sid)


async def broadcast_threat_event(event_name: str, threat_dict: dict):
    t_id = str(threat_dict.get("id"))
    if threat_dict.get("status") == "inactive":
        _active_threats_cache.pop(t_id, None)
    else:
        _active_threats_cache[t_id] = threat_dict

    lat = threat_dict.get("lat")
    lon = threat_dict.get("lon")
    if lat is not None and lon is not None:
        area = calculate_area_from_lat(lat)
        await broadcast_to_visibility_range(
            origin_lat=lat,
            origin_lon=lon,
            origin_area=area,
            event_name=event_name,
            payload=threat_dict,
        )
        await check_and_broadcast_danger_alerts(threat_dict=threat_dict)


async def broadcast_unit_status_changed(unit_id: str, status: str):
    await sio.emit("unit_status_changed", {"id": str(unit_id), "status": status})

