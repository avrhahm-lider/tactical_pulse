import asyncio
import socketio
from datetime import datetime, timezone
from uuid import UUID
from typing import Dict, Any, Optional
from sqlalchemy import select, and_, cast
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID
from geoalchemy2.elements import WKTElement

from app.core.config import settings
from app.core.security import decode_token
from app.db.postgres import async_session_maker
from app.models.user import User
from app.models.map_entity import MapEntity

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.CORS_ORIGINS,
    logger=False,
    engineio_logger=False,
)

# Active connected client sessions: sid -> dict
# {"user_id": UUID, "username": str, "role": str, "area": str, "lat": float, "lon": float}
_connected_clients: Dict[str, Dict[str, Any]] = {}


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
        "username": payload.get("username", str(user_id)),
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
    _connected_clients.pop(sid, None)


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

    new_area = calculate_area_from_lat(lat)
    now = datetime.now(timezone.utc)

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

        # Update user area if crossed border
        user_stmt = select(User).where(User.id == client["user_id"])
        user_res = await session.execute(user_stmt)
        user_obj = user_res.scalar_one_or_none()
        if user_obj and user_obj.area != new_area:
            user_obj.area = new_area
            # Update socket room membership
            await sio.leave_room(sid, f"zone_{client['area']}")
            await sio.enter_room(sid, f"zone_{new_area}")
            client["area"] = new_area

        client["lat"] = lat
        client["lon"] = lon

        await session.commit()

    # Broadcast squad_moved payload
    squad_moved_payload = {
        "id": str(client["user_id"]),
        "lat": lat,
        "lon": lon,
        "heading": heading,
        "area": new_area,
        "updated_at": now.isoformat(),
    }

    # Dispatch to authorized clients
    await broadcast_to_visibility_range(
        origin_lat=lat,
        origin_lon=lon,
        origin_area=new_area,
        event_name="squad_moved",
        payload=squad_moved_payload,
    )


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


async def broadcast_unit_status_changed(unit_id: str, status: str):
    # Status deactivation is broadcast to all active clients so the marker is immediately removed
    await sio.emit("unit_status_changed", {"id": str(unit_id), "status": status})
