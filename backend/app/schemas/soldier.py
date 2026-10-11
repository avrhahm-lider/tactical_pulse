from pydantic import BaseModel, Field


class SoldierBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(default="rifleman", max_length=50)


class SoldierCreate(SoldierBase):
    id: str = Field(..., pattern=r"^\d{7}$", description="Exactly 7-digit military ID")


class SoldierResponse(SoldierBase):
    id: str

    model_config = {"from_attributes": True}
