from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from geoalchemy2.functions import ST_X, ST_Y
from geoalchemy2.elements import WKTElement

from app.db.postgres import get_db
from app.models.user import User
from app.models.soldier import Soldier
from app.models.map_entity import MapEntity
from app.schemas.user import UserCreate, UserStatusUpdate, AdminUserResponse, UserResponse
from app.schemas.soldier import SoldierResponse
from app.core.security import hash_password
from app.core.errors import AppException
from app.services.audit import log_audit_event
from app.services.spatial import calculate_area_from_lat
from app.api.dependencies import require_main_command
from app.sockets.server import broadcast_unit_status_changed

router = APIRouter(prefix="/admin", tags=["Administration"])


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
            id=u.id, username=u.username, role=u.role, area=u.area, name=u.name,
            description=u.description, status=u.status, lat=lat, lon=lon,
            soldiers=u.soldiers, created_at=u.created_at,
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

    # Validate soldier uniqueness if soldiers are provided
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
        status="active",
    )
    session.add(new_user)
    await session.flush()

    # Add soldiers if provided
    soldiers_created = [
        Soldier(id=s.id, user_id=new_user.id, name=s.name, role=s.role)
        for s in req.soldiers
    ] if req.soldiers else []
    if soldiers_created:
        session.add_all(soldiers_created)

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
        id=new_user.id, username=new_user.username, role=new_user.role,
        area=new_user.area, name=new_user.name, description=new_user.description,
        status=new_user.status, lat=req.lat, lon=req.lon,
        soldiers=soldiers_created, created_at=new_user.created_at,
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
