from uuid import UUID

from pydantic import BaseModel, Field


class SoldierBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="rifleman", max_length=50)


class SoldierCreate(SoldierBase):
    id: str = Field(..., pattern=r"^\d{7}$", description="Exactly 7-digit military ID")
    squad_id: UUID | None = None


class SoldierUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=100)
    role: str | None = Field(None, max_length=50)
    squad_id: UUID | None = None


class SoldierResponse(BaseModel):
    id: str
    name: str
    role: str
    squad_id: UUID | None = None
    user_id: UUID | None = None

    model_config = {"from_attributes": True}
