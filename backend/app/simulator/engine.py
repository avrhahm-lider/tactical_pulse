import asyncio
import math
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import select

from app.core.security import hash_password
from app.db.postgres import async_session_maker
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.threat import Threat
from app.models.user import User
from app.schemas.threat import ThreatResponse
from app.services.spatial import calculate_area_from_lat
from app.sockets.server import (
    _ensure_threats_cache_loaded,
    broadcast_threat_event,
    broadcast_to_visibility_range,
)

# ==============================================================================
# TACTICAL SCENARIO DEFINITION (PRESENTATION GRADE)
# ==============================================================================

# 1. Static Ground Threats (Minefields, Ambush Points with red danger zones)
GROUND_THREATS = [
    {
        "name": "Hostile Ambush Alpha",
        "type": "movable",
        "threat_type": "personnel",
        "severity_level": "critical",
        "radius": 220.0,
        "lat": 32.0915,
        "lon": 34.7875,
        "description": "Camouflaged anti-tank and sniper position overlooking central intersection",
    },
    {
        "name": "Minefield Perimeter Bravo",
        "type": "immovable",
        "threat_type": "explosive",
        "severity_level": "high",
        "radius": 200.0,
        "lat": 32.0955,
        "lon": 34.7965,
        "description": "Dense cluster of anti-vehicle mines and concealed IED tripwires",
    },
]

# 2. Dynamic UAV / Drone Patrol Trajectories (High-speed aerial sweeps)
DRONE_CONFIGS = [
    {
        "name": "Hostile Recon UAV Alpha",
        "severity": "critical",
        "radius": 180.0,
        "speed_kmh": 100.0,  # 100 km/h: ~6.94m per 250ms tick
        # Pattern 1: Wide Elliptical Reconnaissance Orbit (Овал)
        "key_points": [
            (32.0880, 34.7830, 380.0),  # SW apex (Start & Finish)
            (32.0960, 34.7840, 410.0),  # NW arc
            (32.1020, 34.7930, 440.0),  # North apex
            (32.1000, 34.8040, 420.0),  # NE arc
            (32.0920, 34.8030, 390.0),  # SE arc
            (32.0860, 34.7940, 380.0),  # South arc
            (32.0880, 34.7830, 380.0),  # Return to SW apex
        ],
    },
    {
        "name": "Kamikaze Drone Bravo",
        "severity": "high",
        "radius": 160.0,
        "speed_kmh": 60.0,  # 60 km/h: ~4.17m per 250ms tick
        # Pattern 2: Figure-8 / Infinity Lemniscate Loop (Восьмёрка)
        "key_points": [
            (32.0950, 34.7960, 250.0),  # Central crossover (Start & Finish)
            (32.0990, 34.7910, 280.0),  # West lobe top
            (32.0970, 34.7860, 260.0),  # West lobe apex
            (32.0920, 34.7890, 230.0),  # West lobe bottom
            (32.0950, 34.7960, 250.0),  # Central crossover
            (32.0910, 34.8030, 220.0),  # East lobe bottom
            (32.0940, 34.8080, 240.0),  # East lobe apex
            (32.0980, 34.8040, 270.0),  # East lobe top
            (32.0950, 34.7960, 250.0),  # Return to central crossover
        ],
    },
]

