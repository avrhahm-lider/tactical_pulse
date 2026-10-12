from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from geoalchemy2.functions import ST_X, ST_Y
from geoalchemy2.elements import WKTElement

from app.db.postgres import get_db
from app.models.user import User
from app.models.soldier import Soldier
from app.models.map_entity import MapEntity
from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserStatusUpdate,
    AdminUserResponse,
    UserResponse,
)
from app.schemas.soldier import (
    SoldierCreate,
    SoldierUpdate,
    SoldierResponse,
)
from app.schemas.auth import MessageResponse
from app.core.security import hash_password
from app.core.errors import AppException
from app.services.audit import log_audit_event
from app.services.spatial import calculate_area_from_lat
from app.api.dependencies import require_main_command
from app.sockets.server import broadcast_unit_status_changed

router = APIRouter(prefix="/admin", tags=["Administration"])


# =========================================================================
# SOLDIERS MANAGEMENT
# =========================================================================

@router.get("/soldiers", response_model=List[SoldierResponse])
async def list_soldiers(
    squad_id: Optional[UUID] = None,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    stmt = select(Soldier)
    if squad_id is not None:
        stmt = stmt.where(Soldier.squad_id == squad_id)
    stmt = stmt.order_by(Soldier.id.asc())
    result = await session.execute(stmt)
    soldiers = result.scalars().all()

    # Determine user_id for each soldier if linked
    user_stmt = select(User.id, User.soldier_id).where(User.soldier_id.isnot(None))
    user_res = await session.execute(user_stmt)
    soldier_to_user = {sid: uid for uid, sid in user_res.all()}

    return [
        SoldierResponse(
            id=s.id,
            name=s.name,
            role=s.role,
            squad_id=s.squad_id,
            user_id=soldier_to_user.get(s.id),
        )
        for s in soldiers
    ]


@router.post("/soldiers", response_model=SoldierResponse, status_code=status.HTTP_201_CREATED)
async def create_soldier(
    req: SoldierCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    existing_stmt = select(Soldier).where(Soldier.id == req.id)
    existing_res = await session.execute(existing_stmt)
    if existing_res.scalar_one_or_none():
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Soldier with ID '{req.id}' already exists",
        )

    if req.squad_id:
        squad_stmt = select(User).where(User.id == req.squad_id)
        squad_res = await session.execute(squad_stmt)
        if not squad_res.scalar_one_or_none():
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Squad unit '{req.squad_id}' not found",
            )

    soldier = Soldier(
        id=req.id,
        name=req.name,
        role=req.role,
        squad_id=req.squad_id,
    )
    session.add(soldier)
    await session.commit()
    await session.refresh(soldier)

    await log_audit_event(
        session=session,
        action="soldier_created",
        user_id=current_admin.id,
        resource_type="soldier",
        resource_id=None,
        details={"soldier_id": soldier.id, "name": soldier.name, "role": soldier.role},
        ip_address=client_ip,
    )
    await session.commit()

    return SoldierResponse(
        id=soldier.id,
        name=soldier.name,
        role=soldier.role,
        squad_id=soldier.squad_id,
        user_id=None,
    )


@router.get("/soldiers/{soldier_id}", response_model=SoldierResponse)
async def get_soldier(
    soldier_id: str,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    stmt = select(Soldier).where(Soldier.id == soldier_id)
    res = await session.execute(stmt)
    soldier = res.scalar_one_or_none()
    if not soldier:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Soldier '{soldier_id}' not found",
        )

    user_stmt = select(User.id).where(User.soldier_id == soldier_id)
    user_res = await session.execute(user_stmt)
    linked_user_id = user_res.scalar_one_or_none()

    return SoldierResponse(
        id=soldier.id,
        name=soldier.name,
        role=soldier.role,
        squad_id=soldier.squad_id,
        user_id=linked_user_id,
    )


