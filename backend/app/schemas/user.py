from typing import Optional, List, Literal
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.soldier import SoldierCreate, SoldierResponse

UserRole = Literal["MainCommandCenter", "AreaCommandCenter", "Squad", "SapperSquad", "Radar"]
UserArea = Literal["Center", "North", "South", "Global"]
UserStatus = Literal["active", "inactive"]


class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    role: UserRole
    name: str = Field(..., min_length=2, max_length=150)
    description: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=6)
    soldier_id: Optional[str] = Field(None, pattern=r"^\d{7}$", description="7-digit military ID of the soldier")
    area: Optional[UserArea] = None
    lat: Optional[float] = Field(None, ge=29.0, le=34.0)
    lon: Optional[float] = Field(None, ge=33.5, le=36.5)
    soldiers: Optional[List[SoldierCreate]] = None


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=150)
    description: Optional[str] = None
    role: Optional[UserRole] = None
    area: Optional[UserArea] = None
    soldier_id: Optional[str] = Field(None, pattern=r"^\d{7}$")
    password: Optional[str] = Field(None, min_length=6)
    lat: Optional[float] = Field(None, ge=29.0, le=34.0)
    lon: Optional[float] = Field(None, ge=33.5, le=36.5)


class UserStatusUpdate(BaseModel):
    status: UserStatus = Field(..., description="Target status: active or inactive")


class UserResponse(BaseModel):
    id: UUID
    username: str
    role: UserRole
    area: UserArea
    name: str
    description: Optional[str] = None
    status: UserStatus
    soldier_id: Optional[str] = None

    model_config = {"from_attributes": True}


class AdminUserResponse(UserResponse):
    lat: Optional[float] = None
    lon: Optional[float] = None
    soldiers: List[SoldierResponse] = []
    soldier: Optional[SoldierResponse] = None
    is_logged_in: bool = False
    last_activity_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}
