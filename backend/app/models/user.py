import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.postgres import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(
        String(50),
        nullable=False,
        info={"check": "role IN ('MainCommandCenter', 'AreaCommandCenter', 'Squad', 'SapperSquad', 'Radar')"},
    )
    area = Column(
        String(20),
        nullable=False,
        info={"check": "area IN ('Center', 'North', 'South', 'Global')"},
    )
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        String(20),
        default="active",
        nullable=False,
        info={"check": "status IN ('active', 'inactive')"},
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "role IN ('MainCommandCenter', 'AreaCommandCenter', 'Squad', 'SapperSquad', 'Radar')",
            name="check_user_role",
        ),
        CheckConstraint(
            "area IN ('Center', 'North', 'South', 'Global')",
            name="check_user_area",
        ),
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="check_user_status",
        ),
    )

    soldiers = relationship("Soldier", back_populates="user", cascade="all, delete-orphan", lazy="selectin")
    map_entity = relationship("MapEntity", back_populates="user", uselist=False, lazy="selectin")
