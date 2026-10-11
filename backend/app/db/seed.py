import asyncio
import os
import sys
from datetime import datetime, timezone
from sqlalchemy import select, delete
from geoalchemy2.elements import WKTElement

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.db.postgres import async_session_maker, init_db
from app.core.security import hash_password
from app.models.user import User
from app.models.soldier import Soldier
from app.models.map_entity import MapEntity
from app.models.threat import Threat
from app.models.audit_log import AuditLog
from app.models.message import Message


async def seed_database() -> None:
    print("[SEED] Ensuring tables exist and seeding database according to API_CONTRACT.md...")
    await init_db()
    async with async_session_maker() as session:
        # Clear existing tactical data in dependency order
        await session.execute(delete(AuditLog))
        await session.execute(delete(Message))
        await session.execute(delete(Threat))
        await session.execute(delete(MapEntity))
        await session.execute(delete(Soldier))
        await session.execute(delete(User))
        await session.commit()

        # 1. Create Users
        admin = User(
            username="admin",
            password_hash=hash_password("admin123"),
            role="MainCommandCenter",
            area="Global",
            name="Main Command Center",
            description="HQ Supreme Operational Command",
            status="active",
        )
        cmd_north = User(
            username="command_north",
            password_hash=hash_password("command123"),
            role="AreaCommandCenter",
            area="North",
            name="Northern Command Center",
            description="Regional HQ Northern Sector",
            status="active",
        )
        cmd_center = User(
            username="command_center",
            password_hash=hash_password("command123"),
            role="AreaCommandCenter",
            area="Center",
            name="Central Command Center",
            description="Regional HQ Central Sector",
            status="active",
        )
        cmd_south = User(
            username="command_south",
            password_hash=hash_password("command123"),
            role="AreaCommandCenter",
            area="South",
            name="Southern Command Center",
            description="Regional HQ Southern Sector",
            status="active",
        )
        squad_golani = User(
            username="squad_golani",
            password_hash=hash_password("squad123"),
            role="Squad",
            area="Center",
            name="Golani Recon Squad",
            description="Elite forward reconnaissance patrol",
            status="active",
        )
        squad_paratroopers = User(
            username="squad_paratroopers",
            password_hash=hash_password("squad123"),
            role="SapperSquad",
            area="Center",
            name="Paratroopers Sapper Squad",
            description="Combat engineering & EOD assault unit",
            status="active",
        )
        radar_post = User(
            username="radar_post_1",
            password_hash=hash_password("radar123"),
            role="Radar",
            area="North",
            name="Hermon Radar Post 1",
            description="Northern border aerial surveillance post",
            status="active",
        )

        session.add_all([admin, cmd_north, cmd_center, cmd_south, squad_golani, squad_paratroopers, radar_post])
        await session.flush()

        # 2. Add Soldiers for Squads
        golani_soldiers = [
            Soldier(id="1000001", user_id=squad_golani.id, name="David Cohen", role="rifleman"),
            Soldier(id="1000002", user_id=squad_golani.id, name="Michael Levi", role="medic"),
            Soldier(id="1000003", user_id=squad_golani.id, name="Ron Katz", role="recon"),
        ]
        paratrooper_soldiers = [
            Soldier(id="2000001", user_id=squad_paratroopers.id, name="Ariel Mizrahi", role="rifleman"),
            Soldier(id="2000002", user_id=squad_paratroopers.id, name="Yossi Ben-David", role="sapper"),
            Soldier(id="2000003", user_id=squad_paratroopers.id, name="Daniel Peretz", role="sapper"),
        ]
        session.add_all(golani_soldiers + paratrooper_soldiers)

        # 3. Add Map Entities for Field Units and Regional Command Headquarters (SRID 4326: lon lat)
        map_entities = [
            MapEntity(
                id=cmd_north.id,
                geom=WKTElement("POINT(35.3000 33.0000)", srid=4326),
                heading=0.0,
                status="active",
            ),
            MapEntity(
                id=cmd_center.id,
                geom=WKTElement("POINT(34.8000 32.1000)", srid=4326),
                heading=0.0,
                status="active",
            ),
            MapEntity(
                id=cmd_south.id,
                geom=WKTElement("POINT(34.7000 31.2000)", srid=4326),
                heading=0.0,
                status="active",
            ),
            MapEntity(
                id=squad_golani.id,
                geom=WKTElement("POINT(34.7818 32.0853)", srid=4326),
                heading=90.0,
                status="active",
            ),
            MapEntity(
                id=squad_paratroopers.id,
                geom=WKTElement("POINT(34.7890 32.0920)", srid=4326),
                heading=180.0,
                status="active",
            ),
            MapEntity(
                id=radar_post.id,
                geom=WKTElement("POINT(35.5000 33.1500)", srid=4326),
                heading=45.0,
                status="active",
            ),
        ]
        session.add_all(map_entities)

        # 4. Add Initial Demo Threats
        threat_ied = Threat(
            type="immovable",
            name="IED Blockade Route 4",
            description="Suspicious explosive device spotted near crossroads",
            threat_type="explosive",
            severity_level="high",
            engagement_status="unassigned",
            assigned_to_id=None,
            geom=WKTElement(f"POINT(34.7800 32.0800)", srid=4326),
            altitude=None,
            radius=150.0,
            status="active",
            created_by_id=cmd_center.id,
        )
        threat_drone = Threat(
            type="movable",
            name="Hostile Recon Drone",
            description="Low-altitude hostile UAV detected entering northern airspace",
            threat_type="drone",
            severity_level="critical",
            engagement_status="unassigned",
            assigned_to_id=None,
            geom=WKTElement(f"POINT(35.5200 33.1800)", srid=4326),
            altitude=450.0,
            radius=300.0,
            status="active",
            created_by_id=radar_post.id,
        )
        session.add_all([threat_ied, threat_drone])

        # 5. Add initial audit log entry
        audit_init = AuditLog(
            user_id=admin.id,
            action="user_created",
            resource_type="system",
            details={"message": "Initial database seed completed successfully"},
        )
        session.add(audit_init)

        await session.commit()
        print("[SUCCESS] Database seeding complete! All users, squads, soldiers, and threats ready.")


if __name__ == "__main__":
    asyncio.run(seed_database())
