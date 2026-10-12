import re
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_command_center, require_main_command
from app.core.errors import AppException
from app.core.security import hash_password
from app.db.postgres import get_db
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.user import User
from app.schemas.auth import MessageResponse
from app.schemas.soldier import SoldierCreate, SoldierResponse, SoldierUpdate
from app.schemas.user import (
    AdminUserResponse,
    UserCreate,
    UserResponse,
    UserStatusUpdate,
    UserUpdate,
)
from app.services.audit import log_audit_event
from app.services.spatial import calculate_area_from_lat
from app.sockets.server import broadcast_unit_status_changed

router = APIRouter(prefix="/admin", tags=["Administration"])


# =========================================================================
# HELPERS
# =========================================================================

def _mask_confidential_coords(role: str, lat: float | None, lon: float | None) -> tuple[float | None, float | None]:
    return (None, None) if role in ("Radar", "AreaCommandCenter", "MainCommandCenter") else (lat, lon)


def _build_admin_user_response(
    u: User,
    lat: float | None = None,
    lon: float | None = None,
    soldiers: list | None = None,
) -> AdminUserResponse:
    m_lat, m_lon = _mask_confidential_coords(u.role, lat, lon)
    roster = soldiers if soldiers is not None else u.soldiers
    return AdminUserResponse(
        id=u.id,
        username=u.username,
        role=u.role,
        area=u.area,
        name=u.name,
        description=u.description,
        status=u.status,
        soldier_id=u.soldier_id,
        soldier=SoldierResponse.model_validate(u.soldier) if u.soldier else None,
        is_logged_in=u.is_logged_in,
        last_activity_at=u.last_activity_at,
        lat=m_lat,
        lon=m_lon,
        soldiers=[SoldierResponse.model_validate(s) for s in roster],
        created_at=u.created_at,
    )


async def _validate_soldier_ids(
    session: AsyncSession,
    soldier_ids: list[str],
    current_user_id: UUID | None = None,
) -> list[Soldier]:
    """Validates 7-digit format, registry existence, and unit assignment conflict."""
    if len(soldier_ids) != len(set(soldier_ids)):
        raise AppException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="VALIDATION_ERROR",
            message="Duplicate soldier IDs found in soldier_ids list",
        )
    for s_id in soldier_ids:
        if not re.match(r"^\d{7}$", s_id):
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message=f"Invalid soldier ID format '{s_id}', must be exactly 7 digits",
            )
    stmt = select(Soldier).where(Soldier.id.in_(soldier_ids))
    soldiers = list((await session.execute(stmt)).scalars().all())
    missing = set(soldier_ids) - {s.id for s in soldiers}
    if missing:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Soldier military ID(s) not found in registry: {', '.join(sorted(missing))}",
        )
    conflicts = [
        s for s in soldiers
        if s.squad_id is not None and (current_user_id is None or s.squad_id != current_user_id)
    ]
    if conflicts:
        conflict_info = [f"{s.id} ({s.name})" for s in conflicts]
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Soldier(s) already assigned to another unit: {', '.join(conflict_info)}",
        )
    return soldiers


# =========================================================================
# SOLDIERS MANAGEMENT
# =========================================================================

@router.get("/soldiers", response_model=list[SoldierResponse])
async def list_soldiers(
    squad_id: UUID | None = None,
    unassigned: bool | None = None,
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_command_center),
):
    stmt = select(Soldier)
    if unassigned is True:
        stmt = stmt.where(Soldier.squad_id.is_(None))
    elif unassigned is False:
        stmt = stmt.where(Soldier.squad_id.is_not(None))
    elif squad_id is not None:
        stmt = stmt.where(Soldier.squad_id == squad_id)
    stmt = stmt.order_by(Soldier.id.asc())
    result = await session.execute(stmt)
    return [SoldierResponse.model_validate(s) for s in result.scalars().all()]


@router.get("/soldiers/unassigned", response_model=list[SoldierResponse])
async def list_unassigned_soldiers(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_command_center),
):
    """Returns list of all registered soldiers not currently assigned to any unit or command center."""
    return await list_soldiers(unassigned=True, session=session, current_user=current_user)


