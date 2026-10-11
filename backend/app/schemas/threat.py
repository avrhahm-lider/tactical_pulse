from typing import Optional, Literal
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, model_validator

ThreatType = Literal["movable", "immovable"]
ThreatCategory = Literal["explosive", "vehicle", "drone", "personnel"]
ThreatSeverity = Literal["low", "medium", "high", "critical"]
ThreatEngagement = Literal["unassigned", "in_progress", "resolved"]
ThreatStatus = Literal["active", "inactive"]


class ThreatBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    description: Optional[str] = None
    threat_type: ThreatCategory
    severity_level: ThreatSeverity
    radius: float = Field(default=150.0, ge=10.0, le=5000.0)


class ThreatCreate(ThreatBase):
    type: ThreatType
    lat: float = Field(..., ge=29.0, le=34.0)
    lon: float = Field(..., ge=33.5, le=36.5)
    altitude: Optional[float] = Field(None, ge=0.0)

    @model_validator(mode="after")
    def validate_type_consistency(self):
        if self.threat_type == "explosive" and self.type != "immovable":
            raise ValueError("Explosive threat MUST have type 'immovable'")
        if self.threat_type in ["vehicle", "drone", "personnel"] and self.type != "movable":
            raise ValueError(f"Threat category '{self.threat_type}' MUST have type 'movable'")
        return self


class ThreatUpdate(BaseModel):
    engagement_status: Optional[ThreatEngagement] = None
    assigned_to_id: Optional[UUID] = None
    severity_level: Optional[ThreatSeverity] = None
    description: Optional[str] = None
    radius: Optional[float] = Field(None, ge=10.0, le=5000.0)
    status: Optional[ThreatStatus] = None
    lat: Optional[float] = Field(None, ge=29.0, le=34.0)
    lon: Optional[float] = Field(None, ge=33.5, le=36.5)
    altitude: Optional[float] = Field(None, ge=0.0)


class ThreatResponse(ThreatBase):
    id: UUID
    type: ThreatType
    engagement_status: ThreatEngagement
    assigned_to_id: Optional[UUID] = None
    radius: float
    lat: float
    lon: float
    altitude: Optional[float] = None
    status: ThreatStatus
    created_by_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
