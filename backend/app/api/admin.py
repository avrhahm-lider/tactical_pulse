import random
import re
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_command_center, require_main_command
from app.core.errors import AppException
from app.core.security import hash_password
from app.db.postgres import get_db
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.threat import Threat
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
from app.sockets.server import broadcast_unit_status_changed, disconnect_user_sockets, sio

router = APIRouter(prefix="/admin", tags=["Administration"])


RE_SOLDIER_ID = re.compile(r"^\d{7}$")


# =========================================================================
# HELPERS
# =========================================================================


def _mask_confidential_coords(
    role: str, lat: float | None, lon: float | None
) -> tuple[float | None, float | None]:
    return (
        (None, None)
        if role in ("Radar", "AreaCommandCenter", "MainCommandCenter")
        else (lat, lon)
    )


def _build_admin_user_response(
    u: User,
    lat: float | None = None,
    lon: float | None = None,
    soldiers: list | None = None,
) -> AdminUserResponse:
    m_lat, m_lon = _mask_confidential_coords(u.role, lat, lon)
    roster = soldiers if soldiers is not None else (u.soldiers or [])
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
        if not RE_SOLDIER_ID.match(s_id):
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
        s
        for s in soldiers
        if s.squad_id is not None
        and (current_user_id is None or s.squad_id != current_user_id)
    ]
    if conflicts:
        conflict_info = [f"{s.id} ({s.name})" for s in conflicts]
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Soldier(s) already assigned to another unit: {', '.join(conflict_info)}",
        )
    return soldiers


async def _generate_unique_soldier_id(session: AsyncSession) -> str:
    """Auto-generate a unique 7-digit military ID."""
    for _ in range(100):
        candidate = str(random.randint(1000000, 9999999))
        existing = (
            await session.execute(select(Soldier.id).where(Soldier.id == candidate))
        ).scalar_one_or_none()
        if not existing:
            return candidate
    raise AppException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code="ID_GENERATION_FAILED",
        message="Failed to generate unique 7-digit soldier ID",
    )


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
    return await list_soldiers(
        unassigned=True, session=session, current_user=current_user
    )


@router.post(
    "/soldiers", response_model=SoldierResponse, status_code=status.HTTP_201_CREATED
)
async def create_soldier(
    req: SoldierCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    # Auto-generate a unique 7-digit military ID if not provided
    soldier_id = req.id
    if not soldier_id:
        soldier_id = await _generate_unique_soldier_id(session)
    else:
        existing = (
            await session.execute(select(Soldier).where(Soldier.id == soldier_id))
        ).scalar_one_or_none()
        if existing:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Soldier with ID '{soldier_id}' already exists",
            )

    if req.squad_id:
        squad_exists = (
            await session.execute(select(User.id).where(User.id == req.squad_id))
        ).scalar_one_or_none()
        if not squad_exists:
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Squad unit '{req.squad_id}' not found",
            )

    soldier = Soldier(
        id=soldier_id, name=req.name, role=req.role, squad_id=req.squad_id
    )
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


@router.get("/soldiers/unlinked", response_model=list[SoldierResponse])
async def list_unlinked_soldiers(
    session: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_command_center),
):
    """Returns all soldiers not currently linked to any user account."""
    linked_ids_subquery = select(User.soldier_id).where(User.soldier_id.is_not(None))
    stmt = (
        select(Soldier)
        .where(Soldier.id.not_in(linked_ids_subquery))
        .order_by(Soldier.name.asc())
    )
    result = await session.execute(stmt)
    return [SoldierResponse.model_validate(s) for s in result.scalars().all()]


@router.get("/soldiers/{soldier_id}", response_model=SoldierResponse)
async def get_soldier(
    soldier_id: str,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    soldier = (
        await session.execute(select(Soldier).where(Soldier.id == soldier_id))
    ).scalar_one_or_none()
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
    soldier = (
        await session.execute(select(Soldier).where(Soldier.id == soldier_id))
    ).scalar_one_or_none()
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
        squad = (
            await session.execute(select(User).where(User.id == req.squad_id))
        ).scalar_one_or_none()
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
    soldier = (
        await session.execute(select(Soldier).where(Soldier.id == soldier_id))
    ).scalar_one_or_none()
    if not soldier:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Soldier '{soldier_id}' not found",
        )

    linked_user = (
        await session.execute(select(User).where(User.soldier_id == soldier_id))
    ).scalar_one_or_none()
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


