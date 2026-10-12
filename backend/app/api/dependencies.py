from typing import List
from uuid import UUID
from fastapi import Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.postgres import get_db
from app.models.user import User
from app.core.security import decode_token
from app.core.errors import AppException

security_bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_bearer),
    session: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        payload = decode_token(token)
        user_id_str = payload.get("sub")
        token_type = payload.get("type")
        if not user_id_str or token_type != "access":
            raise ValueError("Invalid access token type or missing subject")
        user_id = UUID(user_id_str)
    except Exception:
        raise AppException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="UNAUTHORIZED",
            message="Invalid or expired authentication credentials",
        )

    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise AppException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="UNAUTHORIZED",
            message="User associated with token not found",
        )

    if user.status != "active":
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message="User account is deactivated / inactive",
        )

    # Touch last_activity_at for rolling inactivity tracking
    from datetime import datetime, timezone
    user.last_activity_at = datetime.now(timezone.utc)
    await session.commit()

    return user


class RoleChecker:
    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, user: User = Depends(get_current_user)) -> User:
        if user.role not in self.allowed_roles:
            raise AppException(
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN",
                message=f"Role '{user.role}' does not have permission for this operation",
            )
        return user


require_main_command = RoleChecker(["MainCommandCenter"])
require_command_center = RoleChecker(["MainCommandCenter", "AreaCommandCenter"])
