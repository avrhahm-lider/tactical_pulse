import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.postgres import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    soldier_id = Column(
        String(7),
        ForeignKey("soldiers.id", ondelete="SET NULL"),
        unique=True,
        nullable=True,
        index=True,
    )
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False)
    area = Column(String(20), nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), default="active", nullable=False)
    is_logged_in = Column(Boolean, default=False, nullable=False)
    last_activity_at = Column(DateTime(timezone=True), nullable=True)
    session_id = Column(String(64), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
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

    soldier = relationship(
        "Soldier",
        foreign_keys=[soldier_id],
        back_populates="user_account",
        lazy="selectin",
    )
    soldiers = relationship(
        "Soldier",
        foreign_keys="Soldier.squad_id",
        back_populates="squad",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    map_entity = relationship("MapEntity", back_populates="user", uselist=False, lazy="selectin")