@router.post(
    "/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED
)
async def create_user_or_unit(
    req: UserCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    existing_user = (
        await session.execute(select(User).where(User.username == req.username))
    ).scalar_one_or_none()
    if existing_user:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Username '{req.username}' already exists",
        )

    assigned_role = req.role
    assigned_area = req.area

    # Auto-promote role to SapperSquad if any roster soldier is a sapper
    if req.soldiers and any((s.role or "").lower() == "sapper" for s in req.soldiers):
        assigned_role = "SapperSquad"

    # Enforce strictly 1 account per field team
    if assigned_role in ["Squad", "SapperSquad"]:
        existing_squad = (
            await session.execute(
                select(User).where(
                    User.name == req.name,
                    User.role.in_(["Squad", "SapperSquad"]),
                )
            )
        ).scalar_one_or_none()
        if existing_squad:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Field team '{req.name}' already has an assigned user account. Each field team can only have 1 account.",
            )

    # RBAC Linking Rules:
    # "Field Team" (Squad/SapperSquad) and "Radar" users are created without being linked to a specific soldier.
    # Other user types (MainCommandCenter, AreaCommandCenter) must be linked to a soldier.
    if assigned_role in ["Squad", "SapperSquad", "Radar"]:
        req.soldier_id = None
    else:
        # Fallback to first assigned soldier if soldier_id was not explicitly passed
        if not req.soldier_id:
            if req.soldier_ids:
                req.soldier_id = req.soldier_ids[0]
            elif req.soldiers and req.soldiers[0].id:
                req.soldier_id = req.soldiers[0].id

        if not req.soldier_id:
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message="At least one soldier is required: this user type must be linked to a soldier selected from the dropdown list",
            )

    soldier = None
    if req.soldier_id:
        soldier = (
            await session.execute(select(Soldier).where(Soldier.id == req.soldier_id))
        ).scalar_one_or_none()
        if not soldier:
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Soldier with ID '{req.soldier_id}' not found in soldiers registry",
            )
        linked = (
            await session.execute(select(User).where(User.soldier_id == req.soldier_id))
        ).scalar_one_or_none()
        if linked:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Soldier '{req.soldier_id}' is already linked to another user account",
            )

    # Validate and fetch existing unassigned soldiers to assign (if provided)
    existing_to_assign = (
        await _validate_soldier_ids(session, req.soldier_ids) if req.soldier_ids else []
    )

    # Validate soldier roster uniqueness and auto-assign IDs for newly created soldiers
    if req.soldiers:
        for s in req.soldiers:
            if not s.id:
                s.id = await _generate_unique_soldier_id(session)

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
        conflict_soldier_ids = (
            (
                await session.execute(
                    select(Soldier.id).where(Soldier.id.in_(soldier_ids))
                )
            )
            .scalars()
            .all()
        )
        if conflict_soldier_ids:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Soldier military ID(s) already registered: {', '.join(conflict_soldier_ids)}",
            )

    is_field_unit = assigned_role in ["Squad", "SapperSquad", "Radar"]
    if is_field_unit:
        if req.lat is not None:
            assigned_area = calculate_area_from_lat(req.lat)
        elif not assigned_area:
            assigned_area = "Center"
    elif assigned_role == "MainCommandCenter":
        assigned_area = "Global"
    elif assigned_role == "AreaCommandCenter" and not assigned_area:
        assigned_area = calculate_area_from_lat(req.lat) if req.lat is not None else "Center"

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

    if soldier and soldier.squad_id is None:
        soldier.squad_id = new_user.id

    if (
        (is_field_unit or assigned_role == "AreaCommandCenter")
        and req.lat is not None
        and req.lon is not None
    ):
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
        details={
            "username": new_user.username,
            "role": new_user.role,
            "area": new_user.area,
        },
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

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"User '{user_id}' not found",
        )

    if "soldier_id" in req.model_dump(exclude_unset=True):
        if not req.soldier_id:
            user.soldier_id = None
        elif req.soldier_id != user.soldier_id:
            soldier = (
                await session.execute(select(Soldier).where(Soldier.id == req.soldier_id))
            ).scalar_one_or_none()
            if not soldier:
                raise AppException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    code="NOT_FOUND",
                    message=f"Soldier '{req.soldier_id}' not found",
                )
            linked = (
                await session.execute(
                    select(User).where(
                        User.soldier_id == req.soldier_id, User.id != user_id
                    )
                )
            ).scalar_one_or_none()
            if linked:
                raise AppException(
                    status_code=status.HTTP_409_CONFLICT,
                    code="CONFLICT",
                    message=f"Soldier '{req.soldier_id}' is already linked to another user account",
                )
            user.soldier_id = req.soldier_id

    effective_role = req.role if req.role is not None else user.role
    effective_name = req.name if req.name is not None else user.name
    if effective_role in ["Squad", "SapperSquad"] and (req.name is not None or req.role is not None):
        existing_squad = (
            await session.execute(
                select(User).where(
                    User.name == effective_name,
                    User.role.in_(["Squad", "SapperSquad"]),
                    User.id != user_id,
                )
            )
        ).scalar_one_or_none()
        if existing_squad:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Field team '{effective_name}' already has an assigned user account. Each field team can only have 1 account.",
            )

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
        soldiers_to_assign = await _validate_soldier_ids(
            session, req.soldier_ids, current_user_id=user.id
        )
        for s in soldiers_to_assign:
            s.squad_id = user.id

    if req.lat is not None and req.lon is not None:
        map_ent = (
            await session.execute(select(MapEntity).where(MapEntity.id == user_id))
        ).scalar_one_or_none()
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
        details={
            "username": user.username,
            "updated_fields": list(req.model_dump(exclude_unset=True).keys()),
        },
        ip_address=client_ip,
    )
    await session.commit()
    await session.refresh(user, ["soldiers", "soldier"])

    map_row = (
        await session.execute(
            select(ST_Y(MapEntity.geom), ST_X(MapEntity.geom)).where(
                MapEntity.id == user.id
            )
        )
    ).first()
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

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
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

    map_ent = (
        await session.execute(select(MapEntity).where(MapEntity.id == user_id))
    ).scalar_one_or_none()
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

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
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
    return MessageResponse(
        message=f"Session reset for user '{user.username}' successfully"
    )


