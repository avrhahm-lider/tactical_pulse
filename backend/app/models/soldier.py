from sqlalchemy import Column, String, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.postgres import Base


class Soldier(Base):
    __tablename__ = "soldiers"

    id = Column(String(7), primary_key=True)
    squad_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name = Column(String(100), nullable=False)
    role = Column(String(50), default="rifleman", nullable=False)

    __table_args__ = (
        CheckConstraint(
            "id ~ '^\\d{7}$'",
            name="check_soldier_id_7digits",
        ),
    )

    squad = relationship("User", foreign_keys=[squad_id], back_populates="soldiers")
    user_account = relationship(
        "User",
        foreign_keys="User.soldier_id",
        back_populates="soldier",
        uselist=False,
    )
