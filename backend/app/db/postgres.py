from collections.abc import AsyncGenerator

from app.core.config import settings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    pool_size=5,
    max_overflow=5,
    pool_timeout=20,
    pool_recycle=300,
    pool_pre_ping=True,
)

async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def init_db() -> None:
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if conn.dialect.name == "postgresql":
            try:
                await conn.execute(
                    text("CREATE SEQUENCE IF NOT EXISTS soldier_id_seq START WITH 1000000 MAXVALUE 9999999")
                )
                await conn.execute(
                    text("ALTER TABLE soldiers ALTER COLUMN id SET DEFAULT lpad(nextval('soldier_id_seq')::text, 7, '0')")
                )
            except Exception as e:
                print(f"[INIT_DB WARNING] Sequence/default setup skipped: {e}")
