from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, cast
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_DWithin, ST_Y, ST_X, ST_MakePoint, ST_SetSRID

from app.models.user import User
from app.models.map_entity import MapEntity
from app.models.threat import Threat
from app.core.config import settings


async def get_caller_coordinates(session: AsyncSession, user_id: UUID) -> Optional[Tuple[float, float]]:
    """Returns (lat, lon) for caller's MapEntity if caller is a tactical field unit."""
    stmt = select(ST_Y(MapEntity.geom).label("lat"), ST_X(MapEntity.geom).label("lon")).where(
        and_(MapEntity.id == user_id, MapEntity.status == "active")
    )
    result = await session.execute(stmt)
    row = result.first()
    if row:
        return (row.lat, row.lon)
    return None


def get_zone_clause_for_geom(geom_column, area: str):
    """Generates latitude boundary condition for a given geometry column."""
    lat_expr = ST_Y(geom_column)
    if area == "North":
        return lat_expr >= settings.LAT_NORTH_MIN
    elif area == "Center":
        return and_(lat_expr >= settings.LAT_CENTER_MIN, lat_expr < settings.LAT_NORTH_MIN)
    elif area == "South":
        return and_(lat_expr >= settings.LAT_MIN, lat_expr < settings.LAT_CENTER_MIN)
    return None


async def get_visible_squads_query(caller: User, caller_coords: Optional[Tuple[float, float]]):
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
                User.role.in_(["Squad", "SapperSquad", "Radar"]),
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


async def get_visible_threats_query(caller: User, caller_coords: Optional[Tuple[float, float]]):
    """
    Builds SQL query for active threats visible to caller:
    - MainCommandCenter: all active threats
    - AreaCommandCenter: active threats in its assigned zone
    - Field units: active threats within 20 km
    """
    stmt = select(
        Threat,
        ST_Y(Threat.geom).label("lat"),
        ST_X(Threat.geom).label("lon"),
    ).where(Threat.status == "active")

    if caller.role == "MainCommandCenter":
        return stmt

    if caller.role == "AreaCommandCenter":
        zone_clause = get_zone_clause_for_geom(Threat.geom, caller.area)
        if zone_clause is not None:
            stmt = stmt.where(zone_clause)
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
