import asyncio
import os
import sys
from sqlalchemy import text

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from app.db.postgres import engine


async def run_migration():
    print("[MIGRATION] Applying schema updates to Supabase...")
    statements = [
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='soldiers' AND column_name='squad_id') THEN
                ALTER TABLE soldiers ADD COLUMN squad_id UUID REFERENCES users(id) ON DELETE SET NULL;
            END IF;

            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='soldiers' AND column_name='user_id') THEN
                UPDATE soldiers SET squad_id = user_id WHERE squad_id IS NULL AND user_id IS NOT NULL;
                ALTER TABLE soldiers ALTER COLUMN user_id DROP NOT NULL;
            END IF;
        END $$;
        """,
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='soldier_id') THEN
                ALTER TABLE users ADD COLUMN soldier_id VARCHAR(7) UNIQUE REFERENCES soldiers(id) ON DELETE SET NULL;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_logged_in') THEN
                ALTER TABLE users ADD COLUMN is_logged_in BOOLEAN NOT NULL DEFAULT FALSE;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_activity_at') THEN
                ALTER TABLE users ADD COLUMN last_activity_at TIMESTAMPTZ;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='session_id') THEN
                ALTER TABLE users ADD COLUMN session_id VARCHAR(64);
            END IF;
        END $$;
        """,
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='threats' AND column_name='created_by_soldier_id') THEN
                ALTER TABLE threats ADD COLUMN created_by_soldier_id VARCHAR(7) REFERENCES soldiers(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    ]
    async with engine.begin() as conn:
        for stmt in statements:
            await conn.execute(text(stmt.strip()))
    print("[MIGRATION SUCCESS] All columns and constraints successfully applied to Supabase!")


if __name__ == "__main__":
    asyncio.run(run_migration())
