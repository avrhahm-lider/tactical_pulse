import ipaddress
from typing import Any
from uuid import UUID

from app.models.audit_log import AuditLog
from sqlalchemy.ext.asyncio import AsyncSession


def sanitize_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    try:
        ipaddress.ip_address(ip)
        return ip
    except ValueError:
        return "127.0.0.1"


async def log_audit_event(
    session: AsyncSession,
    action: str,
    user_id: UUID | None = None,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    details: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or {},
        ip_address=sanitize_ip(ip_address),
    )
    session.add(entry)
    return entry
