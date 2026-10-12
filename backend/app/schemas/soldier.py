from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class SoldierBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="rifleman", max_length=50)


class SoldierCreate(BaseModel):
    id: str = Field(..., pattern=r"^\d{7}$", description="Exactly 7-digit military ID")
    name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="rifleman", max_length=50)
    squad_id: Optional[UUID] = None


class SoldierUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    role: Optional[str] = Field(None, max_length=50)
    squad_id: Optional[UUID] = None


class SoldierResponse(BaseModel):
    id: str
    name: str
    role: str
    squad_id: Optional[UUID] = None
    user_id: Optional[UUID] = None

    model_config = {"from_attributes": True}
