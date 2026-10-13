import math
from datetime import datetime
from uuid import UUID

from geoalchemy2 import Geography
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y, ST_DWithin, ST_MakePoint, ST_SetSRID
from sqlalchemy import and_, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.postgres import async_session_maker
from app.models.map_entity import MapEntity
from app.models.threat import Threat
from app.models.user import User


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two GPS coordinates in meters."""
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    return r * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


async def persist_squad_location(
    squad_id: UUID,
    lat: float,
    lon: float,
    heading: float,
    area: str,
    updated_at: datetime,
) -> None:
    """Safely updates squad MapEntity and sector in PostgreSQL."""
    async with async_session_maker() as session:
        map_ent = (await session.execute(
            select(MapEntity).where(MapEntity.id == squad_id)
        )).scalar_one_or_none()

        if map_ent:
            map_ent.geom = WKTElement(f"POINT({lon} {lat})", srid=4326)
            map_ent.heading = heading
            map_ent.updated_at = updated_at
        else:
            session.add(
                MapEntity(
                    id=squad_id,
                    geom=WKTElement(f"POINT({lon} {lat})", srid=4326),
                    heading=heading,
                    status="active",
                    updated_at=updated_at,
                )
            )

        user_obj = (await session.execute(
            select(User).where(User.id == squad_id)
        )).scalar_one_or_none()
        if user_obj and user_obj.area != area:
            user_obj.area = area

        await session.commit()


async def get_caller_coordinates(session: AsyncSession, user_id: UUID) -> tuple[float, float] | None:
    """Returns (lat, lon) for caller's MapEntity if caller is a tactical field unit."""
    stmt = select(ST_Y(MapEntity.geom).label("lat"), ST_X(MapEntity.geom).label("lon")).where(
        and_(MapEntity.id == user_id, MapEntity.status == "active")
    )
    result = await session.execute(stmt)
    row = result.first()
    if row:
        return (row.lat, row.lon)
    return None


def calculate_area_from_lat(lat: float) -> str:
    """Returns tactical sector ('North', 'Center', or 'South') based on latitude."""
    if lat >= settings.LAT_NORTH_MIN:
        return "North"
    elif lat >= settings.LAT_CENTER_MIN:
        return "Center"
    return "South"


def is_lat_in_area(lat: float, area: str) -> bool:
    """Checks whether a given latitude falls within the specified theater sector."""
    if area == "Global":
        return True
    return calculate_area_from_lat(lat) == area


def get_zone_clause_for_geom(geom_column, area: str):
    """Generates latitude boundary condition for a given geometry column."""
    lat_expr = ST_Y(geom_column)
    if area == "North":
        return lat_expr >= settings.LAT_NORTH_MIN
    elif area == "Center":
        return and_(lat_expr >= settings.LAT_CENTER_MIN, lat_expr < settings.LAT_NORTH_MIN)
    elif area == "South":
        return lat_expr < settings.LAT_CENTER_MIN
    return None


def get_visible_squads_query(caller: User, caller_coords: tuple[float, float] | None):
    """
    Builds SQL query for active squads visible to caller:
    - MainCommandCenter: all active field units
    - AreaCommandCenter: active field units whose current position is in its assigned zone
    - Field units: active field units within 20 km of caller's position
    """
    stmt = (
        select(
            User,
            ST_Y(MapEntity.geom).label("lat"),
            ST_X(MapEntity.geom).label("lon"),
            MapEntity.heading,
            MapEntity.updated_at,
        )
        .join(MapEntity, MapEntity.id == User.id)
        .where(
            and_(
                User.status == "active",
                MapEntity.status == "active",
                User.role.in_(["Squad", "SapperSquad"]),
            )
        )
    )

    if caller.role == "MainCommandCenter":
        return stmt

    if caller.role == "AreaCommandCenter":
        zone_clause = get_zone_clause_for_geom(MapEntity.geom, caller.area)
        if zone_clause is not None:
            stmt = stmt.where(zone_clause)
        return stmt

    # Field unit: within 20 km of current position
    if caller_coords:
        caller_lat, caller_lon = caller_coords
        caller_point_geom = ST_SetSRID(ST_MakePoint(caller_lon, caller_lat), 4326)
        stmt = stmt.where(
            or_(
                User.id == caller.id,  # always see self
                ST_DWithin(
                    cast(MapEntity.geom, Geography),
                    cast(caller_point_geom, Geography),
                    settings.VISIBILITY_RADIUS_METERS,
                ),
            )
        )
    else:
        # If field unit has no coordinates yet, sees only itself
        stmt = stmt.where(User.id == caller.id)

    return stmt


def get_visible_threats_query(
    caller: User,
    caller_coords: tuple[float, float] | None,
    status_filter: str | None = "active",
    include_resolved: bool = False,
):
    """
    Builds SQL query for threats visible to caller:
    - MainCommandCenter: all visible threats
    - AreaCommandCenter: visible threats in its assigned zone
    - Field units: visible threats within 20 km (Radar tracks aerial drones globally)
    """
    stmt = select(
        Threat,
        ST_Y(Threat.geom).label("lat"),
        ST_X(Threat.geom).label("lon"),
    )
    if status_filter and status_filter != "all":
        stmt = stmt.where(Threat.status == status_filter)
        if status_filter == "active" and not include_resolved:
            stmt = stmt.where(Threat.engagement_status != "resolved")

    if caller.role == "MainCommandCenter":
        return stmt

    if caller.role == "AreaCommandCenter":
        zone_clause = get_zone_clause_for_geom(Threat.geom, caller.area)
        if zone_clause is not None:
            stmt = stmt.where(zone_clause)
        return stmt

    if caller.role == "Radar":
        # Radar monitors aerial drone tracks or threats it registered
        stmt = stmt.where(
            or_(
                Threat.threat_type == "drone",
                Threat.created_by_id == caller.id,
            )
        )
        return stmt

    # Field unit: within 20 km
    if caller_coords:
        caller_lat, caller_lon = caller_coords
        caller_point_geom = ST_SetSRID(ST_MakePoint(caller_lon, caller_lat), 4326)
        stmt = stmt.where(
            ST_DWithin(
                cast(Threat.geom, Geography),
                cast(caller_point_geom, Geography),
                settings.VISIBILITY_RADIUS_METERS,
            )
        )
    else:
        # Return empty if field unit position is undefined
        stmt = stmt.where(Threat.id.is_(None))

    return stmt
