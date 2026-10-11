from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.postgres import get_db
from app.models.user import User
from app.schemas.map import MapSnapshotResponse, SquadSnapshotItem
from app.schemas.soldier import SoldierResponse
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
    squads_stmt = await get_visible_squads_query(current_user, caller_coords)
    squads_res = await session.execute(squads_stmt)
    squad_rows = squads_res.all()

    squads_list = []
    for user_obj, lat, lon, heading, updated_at in squad_rows:
        soldiers = [
            SoldierResponse(id=s.id, name=s.name, role=s.role)
            for s in user_obj.soldiers
        ]
        squads_list.append(
            SquadSnapshotItem(
                id=user_obj.id,
                name=user_obj.name,
                description=user_obj.description,
                role=user_obj.role,
                area=user_obj.area,
                lat=lat,
                lon=lon,
                heading=heading or 0.0,
                status=user_obj.status,
                updated_at=updated_at,
                soldiers=soldiers,
            )
        )

    # 2. Fetch threats
    threats_stmt = await get_visible_threats_query(current_user, caller_coords)
    threats_res = await session.execute(threats_stmt)
    threat_rows = threats_res.all()

    threats_list = []
    for threat_obj, lat, lon in threat_rows:
        threats_list.append(
            ThreatResponse(
                id=threat_obj.id,
                name=threat_obj.name,
                description=threat_obj.description,
                threat_type=threat_obj.threat_type,
                type=threat_obj.type,
                severity_level=threat_obj.severity_level,
                engagement_status=threat_obj.engagement_status,
                assigned_to_id=threat_obj.assigned_to_id,
                radius=threat_obj.radius,
                lat=lat,
                lon=lon,
                altitude=threat_obj.altitude,
                status=threat_obj.status,
                created_by_id=threat_obj.created_by_id,
                created_at=threat_obj.created_at,
                updated_at=threat_obj.updated_at,
            )
        )

    return MapSnapshotResponse(squads=squads_list, threats=threats_list)
