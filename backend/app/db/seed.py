import asyncio
import os
import sys

from geoalchemy2.elements import WKTElement
from sqlalchemy import select

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.core.security import hash_password
from app.db.postgres import async_session_maker, init_db
from app.models.audit_log import AuditLog
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.threat import Threat
from app.models.user import User

DEFAULT_SOLDIERS = [
    {"id": "9990001", "name": "Gen. Eyal Zamir", "role": "commander"},
    {"id": "9990002", "name": "Maj. Tomer Bar", "role": "operator"},
    {"id": "9990003", "name": "Capt. Sarah Cohen", "role": "operator"},
    {"id": "9990004", "name": "Lt. Dan Sharon", "role": "operator"},
    {"id": "1000001", "name": "David Cohen", "role": "commander"},
    {"id": "1000002", "name": "Michael Levi", "role": "medic"},
    {"id": "1000003", "name": "Ron Katz", "role": "recon"},
    {"id": "2000001", "name": "Ariel Mizrahi", "role": "commander"},
    {"id": "2000002", "name": "Yossi Ben-David", "role": "sapper"},
    {"id": "2000003", "name": "Daniel Peretz", "role": "sapper"},
    {"id": "3000001", "name": "Noam Ben-Ari", "role": "operator"},
]

DEFAULT_USERS = [
    {
        "username": "admin",
        "password": "admin123",
        "role": "MainCommandCenter",
        "area": "Global",
        "name": "Main Command Center",
        "description": "HQ Supreme Operational Command",
        "soldier_id": "9990001",
    },
    {
        "username": "command_north",
        "password": "command123",
        "role": "AreaCommandCenter",
        "area": "North",
        "name": "Northern Command Center",
        "description": "Regional HQ Northern Sector",
        "soldier_id": "9990002",
        "map_point": "POINT(35.3000 33.0000)",
        "heading": 0.0,
    },
    {
        "username": "command_center",
        "password": "command123",
        "role": "AreaCommandCenter",
        "area": "Center",
        "name": "Central Command Center",
        "description": "Regional HQ Central Sector",
        "soldier_id": "9990003",
        "map_point": "POINT(34.8000 32.1000)",
        "heading": 0.0,
    },
    {
        "username": "command_south",
        "password": "command123",
        "role": "AreaCommandCenter",
        "area": "South",
        "name": "Southern Command Center",
        "description": "Regional HQ Southern Sector",
        "soldier_id": "9990004",
        "map_point": "POINT(34.7000 31.2000)",
        "heading": 0.0,
    },
    {
        "username": "squad_golani",
        "password": "squad123",
        "role": "Squad",
        "area": "Center",
        "name": "Golani Recon Squad",
        "description": "Elite forward reconnaissance patrol",
        "soldier_id": "1000001",
        "squad_soldier_ids": ["1000001", "1000002", "1000003"],
        "map_point": "POINT(34.7818 32.0853)",
        "heading": 90.0,
    },
    {
        "username": "squad_paratroopers",
        "password": "squad123",
        "role": "SapperSquad",
        "area": "Center",
        "name": "Paratroopers Sapper Squad",
        "description": "Combat engineering & EOD assault unit",
        "soldier_id": "2000001",
        "squad_soldier_ids": ["2000001", "2000002", "2000003"],
        "map_point": "POINT(34.7890 32.0920)",
        "heading": 180.0,
    },
    {
        "username": "radar_post_1",
        "password": "radar123",
        "role": "Radar",
        "area": "North",
        "name": "Hermon Radar Post 1",
        "description": "Northern border aerial surveillance post",
        "soldier_id": "3000001",
        "squad_soldier_ids": ["3000001"],
        "map_point": "POINT(35.5000 33.1500)",
        "heading": 45.0,
    },
]


