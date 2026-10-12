from datetime import UTC, datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.postgres import Base


class MapEntity(Base):
    __tablename__ = "map_entities"

    id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    geom = Column(Geometry("POINT", srid=4326, spatial_index=False), nullable=False)
    heading = Column(Float, default=0.0, nullable=False)
    status = Column(String(20), default="active", nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "heading >= 0.0 AND heading <= 360.0",
            name="check_heading_range",
        ),
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="check_map_entity_status",
        ),
        Index("idx_map_entities_geom", "geom", postgresql_using="gist"),
    )

    user = relationship("User", back_populates="map_entity")