@router.post("/soldiers", response_model=SoldierResponse, status_code=status.HTTP_201_CREATED)
async def create_soldier(
    req: SoldierCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    existing = (await session.execute(select(Soldier).where(Soldier.id == req.id))).scalar_one_or_none()
    if existing:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Soldier with ID '{req.id}' already exists",
        )

    if req.squad_id:
        squad_exists = (await session.execute(select(User).where(User.id == req.squad_id))).scalar_one_or_none()
        if not squad_exists:
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Squad unit '{req.squad_id}' not found",
            )

    soldier = Soldier(id=req.id, name=req.name, role=req.role, squad_id=req.squad_id)
    session.add(soldier)
    await log_audit_event(
        session=session,
        action="soldier_created",
        user_id=current_admin.id,
        resource_type="soldier",
        details={"soldier_id": soldier.id, "name": soldier.name, "role": soldier.role},
        ip_address=client_ip,
    )
    await session.commit()
    await session.refresh(soldier)
    return SoldierResponse.model_validate(soldier)


@router.get("/soldiers/{soldier_id}", response_model=SoldierResponse)
async def get_soldier(
    soldier_id: str,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    soldier = (await session.execute(select(Soldier).where(Soldier.id == soldier_id))).scalar_one_or_none()
    if not soldier:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Soldier '{soldier_id}' not found",
        )
    return SoldierResponse.model_validate(soldier)


@router.patch("/soldiers/{soldier_id}", response_model=SoldierResponse)
async def update_soldier(
    soldier_id: str,
    req: SoldierUpdate,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    soldier = (await session.execute(select(Soldier).where(Soldier.id == soldier_id))).scalar_one_or_none()
    if not soldier:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Soldier '{soldier_id}' not found",
        )

    if req.name is not None:
        soldier.name = req.name
    if req.role is not None:
        soldier.role = req.role
    if req.squad_id is not None:
        squad = (await session.execute(select(User).where(User.id == req.squad_id))).scalar_one_or_none()
        if not squad:
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Squad unit '{req.squad_id}' not found",
            )
        soldier.squad_id = req.squad_id

    await session.commit()
    await session.refresh(soldier)
    return SoldierResponse.model_validate(soldier)


@router.delete("/soldiers/{soldier_id}", response_model=MessageResponse)
async def delete_soldier(
    soldier_id: str,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    soldier = (await session.execute(select(Soldier).where(Soldier.id == soldier_id))).scalar_one_or_none()
    if not soldier:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Soldier '{soldier_id}' not found",
        )

    linked_user = (await session.execute(select(User).where(User.soldier_id == soldier_id))).scalar_one_or_none()
    if linked_user:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Cannot delete soldier '{soldier_id}' because an active user account is linked to this soldier",
        )

    await session.delete(soldier)
    await session.commit()
    return MessageResponse(message=f"Soldier '{soldier_id}' deleted successfully")


# =========================================================================
# USERS MANAGEMENT
# =========================================================================

