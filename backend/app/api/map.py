from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.postgres import get_db
from app.models.user import User
from app.schemas.map import MapSnapshotResponse, SquadSnapshotItem
from app.schemas.threat import ThreatResponse
from app.services.spatial import (
    get_caller_coordinates,
    get_visible_squads_query,
    get_visible_threats_query,
)
from app.api.dependencies import get_current_user

router = APIRouter(prefix="/map", tags=["Tactical Map"])


@router.get("/snapshot", response_model=MapSnapshotResponse)
async def get_tactical_map_snapshot(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    caller_coords = await get_caller_coordinates(session, current_user.id)

    # 1. Fetch squads
    squads_stmt = get_visible_squads_query(current_user, caller_coords)
    squad_rows = (await session.execute(squads_stmt)).all()
    squads = [
        SquadSnapshotItem(
            id=u.id, name=u.name, description=u.description, role=u.role, area=u.area,
            lat=lat, lon=lon, heading=heading or 0.0, status=u.status,
            updated_at=updated_at, soldiers=u.soldiers,
        )
        for u, lat, lon, heading, updated_at in squad_rows
    ]

    # 2. Fetch active threats
    threats_stmt = get_visible_threats_query(current_user, caller_coords, status_filter="active")
    threat_rows = (await session.execute(threats_stmt)).all()
    threats = [ThreatResponse.from_threat(t, lat, lon) for t, lat, lon in threat_rows]

    return MapSnapshotResponse(squads=squads, threats=threats)

