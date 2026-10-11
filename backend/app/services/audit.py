from typing import Optional, Dict, Any
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit_log import AuditLog


async def log_audit_event(
    session: AsyncSession,
    action: str,
    user_id: Optional[UUID] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[UUID] = None,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    entry = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or {},
        ip_address=ip_address,
    )
    session.add(entry)
    return entry
