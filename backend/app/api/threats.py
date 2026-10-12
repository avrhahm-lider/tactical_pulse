from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from geoalchemy2 import Geography
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y, ST_DWithin, ST_MakePoint, ST_SetSRID
from sqlalchemy import cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.core.config import settings
from app.core.errors import AppException
from app.db.postgres import get_db
from app.models.soldier import Soldier
from app.models.threat import Threat
from app.models.user import User
from app.schemas.threat import ThreatCreate, ThreatResponse, ThreatUpdate
from app.services.audit import log_audit_event
from app.services.spatial import (
    get_caller_coordinates,
    get_visible_threats_query,
    is_lat_in_area,
)
from app.simulator.engine import simulator_engine
from app.sockets.server import broadcast_threat_event

router = APIRouter(prefix="/threats", tags=["Threats Management"])


# =========================================================================
# RBAC PERMISSION HELPERS
# =========================================================================

def _is_command_center(user: User) -> bool:
    return user.role in ("MainCommandCenter", "AreaCommandCenter")


def _can_control_drone(user: User) -> bool:
    return user.role == "Radar" or _is_command_center(user)


def _validate_resolve_permission(threat: Threat, user: User, is_field_unit: bool) -> None:
    if threat.threat_type == "drone":
        if not _can_control_drone(user):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only Radar units or Command Center can confirm that an enemy drone has been shot down",
            )
    elif threat.threat_type == "explosive":
        if user.role != "SapperSquad" and not _is_command_center(user):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only SapperSquad (EOD) or Command Center can resolve explosive hazards",
            )
    elif is_field_unit and threat.assigned_to_id != user.id and not _is_command_center(user):
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message="Only the assigned squad or Command Center can resolve this threat",
        )


def _validate_deactivate_permission(threat: Threat, user: User, is_field_unit: bool) -> None:
    if threat.threat_type == "drone":
        if not _can_control_drone(user):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only Radar units or Command Center can report that a drone has been destroyed and deactivate its track",
            )
    elif threat.engagement_status == "in_progress":
        raise AppException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_REQUEST",
            message="Cannot deactivate a threat currently in progress",
        )
    elif is_field_unit and threat.assigned_to_id != user.id and not _is_command_center(user):
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message="Field squads can only deactivate threats assigned to them",
        )


# =========================================================================
# THREATS ENDPOINTS
# =========================================================================

@router.get("", response_model=list[ThreatResponse])
async def list_threats(
    status_filter: str | None = "active",
    engagement_status: str | None = None,
    threat_type: str | None = None,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    caller_coords = await get_caller_coordinates(session, current_user.id)
    include_resolved = engagement_status is not None
    stmt = get_visible_threats_query(
        current_user,
        caller_coords,
        status_filter=status_filter,
        include_resolved=include_resolved,
    )
    if engagement_status:
        stmt = stmt.where(Threat.engagement_status == engagement_status)
    if threat_type:
        stmt = stmt.where(Threat.threat_type == threat_type)

    stmt = stmt.order_by(Threat.updated_at.desc())
    rows = (await session.execute(stmt)).all()
    return [ThreatResponse.from_threat(t, lat, lon) for t, lat, lon in rows]


@router.post("", response_model=ThreatResponse, status_code=status.HTTP_201_CREATED)
async def create_threat(
    req: ThreatCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    if req.threat_type == "explosive" and current_user.role == "Radar":
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message="Radar units cannot report explosive IED hazards",
        )

    if current_user.role == "AreaCommandCenter" and not is_lat_in_area(req.lat, current_user.area):
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message=f"AreaCommandCenter '{current_user.area}' can only create threats within its operational sector",
        )

    # Resolve reporting soldier ID
    reporting_soldier_id = None
    if req.soldier_id:
        soldier = (await session.execute(select(Soldier).where(Soldier.id == req.soldier_id))).scalar_one_or_none()
        if not soldier:
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Reporting soldier with ID '{req.soldier_id}' not found",
            )
        if (
            current_user.role != "MainCommandCenter"
            and soldier.squad_id != current_user.id
            and current_user.soldier_id != req.soldier_id
        ):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message=f"Soldier '{req.soldier_id}' does not belong to unit '{current_user.name}'",
            )
        reporting_soldier_id = soldier.id
    else:
        reporting_soldier_id = current_user.soldier_id

    new_threat = Threat(
        name=req.name,
        description=req.description,
        threat_type=req.threat_type,
        type=req.type,
        severity_level=req.severity_level,
        engagement_status="unassigned",
        assigned_to_id=None,
        geom=WKTElement(f"POINT({req.lon} {req.lat})", srid=4326),
        altitude=req.altitude,
        radius=req.radius,
        status="active",
        created_by_id=current_user.id,
        created_by_soldier_id=reporting_soldier_id,
    )
    session.add(new_threat)
    await session.flush()

    await log_audit_event(
        session=session,
        action="threat_created",
        user_id=current_user.id,
        resource_type="threat",
        resource_id=new_threat.id,
        details={"name": new_threat.name, "threat_type": new_threat.threat_type, "lat": req.lat, "lon": req.lon},
        ip_address=client_ip,
    )
    await session.commit()
    await session.refresh(new_threat, ["created_by", "created_by_soldier"])

    resp = ThreatResponse.from_threat(new_threat, req.lat, req.lon)
    try:
        await broadcast_threat_event("threat_created", resp.model_dump(mode="json"))
    except Exception as e:
        print(f"[SOCKET WARNING] Broadcast threat_created failed: {e}")
    return resp