# 3. Ground Combat Squads (Realistic patrol profiles & paces)
SQUAD_CONFIGS = [
    {
        "username": "squad_golani",
        "role": "Squad",
        "name": "Golani Recon Squad",
        "description": "Mobile motorized patrol (40 km/h)",
        "area": "Center",
        "speed_kmh": 40.0,  # 40 km/h: ~2.78m per 250ms tick
        "start_point": (32.0850, 34.7880),
        "soldier_id": "1000001",
        "soldier_name": "David Cohen",
        "soldier_role": "commander",
        # Pattern 3: Diamond / Rhombus Perimeter Circuit (Ромб)
        # Enters Hostile Ambush Alpha (32.0915, 34.7875, r=220m) triggering tactical breach alerts
        "route": [
            (32.0850, 34.7880),  # South apex (Start & Finish)
            (32.0920, 34.7820),  # West apex
            (32.0915, 34.7875),  # INTRUSION: Penetrates Hostile Ambush Alpha perimeter!
            (32.0990, 34.7880),  # North apex
            (32.0920, 34.7940),  # East apex
            (32.0850, 34.7880),  # Return to South apex
        ],
    },
    {
        "username": "squad_paratroopers",
        "role": "SapperSquad",
        "name": "Paratroopers Sapper Squad",
        "description": "Tactical EOD foot patrol (8 km/h)",
        "area": "Center",
        "speed_kmh": 8.0,  # 8 km/h: ~0.56m per 250ms tick
        "start_point": (32.0920, 34.7920),
        "soldier_id": "2000001",
        "soldier_name": "Ariel Mizrahi",
        "soldier_role": "commander",
        # Pattern 4: Tactical Zig-Zag / Staircase Grid Sweep (Зигзаг / Ступенчатый сапёрный обход)
        # Penetrates Minefield Perimeter Bravo (32.0955, 34.7965, r=200m) for minefield reconnaissance
        "route": [
            (32.0920, 34.7920),  # Sector entry (Start & Finish)
            (32.0950, 34.7920),  # North step 1
            (32.0955, 34.7965),  # INTRUSION: Penetrates Minefield Perimeter Bravo!
            (32.0980, 34.7965),  # North step 2 (minefield sweep)
            (32.0980, 34.8010),  # East flank step
            (32.0940, 34.8010),  # South flank step
            (32.0940, 34.7960),  # West clearance step
            (32.0920, 34.7920),  # Return to sector entry
        ],
    },
]


def interpolate_route(key_points: list, step_meters: float = 1.0) -> list:
    """
    Subdivides 2D or 3D waypoints into smooth micro-steps.
    Supports closed loops ending at the start point without duplicate stationary steps.
    """
    dense = []
    n = len(key_points)
    if n < 2:
        return key_points

    # If the last waypoint is already the start point, interpolate n-1 segments.
    # Otherwise interpolate all n segments wrapping around back to index 0.
    is_explicitly_closed = (
        round(key_points[0][0], 6) == round(key_points[-1][0], 6)
        and round(key_points[0][1], 6) == round(key_points[-1][1], 6)
    )
    segments = n - 1 if is_explicitly_closed else n

    for i in range(segments):
        p1 = key_points[i]
        p2 = key_points[(i + 1) % n]
        d_lat_m = (p2[0] - p1[0]) * 111320.0
        d_lon_m = (p2[1] - p1[1]) * 111320.0 * math.cos(math.radians((p1[0] + p2[0]) / 2))
        dist_m = math.hypot(d_lat_m, d_lon_m)
        steps = max(1, int(dist_m / step_meters))
        has_alt = len(p1) > 2
        for s in range(steps):
            t = s / steps
            lat = round(p1[0] + (p2[0] - p1[0]) * t, 6)
            lon = round(p1[1] + (p2[1] - p1[1]) * t, 6)
            if has_alt:
                alt = round(p1[2] + (p2[2] - p1[2]) * t, 1)
                dense.append((lat, lon, alt))
            else:
                dense.append((lat, lon))
    return dense


interpolate_route_2d = interpolate_route
interpolate_route_3d = interpolate_route


def calculate_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lon = math.radians(lon2 - lon1)
    y = math.sin(d_lon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360) % 360, 1)


# ==============================================================================
# SIMULATION ENGINE CORE
# ==============================================================================

