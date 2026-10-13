import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import jwt
import socketio
from app.core.config import settings
from app.core.security import decode_token
from app.db.postgres import async_session_maker
from app.models.map_entity import MapEntity
from app.models.threat import Threat
from app.models.user import User
from app.services.spatial import (
    calculate_area_from_lat,
    haversine_distance_meters,
    persist_squad_location,
)
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import select

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)

# Active connected client sessions: sid -> dict
# {"user_id": UUID, "username": str, "role": str, "area": str, "lat": float, "lon": float}
_connected_clients: dict[str, dict[str, Any]] = {}

# Active threats cache in memory for instantaneous danger zone checks without database queries
_active_threats_cache: dict[str, dict] = {}
_active_danger_breaches: set = set()
_last_socket_db_save: dict[UUID, float] = {}
_last_heartbeat_db_save: dict[UUID, float] = {}
_background_tasks: set[asyncio.Task] = set()


def _spawn_background_task(coro):
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


async def _ensure_threats_cache_loaded(session):
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


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None):
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
    except (jwt.PyJWTError, ValueError):
        return False

    # Enforce active user status and fetch initial coordinates from DB
    try:
        async with async_session_maker() as session:
            stmt = (
                select(
                    User,
                    ST_Y(MapEntity.geom).label("lat"),
                    ST_X(MapEntity.geom).label("lon"),
                )
                .outerjoin(MapEntity, MapEntity.id == User.id)
                .where(User.id == user_id)
            )
            res = await session.execute(stmt)
            row = res.first()
            if not row:
                return False
            user_obj, initial_lat, initial_lon = row
            if user_obj.status != "active":
                return False

            role = user_obj.role
            area = user_obj.area
            user_name = user_obj.name or user_obj.username

            await _ensure_threats_cache_loaded(session)
    except Exception as e:
        print(f"[AUTH EXCEPTION] Database verification failed during socket connect: {e}")
        return False

    client_info = {
        "user_id": user_id,
        "username": user_name,
        "role": role,
        "area": area,
        "lat": initial_lat,
        "lon": initial_lon,
    }
    _connected_clients[sid] = client_info

    # Automatically join role & zone rooms after handshake completes
    async def _post_connect_setup():
        await asyncio.sleep(0.05)
        try:
            await sio.enter_room(sid, f"role_{role}")
            if area:
                await sio.enter_room(sid, f"zone_{area}")
            if initial_lat is not None and initial_lon is not None:
                await check_and_broadcast_danger_alerts(squad_sid=sid, squad_info=client_info)
        except Exception as e:
            print(f"[SOCKET WARNING] Post connect setup failed: {e}")

    _spawn_background_task(_post_connect_setup())
    return True


@sio.event
async def disconnect(sid: str):
    client = _connected_clients.pop(sid, None)
    if client:
        u_id = client.get("user_id")
        if u_id:
            _last_socket_db_save.pop(u_id, None)
            _last_heartbeat_db_save.pop(u_id, None)
        sq_id = str(u_id)
        prefix = f"{sq_id}_"
        for k in list(_active_danger_breaches):
            if k.startswith(prefix):
                _active_danger_breaches.discard(k)


@sio.event
async def heartbeat(sid: str, data: dict):
    client = _connected_clients.get(sid)
    if not client:
        return
    user_id = client.get("user_id")
    if not user_id:
        return

    now_ts = asyncio.get_event_loop().time()
    if now_ts - _last_heartbeat_db_save.get(user_id, 0.0) < 30.0:
        return
    _last_heartbeat_db_save[user_id] = now_ts

    try:
        async with async_session_maker() as session:
            stmt = select(MapEntity).where(MapEntity.id == user_id)
            res = await session.execute(stmt)
            map_ent = res.scalar_one_or_none()
            if map_ent:
                map_ent.updated_at = datetime.now(UTC)
                await session.commit()
    except Exception as e:
        print(f"[HEARTBEAT DB WARNING] Heartbeat persistence failed: {e}")


