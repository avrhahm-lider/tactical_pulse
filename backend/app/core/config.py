import json
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Tactical Pulse"
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/tactical_pulse"

    @field_validator("DATABASE_URL", mode="before")
    def assemble_db_connection(cls, v: str) -> str:
        if isinstance(v, str):
            if v.startswith("postgres://"):
                return "postgresql+asyncpg://" + v[11:]
            if v.startswith("postgresql://") and not v.startswith("postgresql+asyncpg://"):
                return "postgresql+asyncpg://" + v[13:]
        return v

    # JWT Security
    JWT_SECRET_KEY: str = "tactical-pulse-super-secret-key-change-in-production-2026"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("CORS_ORIGINS", mode="before")
    def assemble_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                try:
                    return json.loads(stripped)
                except json.JSONDecodeError:
                    pass
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    # Tactical Theater Coordinates (Israel Theater)
    LAT_MIN: float = 29.0
    LAT_MAX: float = 34.0
    LON_MIN: float = 33.5
    LON_MAX: float = 36.5

    # Latitude Zone Thresholds
    LAT_NORTH_MIN: float = 32.7000
    LAT_CENTER_MIN: float = 31.9000

    # Spatial Metrics
    VISIBILITY_RADIUS_METERS: float = 20000.0
    PROXIMITY_ALERT_RADIUS_METERS: float = 2000.0
    DEFAULT_THREAT_RADIUS_METERS: float = 150.0

    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), extra="ignore")


settings = Settings()
