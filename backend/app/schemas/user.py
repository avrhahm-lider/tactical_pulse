from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.soldier import SoldierCreate, SoldierResponse

UserRole = Literal["MainCommandCenter", "AreaCommandCenter", "Squad", "SapperSquad", "Radar"]
UserArea = Literal["Center", "North", "South", "Global"]
UserStatus = Literal["active", "inactive"]


class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    role: UserRole
    name: str = Field(..., min_length=2, max_length=150)
    description: str | None = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=6)
    soldier_id: str | None = Field(None, pattern=r"^\d{7}$", description="7-digit military ID of the soldier")
    area: UserArea | None = None
    lat: float | None = Field(None, ge=29.0, le=34.0)
    lon: float | None = Field(None, ge=33.5, le=36.5)
    soldiers: list[SoldierCreate] | None = None
    soldier_ids: list[str] | None = Field(
        None, description="List of existing unassigned 7-digit soldier military IDs to assign to this unit/center"
    )


class UserUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=150)
    description: str | None = None
    role: UserRole | None = None
    area: UserArea | None = None
    soldier_id: str | None = Field(None, pattern=r"^\d{7}$")
    password: str | None = Field(None, min_length=6)
    lat: float | None = Field(None, ge=29.0, le=34.0)
    lon: float | None = Field(None, ge=33.5, le=36.5)
    soldier_ids: list[str] | None = Field(
        None, description="List of existing unassigned 7-digit soldier military IDs to assign to this unit"
    )


class UserStatusUpdate(BaseModel):
    status: UserStatus = Field(..., description="Target status: active or inactive")


class UserResponse(BaseModel):
    id: UUID
    username: str
    role: UserRole
    area: UserArea
    name: str
    description: str | None = None
    status: UserStatus
    soldier_id: str | None = None
    soldier: SoldierResponse | None = None
    soldiers: list[SoldierResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class AdminUserResponse(UserResponse):
    lat: float | None = None
    lon: float | None = None
    is_logged_in: bool = False
    last_activity_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