@router.patch("/soldiers/{soldier_id}", response_model=SoldierResponse)
async def update_soldier(
    soldier_id: str,
    req: SoldierUpdate,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    stmt = select(Soldier).where(Soldier.id == soldier_id)
    res = await session.execute(stmt)
    soldier = res.scalar_one_or_none()
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
        squad_stmt = select(User).where(User.id == req.squad_id)
        squad_res = await session.execute(squad_stmt)
        if not squad_res.scalar_one_or_none():
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Squad unit '{req.squad_id}' not found",
            )
        soldier.squad_id = req.squad_id

    await session.commit()
    await session.refresh(soldier)

    user_stmt = select(User.id).where(User.soldier_id == soldier_id)
    user_res = await session.execute(user_stmt)
    linked_user_id = user_res.scalar_one_or_none()

    return SoldierResponse(
        id=soldier.id,
        name=soldier.name,
        role=soldier.role,
        squad_id=soldier.squad_id,
        user_id=linked_user_id,
    )


@router.delete("/soldiers/{soldier_id}", response_model=MessageResponse)
async def delete_soldier(
    soldier_id: str,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    stmt = select(Soldier).where(Soldier.id == soldier_id)
    res = await session.execute(stmt)
    soldier = res.scalar_one_or_none()
    if not soldier:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"Soldier '{soldier_id}' not found",
        )

    # Check if linked to user
    user_stmt = select(User).where(User.soldier_id == soldier_id)
    user_res = await session.execute(user_stmt)
    if user_res.scalar_one_or_none():
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

def _mask_confidential_coords(role: str, lat: Optional[float], lon: Optional[float]):
    if role in ["Radar", "AreaCommandCenter", "MainCommandCenter"]:
        return None, None
    return lat, lon


@router.get("/users", response_model=List[AdminUserResponse])
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
    rows = result.all()

    return [
        AdminUserResponse(
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
            lat=_mask_confidential_coords(u.role, lat, lon)[0],
            lon=_mask_confidential_coords(u.role, lat, lon)[1],
            soldiers=[SoldierResponse.model_validate(s) for s in u.soldiers],
            created_at=u.created_at,
        )
        for u, lat, lon in rows
    ]