class SimulatorEngine:
    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._step_indices: dict[str, int] = {}
        self._is_running = False
        self._current_mode = "stopped"
        self._last_db_save: dict[str, float] = {}
        self._db_save_in_flight: set[str] = set()
        self._latest_squad_state: dict[UUID, tuple[float, float, float, str, datetime]] = {}
        self._latest_drone_state: dict[UUID, tuple[float, float, float, datetime]] = {}

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def mode(self) -> str:
        return self._current_mode

    def get_status(self) -> dict[str, Any]:
        return {
            "is_running": self._is_running,
            "mode": self._current_mode,
            "active_tasks": list(self._tasks.keys()),
            "squads_active": len([k for k in self._tasks if k.startswith("squad_")]),
            "drones_active": len([k for k in self._tasks if k.startswith("drone_")]),
        }

    async def _persist_squad_coords(
        self,
        squad_id: UUID,
        lat: float,
        lon: float,
        heading: float,
        area: str,
        now: datetime,
    ):
        key = f"squad_{squad_id}"
        self._db_save_in_flight.add(key)
        try:
            async with async_session_maker() as session:
                map_stmt = select(MapEntity).where(MapEntity.id == squad_id)
                map_res = await session.execute(map_stmt)
                map_ent = map_res.scalar_one_or_none()

                if map_ent:
                    map_ent.geom = WKTElement(f"POINT({lon} {lat})", srid=4326)
                    map_ent.heading = heading
                    map_ent.updated_at = now
                else:
                    map_ent = MapEntity(
                        id=squad_id,
                        geom=WKTElement(f"POINT({lon} {lat})", srid=4326),
                        heading=heading,
                        status="active",
                        updated_at=now,
                    )
                    session.add(map_ent)

                user_stmt = select(User).where(User.id == squad_id)
                user_res = await session.execute(user_stmt)
                user_obj = user_res.scalar_one_or_none()
                if user_obj and user_obj.area != area:
                    user_obj.area = area

                await session.commit()
        except Exception as e:
            print(f"[SIMULATOR DB ERROR] Error updating squad location: {e}")
        finally:
            self._db_save_in_flight.discard(key)

    async def _persist_drone_coords(
        self,
        threat_id: UUID,
        lat: float,
        lon: float,
        altitude: float,
        now: datetime,
    ):
        key = f"drone_{threat_id}"
        self._db_save_in_flight.add(key)
        try:
            async with async_session_maker() as session:
                stmt = select(Threat).where(Threat.id == threat_id)
                res = await session.execute(stmt)
                threat = res.scalar_one_or_none()
                if threat and threat.status == "active":
                    threat.geom = WKTElement(f"POINT({lon} {lat})", srid=4326)
                    threat.altitude = altitude
                    threat.updated_at = now
                    await session.commit()
        except Exception as e:
            print(f"[SIMULATOR DB ERROR] Error updating drone location: {e}")
        finally:
            self._db_save_in_flight.discard(key)

    async def update_squad_location(
        self,
        squad_id: UUID,
        lat: float,
        lon: float,
        heading: float,
        force_db: bool = False,
    ):
        """
        Pushes real-time squad telemetry via WebSockets and checks for threat breaches.
        Throttles PostgreSQL persistence to prevent connection pool exhaustion.
        """
        now = datetime.now(UTC)
        area = calculate_area_from_lat(lat)
        self._latest_squad_state[squad_id] = (lat, lon, heading, area, now)

        # 1. Emit squad_moved event
        payload = {
            "id": str(squad_id),
            "lat": lat,
            "lon": lon,
            "heading": heading,
            "area": area,
            "updated_at": now.isoformat(),
        }
        await broadcast_to_visibility_range(
            origin_lat=lat,
            origin_lon=lon,
            origin_area=area,
            event_name="squad_moved",
            payload=payload,
        )

        # 2. Check danger perimeter breaches for connected client of this squad
        from app.sockets.server import (
            _connected_clients,
            check_and_broadcast_danger_alerts,
        )
        for sid, client in list(_connected_clients.items()):
            if client.get("user_id") == squad_id:
                client["lat"] = lat
                client["lon"] = lon
                client["area"] = area
                await check_and_broadcast_danger_alerts(squad_sid=sid, squad_info=client)

        # 3. Throttle Postgres persistence: max once every 3.0s per squad
        squad_key = f"squad_{squad_id}"
        now_ts = asyncio.get_event_loop().time()
        if squad_key not in self._db_save_in_flight and (
            force_db or (now_ts - self._last_db_save.get(squad_key, 0.0) >= 3.0)
        ):
            self._last_db_save[squad_key] = now_ts
            asyncio.create_task(
                self._persist_squad_coords(squad_id, lat, lon, heading, area, now)
            )

    async def update_drone_location(
        self,
        threat_id: UUID,
        lat: float,
        lon: float,
        altitude: float,
        name: str = "Hostile UAV",
        severity: str = "critical",
        radius: float = 180.0,
        force_db: bool = False,
    ):
        """
        Pushes real-time UAV aerial telemetry and tests proximity danger checks.
        Throttles PostgreSQL persistence to prevent connection pool exhaustion.
        """
        now = datetime.now(UTC)
        self._latest_drone_state[threat_id] = (lat, lon, altitude, now)

        payload = {
            "id": str(threat_id),
            "name": name,
            "threat_type": "drone",
            "severity_level": severity,
            "engagement_status": "unassigned",
            "radius": radius,
            "altitude": altitude,
            "lat": lat,
            "lon": lon,
            "status": "active",
            "updated_at": now.isoformat(),
        }
        await broadcast_threat_event("threat_updated", payload)

        # Throttle Postgres persistence: max once every 3.0s per drone
        drone_key = f"drone_{threat_id}"
        now_ts = asyncio.get_event_loop().time()
        if drone_key not in self._db_save_in_flight and (
            force_db or (now_ts - self._last_db_save.get(drone_key, 0.0) >= 3.0)
        ):
            self._last_db_save[drone_key] = now_ts
            asyncio.create_task(
                self._persist_drone_coords(threat_id, lat, lon, altitude, now)
            )

    async def _run_squad_patrol(self, squad_username: str, squad_id: UUID, path: list, delay: float = 0.25):
        """
        Autonomous squad patrol along pre-interpolated closed-loop tactical path at configured speed.
        """
        total = len(path)
        step = self._step_indices.get(squad_username, 0)
        try:
            while True:
                curr_lat, curr_lon = path[step % total]
                next_lat, next_lon = path[(step + 1) % total]
                heading = calculate_heading(curr_lat, curr_lon, next_lat, next_lon)

                await self.update_squad_location(squad_id, curr_lat, curr_lon, heading)
                step += 1
                self._step_indices[squad_username] = step
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            pass

    async def _run_drone_flight(self, threat_id: UUID, path: list, cfg: dict, delay: float = 0.25):
        """
        Autonomous UAV reconnaissance flight along pre-interpolated closed-loop trajectory at configured speed.
        """
        total = len(path)
        step = self._step_indices.get(str(threat_id), 0)
        try:
            while True:
                lat, lon, alt = path[step % total]
                await self.update_drone_location(
                    threat_id=threat_id,
                    lat=lat,
                    lon=lon,
                    altitude=alt,
                    name=cfg.get("name", "Hostile UAV"),
                    severity=cfg.get("severity", "critical"),
                    radius=cfg.get("radius", 180.0),
                )
                step += 1
                self._step_indices[str(threat_id)] = step
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            pass

    async def start(self, mode: str = "all") -> dict[str, Any]:
        """
        Launches full tactical simulation.
        Automatically provisions:
          - 2 static ground threats (Hostile Ambush Alpha, Minefield Perimeter Bravo)
          - 2 high-speed UAV reconnaissance drones
          - 2 active field squads (Golani & Paratroopers)
        """
        await self.stop()
        self._is_running = True
        self._current_mode = mode

        async with async_session_maker() as session:
            # 0. Ensure command authority user exists for threat attribution
            creator_stmt = select(User).where(User.role.in_(["MainCommandCenter", "AreaCommandCenter"]))
            creator_user = (await session.execute(creator_stmt)).scalars().first()
            if not creator_user:
                creator_user = (await session.execute(select(User))).scalars().first()

            if not creator_user:
                soldier_admin = Soldier(id="9990001", name="Gen. Eyal Zamir", role="commander")
                session.add(soldier_admin)
                await session.flush()
                creator_user = User(
                    username="admin",
                    password_hash=hash_password("admin123"),
                    role="MainCommandCenter",
                    area="Global",
                    name="Main Command Center",
                    description="HQ Supreme Operational Command",
                    soldier_id=soldier_admin.id,
                    status="active",
                    is_logged_in=False,
                )
                session.add(creator_user)
                await session.flush()

            creator_id = creator_user.id
            creator_soldier_id = creator_user.soldier_id

            # 1. Provision / activate static ground threats
            for gt in GROUND_THREATS:
                stmt = select(Threat).where(Threat.name == gt["name"])
                threat = (await session.execute(stmt)).scalar_one_or_none()
                if not threat:
                    threat = Threat(
                        type=gt["type"],
                        name=gt["name"],
                        description=gt.get("description"),
                        threat_type=gt["threat_type"],
                        severity_level=gt["severity_level"],
                        status="active",
                        engagement_status="unassigned",
                        radius=gt["radius"],
                        geom=WKTElement(f"POINT({gt['lon']} {gt['lat']})", srid=4326),
                        created_by_id=creator_id,
                        created_by_soldier_id=creator_soldier_id,
                    )
                    session.add(threat)
                    await session.commit()
                    await session.refresh(threat)
                    resp = ThreatResponse.from_threat(threat, gt["lat"], gt["lon"])
                    await broadcast_threat_event("threat_created", resp.model_dump(mode="json"))
                elif threat.status != "active":
                    threat.status = "active"
                    threat.engagement_status = "unassigned"
                    await session.commit()
                    resp = ThreatResponse.from_threat(threat, gt["lat"], gt["lon"])
                    await broadcast_threat_event("threat_updated", resp.model_dump(mode="json"))

            # 2. Provision / activate dynamic UAV drones
            drones_stmt = select(Threat).where(Threat.threat_type == "drone")
            existing_drones = list((await session.execute(drones_stmt)).scalars().all())

            active_drones = []
            for cfg in DRONE_CONFIGS:
                d_match = next((d for d in existing_drones if d.name == cfg["name"]), None)
                first_pt = cfg["key_points"][0]
                if not d_match:
                    d_match = Threat(
                        type="movable",
                        name=cfg["name"],
                        threat_type="drone",
                        severity_level=cfg["severity"],
                        status="active",
                        engagement_status="unassigned",
                        radius=cfg["radius"],
                        altitude=first_pt[2],
                        geom=WKTElement(f"POINT({first_pt[1]} {first_pt[0]})", srid=4326),
                        created_by_id=creator_id,
                        created_by_soldier_id=creator_soldier_id,
                    )
                    session.add(d_match)
                    await session.commit()
                    await session.refresh(d_match)
                    resp = ThreatResponse.from_threat(d_match, first_pt[0], first_pt[1])
                    await broadcast_threat_event("threat_created", resp.model_dump(mode="json"))
                elif d_match.status != "active":
                    d_match.status = "active"
                    d_match.engagement_status = "unassigned"
                    await session.commit()
                    resp = ThreatResponse.from_threat(d_match, first_pt[0], first_pt[1])
                    await broadcast_threat_event("threat_updated", resp.model_dump(mode="json"))
                active_drones.append((d_match, cfg))

            # 3. Provision / ensure field squads exist in DB
            active_squad_users = []
            for sc in SQUAD_CONFIGS:
                user_stmt = select(User).where(User.username == sc["username"])
                user = (await session.execute(user_stmt)).scalar_one_or_none()

                if not user:
                    # Create soldier first if needed
                    s_stmt = select(Soldier).where(Soldier.id == sc["soldier_id"])
                    soldier = (await session.execute(s_stmt)).scalar_one_or_none()
                    if not soldier:
                        soldier = Soldier(
                            id=sc["soldier_id"],
                            name=sc["soldier_name"],
                            role=sc["soldier_role"],
                        )
                        session.add(soldier)
                        await session.flush()

                    user = User(
                        username=sc["username"],
                        password_hash=hash_password("squad123"),
                        role=sc["role"],
                        area=sc["area"],
                        name=sc["name"],
                        description=sc["description"],
                        soldier_id=sc["soldier_id"],
                        status="active",
                        is_logged_in=False,
                    )
                    session.add(user)
                    await session.flush()

                # Ensure squad has MapEntity reset to route start point
                map_stmt = select(MapEntity).where(MapEntity.id == user.id)
                map_ent = (await session.execute(map_stmt)).scalar_one_or_none()
                start_pt = sc["start_point"]
                if not map_ent:
                    map_ent = MapEntity(
                        id=user.id,
                        geom=WKTElement(f"POINT({start_pt[1]} {start_pt[0]})", srid=4326),
                        heading=90.0,
                        status="active",
                    )
                    session.add(map_ent)
                    await session.flush()
                else:
                    map_ent.geom = WKTElement(f"POINT({start_pt[1]} {start_pt[0]})", srid=4326)
                    map_ent.status = "active"
                    await session.flush()

                active_squad_users.append((user, sc))

            await session.commit()

            # 4. Synchronize memory threat cache for instant danger zone detection
            await _ensure_threats_cache_loaded(session)

        # 5. Launch squad patrol tasks with exact speed configuration
        if mode in ["all", "squads"]:
            for u, sc in active_squad_users:
                speed_kmh = sc.get("speed_kmh", 40.0)
                step_m = max(0.2, (speed_kmh / 3.6) * 0.25)
                dense_path = interpolate_route_2d(sc["route"], step_meters=step_m)
                task_name = f"squad_{u.username}"
                self._tasks[task_name] = asyncio.create_task(
                    self._run_squad_patrol(u.username, u.id, dense_path, delay=0.25)
                )

        # 6. Launch drone flight tasks with exact speed configuration
        if mode in ["all", "drones"]:
            for d, cfg in active_drones:
                speed_kmh = cfg.get("speed_kmh", 100.0)
                step_m = max(0.5, (speed_kmh / 3.6) * 0.25)
                dense_path = interpolate_route_3d(cfg["key_points"], step_meters=step_m)
                task_name = f"drone_{d.id}"
                self._tasks[task_name] = asyncio.create_task(
                    self._run_drone_flight(d.id, dense_path, cfg, delay=0.25)
                )

        return self.get_status()

    async def stop(self) -> dict[str, Any]:
        """
        Gracefully stops all simulation tasks and flushes final resting coordinates to DB.
        """
        for name, task in list(self._tasks.items()):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
        self._is_running = False
        self._current_mode = "stopped"

        # Final DB flush so resting coordinates are saved
        flush_tasks = []
        for squad_id, (lat, lon, heading, area, now) in list(self._latest_squad_state.items()):
            flush_tasks.append(
                self._persist_squad_coords(squad_id, lat, lon, heading, area, now)
            )
        for threat_id, (lat, lon, altitude, now) in list(self._latest_drone_state.items()):
            flush_tasks.append(
                self._persist_drone_coords(threat_id, lat, lon, altitude, now)
            )
        if flush_tasks:
            await asyncio.gather(*flush_tasks, return_exceptions=True)

        return self.get_status()

    async def manual_step(
        self,
        target_type: str,
        target_id: UUID,
        direction: str,
        delta: float = 0.0005,
    ) -> dict[str, Any]:
        """
        Manual step for nudging a single squad or drone (e.g. from telemetry D-Pad).
        """
        if target_type == "squad":
            async with async_session_maker() as session:
                map_stmt = select(MapEntity).where(MapEntity.id == target_id)
                map_res = await session.execute(map_stmt)
                map_ent = map_res.scalar_one_or_none()
                if not map_ent:
                    return {"error": "Squad MapEntity not found"}

                coords = (await session.execute(select(ST_Y(map_ent.geom), ST_X(map_ent.geom)))).first()
                curr_lat, curr_lon = coords[0], coords[1]

            d_lat = delta if direction == "up" else (-delta if direction == "down" else 0.0)
            d_lon = delta if direction == "right" else (-delta if direction == "left" else 0.0)
            heading = (
                0.0 if direction == "up"
                else (180.0 if direction == "down"
                else (90.0 if direction == "right"
                else 270.0))
            )

            new_lat = curr_lat + d_lat
            new_lon = curr_lon + d_lon
            await self.update_squad_location(target_id, new_lat, new_lon, heading, force_db=True)
            return {
                "status": "ok",
                "target_id": str(target_id),
                "lat": new_lat,
                "lon": new_lon,
                "heading": heading,
            }

        elif target_type == "drone":
            async with async_session_maker() as session:
                stmt = select(Threat).where(Threat.id == target_id)
                threat = (await session.execute(stmt)).scalar_one_or_none()
                if not threat:
                    return {"error": "Drone not found"}

                coords = (await session.execute(select(ST_Y(threat.geom), ST_X(threat.geom)))).first()
                curr_lat, curr_lon = coords[0], coords[1]
                curr_alt = threat.altitude or 300.0

            d_lat = delta if direction == "up" else (-delta if direction == "down" else 0.0)
            d_lon = delta if direction == "right" else (-delta if direction == "left" else 0.0)
            new_alt = curr_alt + (20.0 if direction == "alt_up" else (-20.0 if direction == "alt_down" else 0.0))

            new_lat = curr_lat + d_lat
            new_lon = curr_lon + d_lon
            await self.update_drone_location(target_id, new_lat, new_lon, new_alt, force_db=True)
            return {
                "status": "ok",
                "threat_id": str(target_id),
                "lat": new_lat,
                "lon": new_lon,
                "altitude": new_alt,
            }

        return {"error": "Unknown target_type"}


# Global singleton engine
simulator_engine = SimulatorEngine()