@sio.event
async def location_update(sid: str, data: dict):
    client = _connected_clients.get(sid)
    if not client:
        return

    if client["role"] not in ["Squad", "SapperSquad"]:
        return

    lat = data.get("lat")
    lon = data.get("lon")
    heading = data.get("heading", 0.0)

    if lat is None or lon is None:
        return

    # Validate theater bounds
    if not (settings.LAT_MIN <= lat <= settings.LAT_MAX and settings.LON_MIN <= lon <= settings.LON_MAX):
        return

    target_id = client["user_id"]
    new_area = calculate_area_from_lat(lat)
    now = datetime.now(UTC)

    client["lat"] = lat
    client["lon"] = lon
    old_area = client.get("area")
    client["area"] = new_area
    if old_area and old_area != new_area:
        try:
            await sio.leave_room(sid, f"zone_{old_area}")
            await sio.enter_room(sid, f"zone_{new_area}")
        except Exception as e:
            print(f"[SOCKET WARNING] Zone room switch failed: {e}")

    # Broadcast squad_moved payload with zero DB latency
    squad_moved_payload = {
        "id": str(target_id),
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

    # Immediately evaluate danger zone perimeter breach
    await check_and_broadcast_danger_alerts(squad_sid=sid, squad_info=client)

    # Persist to Postgres safely in background without blocking real-time WebSocket telemetry
    now_ts = asyncio.get_event_loop().time()
    if now_ts - _last_socket_db_save.get(target_id, 0.0) >= 3.0:
        _last_socket_db_save[target_id] = now_ts
        _spawn_background_task(persist_squad_location(target_id, lat, lon, heading, new_area, now))


async def _process_squad_threat_breach(sq_sid: str | None, sq_id: str, sq_name: str, sq_lat: float, sq_lon: float, t: dict):
    if t.get("status") == "inactive" or t.get("engagement_status") == "resolved":
        return
    t_lat, t_lon = t.get("lat"), t.get("lon")
    if t_lat is None or t_lon is None:
        return

    radius = float(t.get("radius") or 150.0)
    t_id = str(t.get("id"))
    breach_key = f"{sq_id}_{t_id}"
    dist = haversine_distance_meters(sq_lat, sq_lon, t_lat, t_lon)

    if dist <= radius:
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
            if sq_sid:
                await sio.emit("danger_zone_alert", alert_payload, room=sq_sid)
            await sio.emit("danger_zone_alert", alert_payload, room="role_MainCommandCenter")
    elif breach_key in _active_danger_breaches:
        _active_danger_breaches.remove(breach_key)
        clear_payload = {"id": breach_key, "squad_id": sq_id, "threat_id": t_id}
        if sq_sid:
            await sio.emit("danger_zone_cleared", clear_payload, room=sq_sid)
        await sio.emit("danger_zone_cleared", clear_payload, room="role_MainCommandCenter")


async def check_and_broadcast_danger_alerts(
    squad_sid: str | None = None,
    squad_info: dict | None = None,
    threat_dict: dict | None = None,
):
    """
    Checks if a field squad enters a threat's danger radius (dist <= radius)
    and broadcasts 'danger_zone_alert' ONLY to the affected squad on entry.
    Clears the breach and notifies when the squad exits the danger zone.
    """
    if squad_info and squad_info.get("lat") is not None and squad_info.get("lon") is not None:
        sq_id = str(squad_info.get("user_id"))
        sq_name = squad_info.get("username", "Squad")
        for t in list(_active_threats_cache.values()):
            await _process_squad_threat_breach(squad_sid, sq_id, sq_name, squad_info["lat"], squad_info["lon"], t)

    elif threat_dict and threat_dict.get("lat") is not None and threat_dict.get("lon") is not None:
        if threat_dict.get("status") != "inactive" and threat_dict.get("engagement_status") != "resolved":
            for c_sid, c_info in list(_connected_clients.items()):
                if c_info.get("role") in ["Squad", "SapperSquad"]:
                    sq_lat = c_info.get("lat")
                    sq_lon = c_info.get("lon")
                    if sq_lat is not None and sq_lon is not None:
                        await _process_squad_threat_breach(
                            c_sid,
                            str(c_info.get("user_id")),
                            c_info.get("username", "Squad"),
                            sq_lat,
                            sq_lon,
                            threat_dict,
                        )


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

        if role == "MainCommandCenter" or (role == "AreaCommandCenter" and area == origin_area):
            await sio.emit(event_name, payload, room=client_sid)
        elif role in ["Squad", "SapperSquad", "Radar"]:
            # Radar stations monitor aerial drones anywhere across Israeli airspace
            if role == "Radar" and payload.get("threat_type") == "drone":
                await sio.emit(event_name, payload, room=client_sid)
                continue

            client_lat = info.get("lat")
            client_lon = info.get("lon")
            if client_lat is not None and client_lon is not None:
                dist = haversine_distance_meters(origin_lat, origin_lon, client_lat, client_lon)
                if dist <= settings.VISIBILITY_RADIUS_METERS:
                    await sio.emit(event_name, payload, room=client_sid)


async def broadcast_threat_event(event_name: str, threat_dict: dict):
    t_id = str(threat_dict.get("id"))
    is_neutralized = threat_dict.get("status") == "inactive" or threat_dict.get("engagement_status") == "resolved"
    if is_neutralized:
        _active_threats_cache.pop(t_id, None)
        # Clear all active danger breaches for this neutralized threat and notify affected squads
        for k in list(_active_danger_breaches):
            if k.endswith(f"_{t_id}"):
                _active_danger_breaches.discard(k)
                sq_id = k.split("_")[0]
                clear_payload = {"id": k, "squad_id": sq_id, "threat_id": t_id}
                for c_sid, c_info in list(_connected_clients.items()):
                    if str(c_info.get("user_id")) == sq_id:
                        await sio.emit("danger_zone_cleared", clear_payload, room=c_sid)
                await sio.emit("danger_zone_cleared", clear_payload, room="role_MainCommandCenter")
        # Emit explicit threat_removed event so all clients remove the marker from maps
        try:
            await sio.emit("threat_removed", {"id": t_id})
        except Exception as e:
            print(f"[SOCKET WARNING] Threat removed broadcast failed: {e}")
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


async def disconnect_user_sockets(user_id: str):
    """Disconnects all active socket connections belonging to the specified user."""
    for sid, client in list(_connected_clients.items()):
        if str(client.get("user_id")) == str(user_id):
            try:
                await sio.disconnect(sid)
            except Exception as e:
                print(f"[SOCKET WARNING] Socket disconnect for {sid} failed: {e}")


async def broadcast_unit_status_changed(unit_id: str, status: str):
    await sio.emit("unit_status_changed", {"id": str(unit_id), "status": status})
    if status == "inactive":
        await disconnect_user_sockets(str(unit_id))

