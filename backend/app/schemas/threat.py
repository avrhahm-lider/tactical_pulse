from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

ThreatType = Literal["movable", "immovable"]
ThreatCategory = Literal["explosive", "vehicle", "drone", "personnel"]
ThreatSeverity = Literal["low", "medium", "high", "critical"]
ThreatEngagement = Literal["unassigned", "in_progress", "resolved"]
ThreatStatus = Literal["active", "inactive"]


class ThreatBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    description: str | None = None
    threat_type: ThreatCategory
    severity_level: ThreatSeverity
    radius: float = Field(default=150.0, ge=10.0, le=5000.0)


class ThreatCreate(ThreatBase):
    type: ThreatType | None = None
    lat: float = Field(..., ge=29.0, le=34.0)
    lon: float = Field(..., ge=33.5, le=36.5)
    altitude: float | None = Field(None, ge=0.0)

    @model_validator(mode="after")
    def validate_type_consistency(self):
        if self.type is None:
            self.type = "immovable" if self.threat_type == "explosive" else "movable"
        elif self.threat_type == "explosive" and self.type != "immovable":
            raise ValueError("Explosive threat MUST have type 'immovable'")
        elif self.threat_type in ["vehicle", "drone", "personnel"] and self.type != "movable":
            raise ValueError(f"Threat category '{self.threat_type}' MUST have type 'movable'")

        if self.threat_type != "drone" and self.altitude is not None:
            self.altitude = None
        return self


class ThreatUpdate(BaseModel):
    engagement_status: ThreatEngagement | None = None
    assigned_to_id: UUID | None = None
    severity_level: ThreatSeverity | None = None
    description: str | None = None
    radius: float | None = Field(None, ge=10.0, le=5000.0)
    status: ThreatStatus | None = None
    lat: float | None = Field(None, ge=29.0, le=34.0)
    lon: float | None = Field(None, ge=33.5, le=36.5)
    altitude: float | None = Field(None, ge=0.0)


class ThreatResponse(ThreatBase):
    id: UUID
    type: ThreatType
    engagement_status: ThreatEngagement
    assigned_to_id: UUID | None = None
    radius: float
    lat: float
    lon: float
    altitude: float | None = None
    status: ThreatStatus
    created_by_id: UUID
    created_by_soldier_id: str | None = None
    created_by_soldier_name: str | None = None
    created_by_unit_name: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    model_config = {"from_attributes": True}

    @classmethod
    def from_threat(cls, threat, lat: float, lon: float) -> "ThreatResponse":
        soldier_name = threat.created_by_soldier.name if getattr(threat, "created_by_soldier", None) else None
        unit_name = threat.created_by.name if getattr(threat, "created_by", None) else None
        return cls(
            id=threat.id,
            name=threat.name,
            description=threat.description,
            threat_type=threat.threat_type,
            type=threat.type,
            severity_level=threat.severity_level,
            engagement_status=threat.engagement_status,
            assigned_to_id=threat.assigned_to_id,
            radius=threat.radius,
            lat=lat,
            lon=lon,
            altitude=threat.altitude,
            status=threat.status,
            created_by_id=threat.created_by_id,
            created_by_soldier_id=threat.created_by_soldier_id,
            created_by_soldier_name=soldier_name,
            created_by_unit_name=unit_name,
            created_at=threat.created_at,
            updated_at=threat.updated_at,
        )