@router.get("/users", response_model=list[AdminUserResponse])
async def list_all_users(
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    stmt = (
        select(
            User,
            ST_Y(MapEntity.geom).label("lat"),
            ST_X(MapEntity.geom).label("lon"),
        )
        .outerjoin(MapEntity, MapEntity.id == User.id)
        .order_by(User.created_at.desc())
    )
    result = await session.execute(stmt)
    return [_build_admin_user_response(u, lat, lon) for u, lat, lon in result.all()]


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
async def create_user_or_unit(
    req: UserCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    existing_user = (await session.execute(select(User).where(User.username == req.username))).scalar_one_or_none()
    if existing_user:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Username '{req.username}' already exists",
        )

    if req.soldier_id:
        soldier = (await session.execute(select(Soldier).where(Soldier.id == req.soldier_id))).scalar_one_or_none()
        if not soldier:
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Soldier with ID '{req.soldier_id}' not found in soldiers registry",
            )
        linked = (await session.execute(select(User).where(User.soldier_id == req.soldier_id))).scalar_one_or_none()
        if linked:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Soldier '{req.soldier_id}' is already linked to another user account",
            )

    assigned_role = req.role
    assigned_area = req.area

    # Enforce soldier requirement for combat squads AND command centers
    if req.role in ["Squad", "SapperSquad", "AreaCommandCenter", "MainCommandCenter"]:
        total_soldiers = (len(req.soldiers) if req.soldiers else 0) + (len(req.soldier_ids) if req.soldier_ids else 0)
        if total_soldiers == 0 and not req.soldier_id:
            unit_label = "Command Center" if "CommandCenter" in req.role else "combat squad"
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message=f"At least one soldier is required when registering a {unit_label}",
            )
        if req.soldiers and any(s.role.lower() == "sapper" for s in req.soldiers):
            assigned_role = "SapperSquad"

    # Validate and fetch existing unassigned soldiers to assign
    existing_to_assign = await _validate_soldier_ids(session, req.soldier_ids) if req.soldier_ids else []

    # Validate soldier roster uniqueness for newly created soldiers
    if req.soldiers:
        soldier_ids = [s.id for s in req.soldiers]
        if len(soldier_ids) != len(set(soldier_ids)):
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message="Duplicate soldier IDs found in submitted roster",
            )
        if req.soldier_ids and set(soldier_ids) & set(req.soldier_ids):
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message="Soldier ID cannot be present in both newly created soldiers and existing soldier_ids",
            )
        conflict_soldier_ids = (await session.execute(
            select(Soldier.id).where(Soldier.id.in_(soldier_ids))
        )).scalars().all()
        if conflict_soldier_ids:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Soldier military ID(s) already registered: {', '.join(conflict_soldier_ids)}",
            )

    # Field units require initial coordinates
    is_field_unit = assigned_role in ["Squad", "SapperSquad", "Radar"]
    if is_field_unit:
        if req.lat is None or req.lon is None:
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message="Coordinates (lat, lon) are strictly required for tactical field units",
            )
        assigned_area = calculate_area_from_lat(req.lat)
    elif assigned_role == "MainCommandCenter":
        assigned_area = "Global"
    elif assigned_role == "AreaCommandCenter":
        if not assigned_area:
            if req.lat is not None:
                assigned_area = calculate_area_from_lat(req.lat)
            else:
                raise AppException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    code="VALIDATION_ERROR",
                    message="Area must be specified for AreaCommandCenter (North, Center, South)",
                )

    new_user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        role=assigned_role,
        area=assigned_area,
        name=req.name,
        description=req.description,
        soldier_id=req.soldier_id,
        status="active",
        is_logged_in=False,
    )
    session.add(new_user)
    await session.flush()

    for s in existing_to_assign:
        s.squad_id = new_user.id

    soldiers_created = [
        Soldier(id=s.id, squad_id=new_user.id, name=s.name, role=s.role)
        for s in (req.soldiers or [])
    ]
    if soldiers_created:
        session.add_all(soldiers_created)

    if req.soldier_id:
        cmd_soldier = (await session.execute(select(Soldier).where(Soldier.id == req.soldier_id))).scalar_one_or_none()
        if cmd_soldier and cmd_soldier.squad_id is None:
            cmd_soldier.squad_id = new_user.id

    if (is_field_unit or assigned_role == "AreaCommandCenter") and req.lat is not None and req.lon is not None:
        session.add(
            MapEntity(
                id=new_user.id,
                geom=WKTElement(f"POINT({req.lon} {req.lat})", srid=4326),
                heading=0.0,
                status="active",
            )
        )

    await log_audit_event(
        session=session,
        action="user_created",
        user_id=current_admin.id,
        resource_type="user",
        resource_id=new_user.id,
        details={"username": new_user.username, "role": new_user.role, "area": new_user.area},
        ip_address=client_ip,
    )
    await session.commit()
    await session.refresh(new_user, ["soldiers", "soldier"])
    return _build_admin_user_response(new_user, req.lat, req.lon)


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: UUID,
    req: UserUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"User '{user_id}' not found",
        )

    if req.soldier_id is not None and req.soldier_id != user.soldier_id:
        soldier = (await session.execute(select(Soldier).where(Soldier.id == req.soldier_id))).scalar_one_or_none()
        if not soldier:
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Soldier '{req.soldier_id}' not found",
            )
        linked = (await session.execute(
            select(User).where(User.soldier_id == req.soldier_id, User.id != user_id)
        )).scalar_one_or_none()
        if linked:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Soldier '{req.soldier_id}' is already linked to another user account",
            )
        user.soldier_id = req.soldier_id

    if req.name is not None:
        user.name = req.name
    if req.description is not None:
        user.description = req.description
    if req.role is not None:
        user.role = req.role
    if req.area is not None:
        user.area = req.area
    if req.password is not None:
        user.password_hash = hash_password(req.password)

    if req.soldier_ids is not None:
        soldiers_to_assign = await _validate_soldier_ids(session, req.soldier_ids, current_user_id=user.id)
        for s in soldiers_to_assign:
            s.squad_id = user.id

    if req.lat is not None and req.lon is not None:
        map_ent = (await session.execute(select(MapEntity).where(MapEntity.id == user_id))).scalar_one_or_none()
        if map_ent:
            map_ent.geom = WKTElement(f"POINT({req.lon} {req.lat})", srid=4326)
        else:
            session.add(
                MapEntity(
                    id=user.id,
                    geom=WKTElement(f"POINT({req.lon} {req.lat})", srid=4326),
                    heading=0.0,
                    status=user.status,
                )
            )

    await log_audit_event(
        session=session,
        action="user_updated",
        user_id=current_admin.id,
        resource_type="user",
        resource_id=user.id,
        details={"username": user.username, "updated_fields": list(req.model_dump(exclude_unset=True).keys())},
        ip_address=client_ip,
    )
    await session.commit()
    await session.refresh(user, ["soldiers", "soldier"])

    map_row = (await session.execute(
        select(ST_Y(MapEntity.geom), ST_X(MapEntity.geom)).where(MapEntity.id == user.id)
    )).first()
    lat, lon = (map_row[0], map_row[1]) if map_row else (None, None)
    return _build_admin_user_response(user, lat, lon)