@router.post("/users/reset-all-sessions", response_model=MessageResponse)
async def reset_all_sessions(
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"
    stmt = update(User).values(
        is_logged_in=False, session_id=None, last_activity_at=None
    )
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
    return MessageResponse(
        message=f"All active user sessions reset successfully ({count} users updated)"
    )


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(
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

    if user.id == current_admin.id:
        raise AppException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_REQUEST",
            message="Cannot delete your own administrator account",
        )

    username = user.username

    # 1. Disconnect active sockets
    await disconnect_user_sockets(str(user.id))

    # 2. Remove associated MapEntity
    await session.execute(delete(MapEntity).where(MapEntity.id == user.id))

    # 3. Unassign roster soldiers so they remain in personnel registry
    await session.execute(update(Soldier).where(Soldier.squad_id == user.id).values(squad_id=None))

    # 4. Unassign threats assigned to this user/squad
    await session.execute(
        update(Threat)
        .where(Threat.assigned_to_id == user.id)
        .values(assigned_to_id=None, engagement_status="unassigned")
    )

    # 5. Reassign threats created by this user to current_admin to prevent foreign key constraint violation
    await session.execute(
        update(Threat)
        .where(Threat.created_by_id == user.id)
        .values(created_by_id=current_admin.id)
    )

    # 6. Delete user account
    await session.delete(user)

    await log_audit_event(
        session=session,
        action="user_deleted",
        user_id=current_admin.id,
        resource_type="user",
        resource_id=user_id,
        details={"deleted_username": username},
        ip_address=client_ip,
    )
    await session.commit()

    # 7. Broadcast WebSocket event to all clients to remove this unit
    await sio.emit("unit_status_changed", {"id": str(user_id), "status": "deleted"})

    return MessageResponse(message=f"User '{username}' deleted successfully")
