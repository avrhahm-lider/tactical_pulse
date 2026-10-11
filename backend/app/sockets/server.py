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
    except Exception:
        return False

    try:
        async with async_session_maker() as session:
            stmt = select(User).where(User.id == user_id)
            res = await session.execute(stmt)
            user = res.scalar_one_or_none()

            if not user or user.status != "active":
                return False

            # Load initial coordinates if field unit
            map_stmt = select(MapEntity).where(MapEntity.id == user_id)
            map_res = await session.execute(map_stmt)
            map_ent = map_res.scalar_one_or_none()

            client_info = {
                "user_id": user.id,
                "username": user.username,
                "role": user.role,
                "area": user.area,
                "lat": None,
                "lon": None,
            }
            _connected_clients[sid] = client_info
            try:
                await sio.save_session(sid, client_info)
            except Exception:
                pass

        # Automatically join role & zone rooms
        await sio.enter_room(sid, f"role_{user.role}")
        if user.area:
            await sio.enter_room(sid, f"zone_{user.area}")
        return True
    except Exception as e:
        print(f"[CONNECT EXCEPTION] {type(e).__name__}: {e}")
        return False


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
    origin_point = ST_SetSRID(ST_MakePoint(origin_lon, origin_lat), 4326)

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
                # Check 20 km distance
                async with async_session_maker() as session:
                    stmt = select(
                        ST_DWithin(
                            cast(origin_point, Geography),
                            cast(ST_SetSRID(ST_MakePoint(client_lon, client_lat), 4326), Geography),
                            settings.VISIBILITY_RADIUS_METERS,
                        )
                    )
                    res = await session.execute(stmt)
                    if res.scalar():
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