@router.patch("/users/{user_id}/status", response_model=UserResponse)
async def update_user_status(
    user_id: UUID,
    req: UserStatusUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Unit with ID '{user_id}' not found",
        )

    if user.id == current_admin.id and req.status == "inactive":
        raise AppException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_REQUEST",
            message="Cannot deactivate your own administrator account",
        )

    user.status = req.status
    if req.status == "inactive":
        user.is_logged_in = False
        user.session_id = None

    map_ent = (await session.execute(select(MapEntity).where(MapEntity.id == user_id))).scalar_one_or_none()
    if map_ent:
        map_ent.status = req.status

    action_name = "user_deactivated" if req.status == "inactive" else "user_activated"
    await log_audit_event(
        session=session,
        action=action_name,
        user_id=current_admin.id,
        resource_type="user",
        resource_id=user.id,
        details={"target_username": user.username, "new_status": req.status},
        ip_address=client_ip,
    )
    await session.commit()
    await session.refresh(user)

    try:
        await broadcast_unit_status_changed(str(user.id), req.status)
    except Exception as e:
        print(f"[SOCKET WARNING] Broadcast unit_status_changed failed: {e}")

    return UserResponse.model_validate(user)


@router.post("/users/{user_id}/reset-session", response_model=MessageResponse)
async def reset_user_session(
    user_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"User with ID '{user_id}' not found",
        )

    user.is_logged_in = False
    user.session_id = None
    user.last_activity_at = None

    await log_audit_event(
        session=session,
        action="session_reset",
        user_id=current_admin.id,
        resource_type="user",
        resource_id=user.id,
        details={"target_username": user.username},
        ip_address=client_ip,
    )
    await session.commit()
    return MessageResponse(message=f"Session reset for user '{user.username}' successfully")


@router.post("/users/reset-all-sessions", response_model=MessageResponse)
async def reset_all_sessions(
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"
    stmt = update(User).values(is_logged_in=False, session_id=None, last_activity_at=None)
    res = await session.execute(stmt)
    count = res.rowcount

    await log_audit_event(
        session=session,
        action="all_sessions_reset",
        user_id=current_admin.id,
        resource_type="system",
        resource_id=None,
        details={"reset_count": count},
        ip_address=client_ip,
    )
    await session.commit()
    return MessageResponse(message=f"All active user sessions reset successfully ({count} users updated)")