async def seed_database() -> None:
    print("[SEED] Ensuring tables exist and upserting standard seed data (preserving user accounts)...")
    await init_db()
    async with async_session_maker() as session:
        # 1. Upsert default soldiers (personnel registry) without touching existing custom soldiers
        for s_def in DEFAULT_SOLDIERS:
            s_stmt = select(Soldier).where(Soldier.id == s_def["id"])
            soldier = (await session.execute(s_stmt)).scalar_one_or_none()
            if not soldier:
                session.add(Soldier(id=s_def["id"], name=s_def["name"], role=s_def["role"], squad_id=None))
            else:
                soldier.name = s_def["name"]
                soldier.role = s_def["role"]
        await session.flush()

        # 2. Upsert default system users without deleting user-created accounts
        user_map: dict[str, User] = {}
        for u_def in DEFAULT_USERS:
            u_stmt = select(User).where(User.username == u_def["username"])
            user = (await session.execute(u_stmt)).scalar_one_or_none()
            if not user:
                user = User(
                    username=u_def["username"],
                    password_hash=hash_password(u_def["password"]),
                    role=u_def["role"],
                    area=u_def["area"],
                    name=u_def["name"],
                    description=u_def.get("description"),
                    soldier_id=u_def.get("soldier_id"),
                    status="active",
                    is_logged_in=False,
                )
                session.add(user)
            else:
                user.password_hash = hash_password(u_def["password"])
                user.role = u_def["role"]
                user.area = u_def["area"]
                user.name = u_def["name"]
                user.description = u_def.get("description")
                user.soldier_id = u_def.get("soldier_id")
                user.status = "active"
                user.is_logged_in = False
                user.session_id = None
                user.last_activity_at = None
            user_map[u_def["username"]] = user
        await session.flush()

        # 3. Assign roster soldiers to default squad units
        for u_def in DEFAULT_USERS:
            if "squad_soldier_ids" in u_def:
                u_obj = user_map[u_def["username"]]
                for s_id in u_def["squad_soldier_ids"]:
                    s_obj = (await session.execute(select(Soldier).where(Soldier.id == s_id))).scalar_one_or_none()
                    if s_obj:
                        s_obj.squad_id = u_obj.id
        await session.flush()

        # 4. Upsert Map Entities for default units & commands
        for u_def in DEFAULT_USERS:
            if "map_point" in u_def:
                u_obj = user_map[u_def["username"]]
                me = (await session.execute(select(MapEntity).where(MapEntity.id == u_obj.id))).scalar_one_or_none()
                if not me:
                    session.add(
                        MapEntity(
                            id=u_obj.id,
                            geom=WKTElement(u_def["map_point"], srid=4326),
                            heading=u_def.get("heading", 0.0),
                            status="active",
                        )
                    )
                else:
                    me.status = "active"
                    me.geom = WKTElement(u_def["map_point"], srid=4326)
        await session.flush()

        # 5. Ensure default demo threats exist
        t_ied = (await session.execute(select(Threat).where(Threat.name == "IED Blockade Route 4"))).scalar_one_or_none()
        if not t_ied:
            cmd_center = user_map["command_center"]
            session.add(
                Threat(
                    type="immovable",
                    name="IED Blockade Route 4",
                    description="Suspicious explosive device spotted near crossroads",
                    threat_type="explosive",
                    severity_level="high",
                    engagement_status="unassigned",
                    assigned_to_id=None,
                    geom=WKTElement("POINT(34.7800 32.0800)", srid=4326),
                    altitude=None,
                    radius=150.0,
                    status="active",
                    created_by_id=cmd_center.id,
                    created_by_soldier_id="9990003",
                )
            )

        t_drone = (await session.execute(select(Threat).where(Threat.name == "Hostile Recon Drone"))).scalar_one_or_none()
        if not t_drone:
            radar_post = user_map["radar_post_1"]
            session.add(
                Threat(
                    type="movable",
                    name="Hostile Recon Drone",
                    description="Low-altitude hostile UAV detected entering northern airspace",
                    threat_type="drone",
                    severity_level="critical",
                    engagement_status="unassigned",
                    assigned_to_id=None,
                    geom=WKTElement("POINT(35.5200 33.1800)", srid=4326),
                    altitude=450.0,
                    radius=300.0,
                    status="active",
                    created_by_id=radar_post.id,
                    created_by_soldier_id="3000001",
                )
            )

        # 6. Audit log entry
        admin_obj = user_map["admin"]
        audit_init = AuditLog(
            user_id=admin_obj.id,
            action="system_seeded",
            resource_type="system",
            details={"message": "System seed upsert completed successfully"},
        )
        session.add(audit_init)

        await session.commit()
        print("[SUCCESS] Database seeding complete (safe upsert)! Existing users and soldiers preserved.")


if __name__ == "__main__":
    asyncio.run(seed_database())
