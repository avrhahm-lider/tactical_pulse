from uuid import UUID

from pydantic import BaseModel, Field


class SoldierBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="Combat", max_length=50)


class SoldierCreate(BaseModel):
    id: str | None = Field(
        None,
        pattern=r"^\d{7}$",
        description="Optional 7-digit military ID (auto-generated if omitted)",
    )
    name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="Combat", max_length=50)
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
