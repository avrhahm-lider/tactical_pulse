from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.soldier import SoldierResponse
from app.schemas.threat import ThreatResponse


class SquadSnapshotItem(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    role: str
    area: str
    lat: float
    lon: float
    heading: float = 0.0
    status: str
    updated_at: datetime
    soldiers: list[SoldierResponse] = []

    model_config = {"from_attributes": True}


class MapSnapshotResponse(BaseModel):
    squads: list[SquadSnapshotItem]
    threats: list[ThreatResponse]
