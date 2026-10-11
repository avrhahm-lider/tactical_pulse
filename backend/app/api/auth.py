import time
from typing import Dict, Tuple
from uuid import UUID
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.postgres import get_db
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    RefreshResponse,
    MessageResponse,
)
from app.schemas.user import UserResponse
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.errors import AppException
from app.services.audit import log_audit_event
from app.api.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

# In-memory rate limiting and account locking tracker:
# key: (username, ip) -> (failure_count, last_attempt_time, locked_until_time)
_login_attempts: Dict[Tuple[str, str], Tuple[int, float, float]] = {}


def check_rate_limit(username: str, client_ip: str) -> None:
    now = time.time()
    key = (username, client_ip)
    if key in _login_attempts:
        failures, last_attempt, locked_until = _login_attempts[key]
        if now < locked_until:
            wait_seconds = int(locked_until - now)
            raise AppException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                code="RATE_LIMITED",
                message=f"Account temporarily locked due to failed attempts. Retry in {wait_seconds} seconds.",
                details={"retry_after_seconds": wait_seconds},
            )
        # Reset counter if 60 seconds have elapsed since last attempt
        if now - last_attempt > 60.0:
            _login_attempts[key] = (0, now, 0.0)


def record_failed_attempt(username: str, client_ip: str) -> None:
    now = time.time()
    key = (username, client_ip)
    failures, _, _ = _login_attempts.get(key, (0, 0.0, 0.0))
    failures += 1
    locked_until = 0.0
    if failures >= 10:
        locked_until = now + (15 * 60.0)  # lock for 15 minutes
    _login_attempts[key] = (failures, now, locked_until)


def record_successful_attempt(username: str, client_ip: str) -> None:
    key = (username, client_ip)
    _login_attempts.pop(key, None)


@router.post("/login", response_model=TokenResponse)
async def login(
    req: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    client_ip = request.client.host if request.client else "127.0.0.1"
    check_rate_limit(req.username, client_ip)

    stmt = select(User).where(User.username == req.username)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        record_failed_attempt(req.username, client_ip)
        await log_audit_event(
            session=session,
            action="login_failed",
            user_id=user.id if user else None,
            resource_type="auth",
            details={"username": req.username, "reason": "invalid_credentials"},
            ip_address=client_ip,
        )
        await session.commit()
        raise AppException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="UNAUTHORIZED",
            message="Invalid username or password",
        )

    if user.status != "active":
        await log_audit_event(
            session=session,
            action="login_failed",
            user_id=user.id,
            resource_type="auth",
            details={"username": req.username, "reason": "inactive_account"},
            ip_address=client_ip,
        )
        await session.commit()
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message="User account is deactivated / inactive",
        )

    record_successful_attempt(req.username, client_ip)

    extra_claims = {
        "role": user.role,
        "area": user.area,
        "username": user.username,
        "name": user.name,
    }
    access_token = create_access_token(subject=str(user.id), extra_claims=extra_claims)
    refresh_token = create_refresh_token(subject=str(user.id))

    await log_audit_event(
        session=session,
        action="login_success",
        user_id=user.id,
        resource_type="auth",
        details={"username": user.username, "role": user.role, "area": user.area},
        ip_address=client_ip,
    )
    await session.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=3600,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token_endpoint(
    req: RefreshTokenRequest,
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    client_ip = request.client.host if request.client else "127.0.0.1"
    try:
        payload = decode_token(req.refresh_token)
        user_id_str = payload.get("sub")
        token_type = payload.get("type")
        if not user_id_str or token_type != "refresh":
            raise ValueError("Invalid refresh token payload")
        user_id = UUID(user_id_str)
    except Exception:
        raise AppException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="UNAUTHORIZED",
            message="Invalid or expired refresh token",
        )

    stmt = select(User).where(User.id == user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or user.status != "active":
        raise AppException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="UNAUTHORIZED",
            message="User associated with refresh token is invalid or inactive",
        )

    extra_claims = {"role": user.role, "area": user.area}
    new_access_token = create_access_token(subject=str(user.id), extra_claims=extra_claims)
    new_refresh_token = create_refresh_token(subject=str(user.id))

    await log_audit_event(
        session=session,
        action="token_refresh",
        user_id=user.id,
        resource_type="auth",
        details={"username": user.username},
        ip_address=client_ip,
    )
    await session.commit()

    return RefreshResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=3600,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    client_ip = request.client.host if request.client else "127.0.0.1"
    await log_audit_event(
        session=session,
        action="logout",
        user_id=current_user.id,
        resource_type="auth",
        details={"username": current_user.username},
        ip_address=client_ip,
    )
    await session.commit()
    return MessageResponse(message="Logged out successfully")
