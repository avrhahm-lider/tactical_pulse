from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel
from app.schemas.soldier import SoldierResponse
from app.schemas.threat import ThreatResponse


class SquadSnapshotItem(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    role: str
    area: str
    lat: float
    lon: float
    heading: float = 0.0
    status: str
    updated_at: datetime
    soldiers: List[SoldierResponse] = []

    model_config = {"from_attributes": True}


class MapSnapshotResponse(BaseModel):
    squads: List[SquadSnapshotItem]
    threats: List[ThreatResponse]