@router.patch("/{threat_id}", response_model=ThreatResponse)
async def update_threat(
    threat_id: UUID,
    req: ThreatUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    row = (await session.execute(
        select(Threat, ST_Y(Threat.geom).label("lat"), ST_X(Threat.geom).label("lon")).where(Threat.id == threat_id)
    )).first()

    if not row:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Threat with ID '{threat_id}' not found",
        )

    threat, current_lat, current_lon = row

    # Sector restrictions for AreaCommandCenter
    if current_user.role == "AreaCommandCenter":
        if not is_lat_in_area(current_lat, current_user.area):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message=f"AreaCommandCenter '{current_user.area}' cannot modify threats outside its assigned sector",
            )
        if req.lat is not None and not is_lat_in_area(req.lat, current_user.area):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message=f"AreaCommandCenter '{current_user.area}' cannot relocate threats outside its assigned sector",
            )

    # 20 km operational proximity restriction for field tactical units
    is_field_unit = current_user.role in ("Squad", "SapperSquad")
    is_radar_drone = current_user.role == "Radar" and threat.threat_type == "drone"
    if is_field_unit or (current_user.role == "Radar" and not is_radar_drone):
        caller_coords = await get_caller_coordinates(session, current_user.id)
        if not caller_coords:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Field unit position is unknown. Cannot perform tactical actions on threats.",
            )
        c_lat, c_lon = caller_coords
        dist_stmt = select(
            ST_DWithin(
                cast(Threat.geom, Geography),
                cast(ST_SetSRID(ST_MakePoint(c_lon, c_lat), 4326), Geography),
                settings.VISIBILITY_RADIUS_METERS,
            )
        ).where(Threat.id == threat.id)
        if not (await session.execute(dist_stmt)).scalar():
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Threat is outside unit's 20 km tactical operating radius",
            )

    # Engagement status transitions
    if req.engagement_status == "in_progress":
        if threat.engagement_status != "unassigned":
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="THREAT_ALREADY_ASSIGNED",
                message="This threat is already being handled by another squad",
                details={"assigned_to_id": str(threat.assigned_to_id)},
            )
        if current_user.role == "Radar":
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Radar units cannot take direct responsibility for engaging threats",
            )
        if threat.threat_type == "explosive" and current_user.role != "SapperSquad" and not _is_command_center(current_user):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only SapperSquad (EOD) or Command Center can engage explosive threats",
            )
        threat.assigned_to_id = current_user.id if is_field_unit or req.assigned_to_id is None else req.assigned_to_id
        threat.engagement_status = "in_progress"

    elif req.engagement_status == "resolved":
        _validate_resolve_permission(threat, current_user, is_field_unit)
        threat.engagement_status = "resolved"
        threat.status = "inactive"
        if threat.threat_type == "drone":
            simulator_engine.stop_drone(threat.id)

    elif req.engagement_status == "unassigned":
        threat.engagement_status = "unassigned"
        threat.assigned_to_id = None

    # Coordinate & altitude updates
    new_lat = current_lat
    new_lon = current_lon
    if req.lat is not None or req.lon is not None:
        if threat.type == "immovable":
            raise AppException(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_REQUEST",
                message="Immovable threats (IED/minefield) are fixed and cannot be repositioned",
            )
        if threat.threat_type == "drone" and not _can_control_drone(current_user):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only Radar or Command Center can update aerial drone telemetry",
            )
        new_lat = req.lat if req.lat is not None else current_lat
        new_lon = req.lon if req.lon is not None else current_lon
        threat.geom = WKTElement(f"POINT({new_lon} {new_lat})", srid=4326)

    if req.altitude is not None:
        if threat.threat_type != "drone":
            raise AppException(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_REQUEST",
                message="Altitude can only be specified for aerial drone threats",
            )
        if not _can_control_drone(current_user):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only Radar or Command Center can update aerial drone telemetry",
            )
        threat.altitude = req.altitude

    # Lifecycle deactivation
    if req.status == "inactive":
        _validate_deactivate_permission(threat, current_user, is_field_unit)
        threat.status = "inactive"
        threat.engagement_status = "resolved"
        if threat.threat_type == "drone":
            simulator_engine.stop_drone(threat.id)
    elif req.status == "active":
        threat.status = "active"

    # Optional metadata
    if req.severity_level:
        threat.severity_level = req.severity_level
    if req.description is not None:
        threat.description = req.description
    if req.radius:
        threat.radius = req.radius

    audit_action = "threat_resolved" if threat.engagement_status == "resolved" else (
        "threat_deactivated" if threat.status == "inactive" else "threat_updated"
    )
    await log_audit_event(
        session=session,
        action=audit_action,
        user_id=current_user.id,
        resource_type="threat",
        resource_id=threat.id,
        details={"status": threat.status, "engagement_status": threat.engagement_status},
        ip_address=client_ip,
    )
    await session.commit()
    await session.refresh(threat)

    resp = ThreatResponse.from_threat(threat, new_lat, new_lon)
    try:
        await broadcast_threat_event("threat_updated", resp.model_dump(mode="json"))
    except Exception as e:
        print(f"[SOCKET WARNING] Broadcast threat_updated failed: {e}")
    return resp
