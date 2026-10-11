import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, Float, DateTime, ForeignKey, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.db.postgres import Base


class Threat(Base):
    __tablename__ = "threats"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type = Column(String(20), nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    threat_type = Column(String(50), nullable=False)
    severity_level = Column(String(20), nullable=False)
    engagement_status = Column(String(30), default="unassigned", nullable=False)
    assigned_to_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    geom = Column(Geometry("POINT", srid=4326, spatial_index=False), nullable=False)
    altitude = Column(Float, nullable=True)
    radius = Column(Float, default=150.0, nullable=False)
    status = Column(String(20), default="active", nullable=False)
    created_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "type IN ('movable', 'immovable')",
            name="check_threat_type_enum",
        ),
        CheckConstraint(
            "threat_type IN ('explosive', 'vehicle', 'drone', 'personnel')",
            name="check_threat_category",
        ),
        CheckConstraint(
            "severity_level IN ('low', 'medium', 'high', 'critical')",
            name="check_threat_severity",
        ),
        CheckConstraint(
            "engagement_status IN ('unassigned', 'in_progress', 'resolved')",
            name="check_threat_engagement_status",
        ),
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="check_threat_status",
        ),
        CheckConstraint(
            "(threat_type = 'explosive' AND type = 'immovable') OR (threat_type IN ('vehicle', 'drone', 'personnel') AND type = 'movable')",
            name="valid_threat_type",
        ),
        CheckConstraint(
            "NOT (status = 'inactive' AND engagement_status = 'in_progress')",
            name="valid_lifecycle",
        ),
        Index("idx_threats_status", "status", "engagement_status"),
        Index("idx_threats_assigned", "assigned_to_id"),
        Index("idx_threats_geom", "geom", postgresql_using="gist"),
    )

    assigned_to = relationship("User", foreign_keys=[assigned_to_id], lazy="selectin")
    created_by = relationship("User", foreign_keys=[created_by_id], lazy="selectin")