@router.post("/users", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
async def create_user_or_unit(
    req: UserCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    # Check username uniqueness
    existing_stmt = select(User).where(User.username == req.username)
    existing_res = await session.execute(existing_stmt)
    if existing_res.scalar_one_or_none():
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code="CONFLICT",
            message=f"Username '{req.username}' already exists",
        )

    # Validate soldier_id if provided
    if req.soldier_id:
        soldier_stmt = select(Soldier).where(Soldier.id == req.soldier_id)
        soldier_res = await session.execute(soldier_stmt)
        if not soldier_res.scalar_one_or_none():
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Soldier with ID '{req.soldier_id}' not found in soldiers registry",
            )

        linked_user_stmt = select(User).where(User.soldier_id == req.soldier_id)
        linked_user_res = await session.execute(linked_user_stmt)
        if linked_user_res.scalar_one_or_none():
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code="CONFLICT",
                message=f"Soldier '{req.soldier_id}' is already linked to another user account",
            )

    assigned_role = req.role
    assigned_area = req.area

    # Enforce soldier requirement for combat squads
    if req.role in ["Squad", "SapperSquad"]:
        if not req.soldiers or len(req.soldiers) == 0:
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message="Soldier roster is required for field combat squads",
            )
        # Automatic promotion to SapperSquad if any soldier is a sapper
        has_sapper = any(s.role.lower() == "sapper" for s in req.soldiers)
        if has_sapper:
            assigned_role = "SapperSquad"

    # Validate soldier roster uniqueness
    if req.soldiers:
        soldier_ids = [s.id for s in req.soldiers]
        if len(soldier_ids) != len(set(soldier_ids)):
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code="VALIDATION_ERROR",
                message="Duplicate soldier IDs found in submitted roster",
            )
        existing_soldier_stmt = select(Soldier.id).where(Soldier.id.in_(soldier_ids))
        existing_soldier_res = await session.execute(existing_soldier_stmt)
        conflict_soldier_ids = existing_soldier_res.scalars().all()
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

    # Add or associate soldiers in roster
    soldiers_created = []
    if req.soldiers:
        for s in req.soldiers:
            s_exist_stmt = select(Soldier).where(Soldier.id == s.id)
            s_exist_res = await session.execute(s_exist_stmt)
            s_entity = s_exist_res.scalar_one_or_none()
            if s_entity:
                s_entity.squad_id = new_user.id
                s_entity.name = s.name
                s_entity.role = s.role
                soldiers_created.append(s_entity)
            else:
                new_s = Soldier(id=s.id, squad_id=new_user.id, name=s.name, role=s.role)
                session.add(new_s)
                soldiers_created.append(new_s)

    # Automatically create initial map_entity for field units or regional command centers
    if (is_field_unit or assigned_role == "AreaCommandCenter") and req.lat is not None and req.lon is not None:
        map_ent = MapEntity(
            id=new_user.id,
            geom=WKTElement(f"POINT({req.lon} {req.lat})", srid=4326),
            heading=0.0,
            status="active",
        )
        session.add(map_ent)

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
    await session.refresh(new_user)

    return AdminUserResponse(
        id=new_user.id,
        username=new_user.username,
        role=new_user.role,
        area=new_user.area,
        name=new_user.name,
        description=new_user.description,
        status=new_user.status,
        soldier_id=new_user.soldier_id,
        soldier=SoldierResponse.model_validate(new_user.soldier) if new_user.soldier else None,
        is_logged_in=new_user.is_logged_in,
        last_activity_at=new_user.last_activity_at,
        lat=_mask_confidential_coords(new_user.role, req.lat, req.lon)[0],
        lon=_mask_confidential_coords(new_user.role, req.lat, req.lon)[1],
        soldiers=[SoldierResponse.model_validate(s) for s in soldiers_created],
        created_at=new_user.created_at,
    )


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: UUID,
    req: UserUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    stmt = select(User).where(User.id == user_id)
    res = await session.execute(stmt)
    user = res.scalar_one_or_none()
    if not user:
        raise AppException(
            status_code=status.HTTP_404_NOT_FOUND,
            code="NOT_FOUND",
            message=f"User '{user_id}' not found",
        )

    # Check soldier_id reassignment
    if req.soldier_id is not None and req.soldier_id != user.soldier_id:
        soldier_stmt = select(Soldier).where(Soldier.id == req.soldier_id)
        soldier_res = await session.execute(soldier_stmt)
        if not soldier_res.scalar_one_or_none():
            raise AppException(
                status_code=status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=f"Soldier '{req.soldier_id}' not found",
            )

        linked_stmt = select(User).where(User.soldier_id == req.soldier_id, User.id != user_id)
        linked_res = await session.execute(linked_stmt)
        if linked_res.scalar_one_or_none():
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

    # Update MapEntity if lat/lon provided
    if req.lat is not None and req.lon is not None:
        map_stmt = select(MapEntity).where(MapEntity.id == user_id)
        map_res = await session.execute(map_stmt)
        map_ent = map_res.scalar_one_or_none()
        if map_ent:
            map_ent.geom = WKTElement(f"POINT({req.lon} {req.lat})", srid=4326)
        else:
            new_map_ent = MapEntity(
                id=user.id,
                geom=WKTElement(f"POINT({req.lon} {req.lat})", srid=4326),
                heading=0.0,
                status=user.status,
            )
            session.add(new_map_ent)

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
    await session.refresh(user)

    # Fetch lat/lon
    map_stmt = select(ST_Y(MapEntity.geom), ST_X(MapEntity.geom)).where(MapEntity.id == user.id)
    map_res = await session.execute(map_stmt)
    map_row = map_res.first()
    lat = map_row[0] if map_row else None
    lon = map_row[1] if map_row else None

    return AdminUserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        area=user.area,
        name=user.name,
        description=user.description,
        status=user.status,
        soldier_id=user.soldier_id,
        soldier=SoldierResponse.model_validate(user.soldier) if user.soldier else None,
        is_logged_in=user.is_logged_in,
        last_activity_at=user.last_activity_at,
        lat=_mask_confidential_coords(user.role, lat, lon)[0],
        lon=_mask_confidential_coords(user.role, lat, lon)[1],
        soldiers=[SoldierResponse.model_validate(s) for s in user.soldiers],
        created_at=user.created_at,
    )


@router.patch("/users/{user_id}/status", response_model=UserResponse)
async def update_user_status(
    user_id: UUID,
    req: UserStatusUpdate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_main_command),
):
    client_ip = request.client.host if request.client else "127.0.0.1"

    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

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

    # Also update map_entity status if present
    map_stmt = select(MapEntity).where(MapEntity.id == user_id)
    map_res = await session.execute(map_stmt)
    map_ent = map_res.scalar_one_or_none()
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

    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

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
