import asyncio
import os
import sys

from sqlalchemy import delete, select, update

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.postgres import async_session_maker, init_db
from app.models.audit_log import AuditLog
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.threat import Threat
from app.models.user import User

ALLOWED_USERNAMES = {
    "admin",
    "command_north",
    "command_center",
    "command_south",
    "radar_post_1",
}

PRESERVED_SOLDIERS = {
    "9990001": ("Gen. Eyal Zamir", "commander"),
    "9990002": ("Maj. Tomer Bar", "operator"),
    "9990003": ("Capt. Sarah Cohen", "operator"),
    "9990004": ("Lt. Dan Sharon", "operator"),
    "3000001": ("Noam Ben-Ari", "operator"),
    "1000001": ("David Cohen", "commander"),
    "1000002": ("Michael Levi", "medic"),
    "1000003": ("Ron Katz", "recon"),
    "2000001": ("Ariel Mizrahi", "commander"),
    "2000002": ("Yossi Ben-David", "sapper"),
    "2000003": ("Daniel Peretz", "sapper"),
}


async def purge_database():
    print("[PURGE] Initializing DB connection...")
    await init_db()

    async with async_session_maker() as session:
        # 1. Delete all threats
        print("[PURGE] Deleting all threats...")
        await session.execute(delete(Threat))

        # 2. Delete all audit logs
        print("[PURGE] Deleting audit logs...")
        await session.execute(delete(AuditLog))

        # 3. Unlink soldiers squad_id
        print("[PURGE] Resetting soldier squad links...")
        await session.execute(update(Soldier).values(squad_id=None))

        # 4. Find users to remove
        all_users = (await session.execute(select(User))).scalars().all()
        users_to_delete = [u for u in all_users if u.username not in ALLOWED_USERNAMES]
        ids_to_delete = [u.id for u in users_to_delete]

        print(f"[PURGE] Deleting {len(ids_to_delete)} users: {[u.username for u in users_to_delete]}")

        # Delete map entities of deleted users
        if ids_to_delete:
            await session.execute(delete(MapEntity).where(MapEntity.id.in_(ids_to_delete)))
            await session.execute(delete(User).where(User.id.in_(ids_to_delete)))

        # 5. Clean up soldiers: delete non-preserved soldiers
        all_soldiers = (await session.execute(select(Soldier))).scalars().all()
        soldiers_to_delete = [s.id for s in all_soldiers if s.id not in PRESERVED_SOLDIERS]
        if soldiers_to_delete:
            print(f"[PURGE] Deleting {len(soldiers_to_delete)} obsolete soldiers: {soldiers_to_delete}")
            await session.execute(delete(Soldier).where(Soldier.id.in_(soldiers_to_delete)))

        # Upsert / refresh the 11 preserved soldiers
        for s_id, (name, role) in PRESERVED_SOLDIERS.items():
            existing = (await session.execute(select(Soldier).where(Soldier.id == s_id))).scalar_one_or_none()
            if not existing:
                session.add(Soldier(id=s_id, name=name, role=role, squad_id=None))
            else:
                existing.name = name
                existing.role = role
                existing.squad_id = None

        # 6. Reset session & login state for preserved users
        remaining_users = (await session.execute(select(User))).scalars().all()
        for u in remaining_users:
            u.is_logged_in = False
            u.session_id = None
            u.last_activity_at = None

        await session.commit()
        print("[PURGE] Database cleanup complete! Preserved 5 core users and 11 IDF soldiers.")


if __name__ == "__main__":
    asyncio.run(purge_database())
