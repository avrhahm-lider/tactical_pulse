import asyncio
from logging.config import fileConfig
import os
import sys

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.models import Base

# this is the Alembic Config object
config = context.config

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set database URL dynamically from app settings
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata

POSTGIS_SYSTEM_TABLES = {
    "spatial_ref_sys", "topology", "layer", "addr", "addrfeat", "bg",
    "county", "county_lookup", "countysub_lookup", "cousub", "direction_lookup",
    "edges", "faces", "featnames", "loader_lookuptables", "loader_platform",
    "loader_variables", "place", "place_lookup", "secondary_unit_lookup",
    "state", "state_lookup", "street_type_lookup", "tabblock", "tabblock20",
    "tract", "zcta5", "zip_lookup", "zip_lookup_all", "zip_lookup_base", "zip_state", "zip_state_loc"
}


def include_object(object, name, type_, reflected, compare_to):
    if type_ == "table":
        if (
            name in POSTGIS_SYSTEM_TABLES
            or name.startswith("tiger")
            or name.startswith("topology")
            or name.startswith("pagc_")
            or name.startswith("geocode_")
        ):
            return False
    return True


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
