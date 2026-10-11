from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, cast
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_X, ST_Y, ST_DWithin, ST_MakePoint, ST_SetSRID
from geoalchemy2.elements import WKTElement

from app.db.postgres import get_db
from app.models.user import User
from app.models.threat import Threat
from app.schemas.threat import ThreatCreate, ThreatUpdate, ThreatResponse
from app.core.errors import AppException
from app.core.config import settings
from app.services.audit import log_audit_event
from app.services.spatial import get_caller_coordinates, get_visible_threats_query
from app.api.dependencies import get_current_user
from app.sockets.server import broadcast_threat_event

router = APIRouter(prefix="/threats", tags=["Threats Management"])


def is_lat_in_area(lat: float, area: str) -> bool:
    if area == "North":
        return lat >= settings.LAT_NORTH_MIN
    elif area == "Center":
        return settings.LAT_CENTER_MIN <= lat < settings.LAT_NORTH_MIN
    elif area == "South":
        return settings.LAT_MIN <= lat < settings.LAT_CENTER_MIN
    return True


@router.get("", response_model=List[ThreatResponse])
async def list_threats(
    status_filter: Optional[str] = "active",
    engagement_status: Optional[str] = None,
    threat_type: Optional[str] = None,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    caller_coords = await get_caller_coordinates(session, current_user.id)
    stmt = await get_visible_threats_query(current_user, caller_coords)

    if status_filter:
        stmt = stmt.where(Threat.status == status_filter)
    if engagement_status:
        stmt = stmt.where(Threat.engagement_status == engagement_status)
    if threat_type:
        stmt = stmt.where(Threat.threat_type == threat_type)

    stmt = stmt.order_by(Threat.updated_at.desc())
    result = await session.execute(stmt)
    rows = result.all()

    return [
        ThreatResponse(
            id=t.id,
            name=t.name,
            description=t.description,
            threat_type=t.threat_type,
            type=t.type,
            severity_level=t.severity_level,
            engagement_status=t.engagement_status,
            assigned_to_id=t.assigned_to_id,
            radius=t.radius,
            lat=lat,
            lon=lon,
            altitude=t.altitude,
            status=t.status,
            created_by_id=t.created_by_id,
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t, lat, lon in rows
    ]


@router.post("", response_model=ThreatResponse, status_code=status.HTTP_201_CREATED)
async def create_threat(
    req: ThreatCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    # 1. RBAC Creation Matrix
    if req.threat_type == "explosive" and current_user.role == "Radar":
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message="Radar units cannot report explosive IED hazards",
        )

    # 2. AreaCommandCenter Zone Restriction
    if current_user.role == "AreaCommandCenter":
        if not is_lat_in_area(req.lat, current_user.area):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message=f"AreaCommandCenter '{current_user.area}' can only create threats within its operational sector",
            )

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
    await session.refresh(new_threat)

    resp = ThreatResponse(
        id=new_threat.id,
        name=new_threat.name,
        description=new_threat.description,
        threat_type=new_threat.threat_type,
        type=new_threat.type,
        severity_level=new_threat.severity_level,
        engagement_status=new_threat.engagement_status,
        assigned_to_id=new_threat.assigned_to_id,
        radius=new_threat.radius,
        lat=req.lat,
        lon=req.lon,
        altitude=new_threat.altitude,
        status=new_threat.status,
        created_by_id=new_threat.created_by_id,
        created_at=new_threat.created_at,
        updated_at=new_threat.updated_at,
    )
    await broadcast_threat_event("threat_created", resp.model_dump(mode="json"))
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

    stmt = select(
        Threat,
        ST_Y(Threat.geom).label("lat"),
        ST_X(Threat.geom).label("lon"),
    ).where(Threat.id == threat_id)
    result = await session.execute(stmt)
    row = result.first()

    if not row:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Threat with ID '{threat_id}' not found",
        )

    threat, current_lat, current_lon = row

    # 1. AreaCommandCenter Zone Restriction
    if current_user.role == "AreaCommandCenter":
        if not is_lat_in_area(current_lat, current_user.area):
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message=f"AreaCommandCenter '{current_user.area}' cannot modify threats outside its assigned sector",
            )

    # 2. Field Unit Proximity Restriction (20 km)
    is_field_unit = current_user.role in ["Squad", "SapperSquad", "Radar"]
    caller_coords = await get_caller_coordinates(session, current_user.id)
    if is_field_unit:
        if not caller_coords:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Field unit position is unknown. Cannot perform tactical actions on threats.",
            )
        caller_lat, caller_lon = caller_coords
        # Verify 20 km distance
        dist_stmt = select(
            ST_DWithin(
                cast(Threat.geom, Geography),
                cast(ST_SetSRID(ST_MakePoint(caller_lon, caller_lat), 4326), Geography),
                settings.VISIBILITY_RADIUS_METERS,
            )
        ).where(Threat.id == threat.id)
        dist_res = await session.execute(dist_stmt)
        is_within_range = dist_res.scalar()
        if not is_within_range:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Threat is outside unit's 20 km tactical operating radius",
            )

    # 3. Concurrency Control & Self-Assignment
    if req.engagement_status == "in_progress":
        if threat.engagement_status != "unassigned":
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="THREAT_ALREADY_ASSIGNED",
                message="This threat is already being handled by another squad",
                details={"assigned_to_id": str(threat.assigned_to_id)},
            )
        # Radar cannot take responsibility
        if current_user.role == "Radar":
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Radar units cannot take direct responsibility for engaging threats",
            )
        # Explosive IEDs can only be engaged by SapperSquad or Command Center
        if threat.threat_type == "explosive" and current_user.role not in ["SapperSquad", "MainCommandCenter", "AreaCommandCenter"]:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only SapperSquad (EOD) or Command Center can engage explosive threats",
            )
        # Field squads can only assign to themselves
        if is_field_unit:
            threat.assigned_to_id = current_user.id
        elif req.assigned_to_id is not None:
            threat.assigned_to_id = req.assigned_to_id
        else:
            threat.assigned_to_id = current_user.id
        threat.engagement_status = "in_progress"

    elif req.engagement_status == "resolved":
        # Explosive IEDs can only be resolved by SapperSquad or Command Center
        if threat.threat_type == "explosive" and current_user.role not in ["SapperSquad", "MainCommandCenter", "AreaCommandCenter"]:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only SapperSquad or Command Center can resolve explosive hazards",
            )
        # Regular movable threats: assigned squad or command center
        if is_field_unit and threat.assigned_to_id != current_user.id and current_user.role not in ["MainCommandCenter", "AreaCommandCenter"]:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Only the assigned squad or Command Center can resolve this threat",
            )
        threat.engagement_status = "resolved"

    elif req.engagement_status == "unassigned":
        threat.engagement_status = "unassigned"
        threat.assigned_to_id = None

    # 4. Coordinate Update Validation
    new_lat = current_lat
    new_lon = current_lon
    if req.lat is not None or req.lon is not None:
        if threat.type == "immovable":
            raise AppException(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_REQUEST",
                message="Immovable threats (IED/minefield) are fixed and cannot be repositioned",
            )
        if threat.threat_type == "drone" and current_user.role not in ["Radar", "MainCommandCenter", "AreaCommandCenter"]:
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
        threat.altitude = req.altitude

    # 5. Lifecycle Deactivation
    if req.status == "inactive":
        if threat.engagement_status == "in_progress":
            raise AppException(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_REQUEST",
                message="Cannot deactivate a threat currently in progress",
            )
        if is_field_unit and threat.assigned_to_id != current_user.id:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message="Field squads can only deactivate threats assigned to them",
            )
        threat.status = "inactive"
    elif req.status == "active":
        threat.status = "active"

    # Optional metadata updates
    if req.severity_level:
        threat.severity_level = req.severity_level
    if req.description is not None:
        threat.description = req.description
    if req.radius:
        threat.radius = req.radius

    audit_action = "threat_resolved" if req.engagement_status == "resolved" else (
        "threat_deactivated" if req.status == "inactive" else "threat_updated"
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

    resp = ThreatResponse(
        id=threat.id,
        name=threat.name,
        description=threat.description,
        threat_type=threat.threat_type,
        type=threat.type,
        severity_level=threat.severity_level,
        engagement_status=threat.engagement_status,
        assigned_to_id=threat.assigned_to_id,
        radius=threat.radius,
        lat=new_lat,
        lon=new_lon,
        altitude=threat.altitude,
        status=threat.status,
        created_by_id=threat.created_by_id,
        created_at=threat.created_at,
        updated_at=threat.updated_at,
    )
    await broadcast_threat_event("threat_updated", resp.model_dump(mode="json"))
    return resp
