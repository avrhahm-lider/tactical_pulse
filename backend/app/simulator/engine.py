import asyncio
import math
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import delete, select, update

from app.core.security import hash_password
from app.db.postgres import async_session_maker
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.threat import Threat
from app.models.user import User
from app.schemas.threat import ThreatResponse
from app.services.spatial import calculate_area_from_lat, persist_squad_location
from app.sockets.server import (
    _ensure_threats_cache_loaded,
    broadcast_threat_event,
    broadcast_to_visibility_range,
    broadcast_unit_status_changed,
)

# Tactical Scenario Definitions

# Static ground threats
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

# Dynamic UAV / Drone patrol trajectories
DRONE_CONFIGS = [
    {
        "name": "Hostile Recon UAV Alpha",
        "severity": "critical",
        "radius": 180.0,
        "speed_kmh": 100.0,
        "key_points": [
            (32.0880, 34.7830, 380.0),
            (32.0960, 34.7840, 410.0),
            (32.1020, 34.7930, 440.0),
            (32.1000, 34.8040, 420.0),
            (32.0920, 34.8030, 390.0),
            (32.0860, 34.7940, 380.0),
            (32.0880, 34.7830, 380.0),
        ],
    },
    {
        "name": "Kamikaze Drone Bravo",
        "severity": "high",
        "radius": 160.0,
        "speed_kmh": 60.0,
        "key_points": [
            (32.0950, 34.7960, 250.0),
            (32.0990, 34.7910, 280.0),
            (32.0970, 34.7860, 260.0),
            (32.0920, 34.7890, 230.0),
            (32.0950, 34.7960, 250.0),
            (32.0910, 34.8030, 220.0),
            (32.0940, 34.8080, 240.0),
            (32.0980, 34.8040, 270.0),
            (32.0950, 34.7960, 250.0),
        ],
    },
]

# Ground combat squads
SQUAD_CONFIGS = [
    {
        "username": "squad_golani",
        "role": "Squad",
        "name": "Golani Recon Squad",
        "description": "Mobile motorized patrol (40 km/h)",
        "area": "Center",
        "speed_kmh": 40.0,
        "start_point": (32.0850, 34.7880),
        "soldier_id": "1000001",
        "soldier_name": "David Cohen",
        "soldier_role": "commander",
        "roster_ids": ["1000001", "1000002", "1000003"],
        "route": [
            (32.0850, 34.7880),
            (32.0920, 34.7820),
            (32.0915, 34.7875),
            (32.0990, 34.7880),
            (32.0920, 34.7940),
            (32.0850, 34.7880),
        ],
    },
    {
        "username": "squad_paratroopers",
        "role": "SapperSquad",
        "name": "Paratroopers Sapper Squad",
        "description": "Tactical EOD foot patrol (8 km/h)",
        "area": "Center",
        "speed_kmh": 8.0,
        "start_point": (32.0920, 34.7920),
        "soldier_id": "2000001",
        "soldier_name": "Ariel Mizrahi",
        "soldier_role": "commander",
        "roster_ids": ["2000001", "2000002", "2000003"],
        "route": [
            (32.0920, 34.7920),
            (32.0950, 34.7920),
            (32.0955, 34.7965),
            (32.0980, 34.7965),
            (32.0980, 34.8010),
            (32.0940, 34.8010),
            (32.0940, 34.7960),
            (32.0920, 34.7920),
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



def calculate_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lon = math.radians(lon2 - lon1)
    y = math.sin(d_lon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360) % 360, 1)


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
        self._bg_persist_tasks: set[asyncio.Task] = set()
        self._cached_entities: dict[str, Any] | None = None
        self._squad_names: dict[UUID, str] = {}
        self._precomputed_paths: dict[str, list] = {}
        self._init_precomputed_paths()

    def _init_precomputed_paths(self) -> None:
        """Precomputes tactical dense waypoint paths once at engine startup for 0ms latency."""
        for sc in SQUAD_CONFIGS:
            speed_kmh = sc.get("speed_kmh", 40.0)
            step_m = max(0.2, (speed_kmh / 3.6) * 0.25)
            self._precomputed_paths[sc["username"]] = interpolate_route(sc["route"], step_meters=step_m)
        for cfg in DRONE_CONFIGS:
            speed_kmh = cfg.get("speed_kmh", 100.0)
            step_m = max(0.5, (speed_kmh / 3.6) * 0.25)
            self._precomputed_paths[cfg["name"]] = interpolate_route(cfg["key_points"], step_meters=step_m)

    def _spawn_persist_task(self, coro):
        task = asyncio.create_task(coro)
        self._bg_persist_tasks.add(task)
        task.add_done_callback(self._bg_persist_tasks.discard)
        return task

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
            await persist_squad_location(squad_id, lat, lon, heading, area, now)
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

        # 2. Check danger perimeter breaches for squad (broadcasts to squad & command center)
        from app.sockets.server import (
            _connected_clients,
            check_and_broadcast_danger_alerts,
        )
        matching_sid = None
        for sid, client in list(_connected_clients.items()):
            if client.get("user_id") == squad_id:
                client["lat"] = lat
                client["lon"] = lon
                client["area"] = area
                matching_sid = sid
                break

        squad_name = self._squad_names.get(squad_id, "Combat Squad")
        squad_info = {
            "user_id": squad_id,
            "username": squad_name,
            "lat": lat,
            "lon": lon,
            "area": area,
        }
        await check_and_broadcast_danger_alerts(squad_sid=matching_sid, squad_info=squad_info)

        # 3. Throttle Postgres persistence: max once every 3.0s per squad
        squad_key = f"squad_{squad_id}"
        now_ts = asyncio.get_event_loop().time()
        if squad_key not in self._db_save_in_flight and (
            force_db or (now_ts - self._last_db_save.get(squad_key, 0.0) >= 3.0)
        ):
            self._last_db_save[squad_key] = now_ts
            self._spawn_persist_task(
                self._persist_squad_coords(squad_id, lat, lon, heading, area, now)
            )

    def stop_drone(self, threat_id: UUID | str) -> None:
        """
        Immediately halts autonomous flight loop and removes drone from simulation state when shot down.
        """
        tid_str = str(threat_id)
        drone_key = f"drone_{tid_str}"
        task = self._tasks.pop(drone_key, None)
        if task and not task.done():
            task.cancel()
        for k in list(self._latest_drone_state.keys()):
            if str(k) == tid_str:
                self._latest_drone_state.pop(k, None)
        self._step_indices.pop(tid_str, None)

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
        drone_key = f"drone_{threat_id}"
        # If flight task was cancelled / drone was shot down, ignore further tick updates
        if not force_db and drone_key not in self._tasks:
            return

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
        now_ts = asyncio.get_event_loop().time()
        if drone_key not in self._db_save_in_flight and (
            force_db or (now_ts - self._last_db_save.get(drone_key, 0.0) >= 3.0)
        ):
            self._last_db_save[drone_key] = now_ts
            self._spawn_persist_task(
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
                if f"drone_{threat_id}" not in self._tasks:
                    break
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

    async def _load_or_provision_entities(self) -> dict[str, Any]:
        """
        Batched retrieval and provisioning of all simulation entities.
        Executes minimal database roundtrips and caches in memory for zero-latency subsequent starts.
        """
        if self._cached_entities is not None:
            return self._cached_entities

        async with async_session_maker() as session:
            gt_names = [gt["name"] for gt in GROUND_THREATS]
            drone_names = [cfg["name"] for cfg in DRONE_CONFIGS]
            squad_usernames = [sc["username"] for sc in SQUAD_CONFIGS]
            all_threat_names = gt_names + drone_names

            # 1. Batched query for all threats & users in 2 queries
            threats_q = await session.execute(
                select(Threat, ST_Y(Threat.geom), ST_X(Threat.geom)).where(Threat.name.in_(all_threat_names))
            )
            existing_threats = {t.name: (t, lat, lon) for t, lat, lon in threats_q.all()}

            users_q = await session.execute(
                select(User).where(User.username.in_(squad_usernames + ["admin"]))
            )
            existing_users = {u.username: u for u in users_q.scalars().all()}

            # Creator resolution
            creator_user = existing_users.get("admin")
            if not creator_user:
                creator_user = (await session.execute(
                    select(User).where(User.role.in_(["MainCommandCenter", "AreaCommandCenter"])).limit(1)
                )).scalars().first()

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

            # 2. Provision missing ground threats
            ground_threat_list = []
            for gt in GROUND_THREATS:
                if gt["name"] in existing_threats:
                    t, lat, lon = existing_threats[gt["name"]]
                else:
                    t = Threat(
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
                    session.add(t)
                    await session.flush()
                    lat, lon = gt["lat"], gt["lon"]
                resp = ThreatResponse.from_threat(t, lat, lon)
                ground_threat_list.append({
                    "id": t.id,
                    "name": gt["name"],
                    "lat": lat,
                    "lon": lon,
                    "payload": resp.model_dump(mode="json"),
                })

            # 3. Provision missing dynamic UAV drones
            drone_list = []
            for cfg in DRONE_CONFIGS:
                first_pt = cfg["key_points"][0]
                if cfg["name"] in existing_threats:
                    d, lat, lon = existing_threats[cfg["name"]]
                else:
                    d = Threat(
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
                    session.add(d)
                    await session.flush()
                    lat, lon = first_pt[0], first_pt[1]
                resp = ThreatResponse.from_threat(d, lat, lon)
                drone_list.append({
                    "id": d.id,
                    "name": cfg["name"],
                    "cfg": cfg,
                    "first_pt": first_pt,
                    "payload": resp.model_dump(mode="json"),
                })

            # 4. Provision missing squads and map entities
            squad_list = []
            squad_ids_to_fetch_map = []
            for sc in SQUAD_CONFIGS:
                u = existing_users.get(sc["username"])
                if not u:
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

                    u = User(
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
                    session.add(u)
                    await session.flush()

                if "roster_ids" in sc:
                    await session.execute(
                        update(Soldier).where(Soldier.id.in_(sc["roster_ids"])).values(squad_id=u.id)
                    )

                squad_list.append({
                    "id": u.id,
                    "username": sc["username"],
                    "name": sc["name"],
                    "sc": sc,
                })
                self._squad_names[u.id] = sc["name"]
                squad_ids_to_fetch_map.append(u.id)

            # Batched map entity check
            existing_maps = {
                me.id: me
                for me in (await session.execute(
                    select(MapEntity).where(MapEntity.id.in_(squad_ids_to_fetch_map))
                )).scalars().all()
            }
            for sq in squad_list:
                start_pt = sq["sc"]["start_point"]
                me = existing_maps.get(sq["id"])
                if not me:
                    session.add(
                        MapEntity(
                            id=sq["id"],
                            geom=WKTElement(f"POINT({start_pt[1]} {start_pt[0]})", srid=4326),
                            heading=90.0,
                            status="active",
                        )
                    )
                else:
                    me.status = "active"
                    me.geom = WKTElement(f"POINT({start_pt[1]} {start_pt[0]})", srid=4326)

            await session.commit()

            # Synchronize active threats cache
            await _ensure_threats_cache_loaded(session)

            self._cached_entities = {
                "ground_threats": ground_threat_list,
                "drones": drone_list,
                "squads": squad_list,
            }
            return self._cached_entities

    async def _sync_entities_active_in_db(self, entities: dict[str, Any]) -> None:
        """Asynchronously updates database statuses without delaying the start response."""
        try:
            threat_ids = [gt["id"] for gt in entities["ground_threats"]] + [d["id"] for d in entities["drones"]]
            squad_ids = [sq["id"] for sq in entities["squads"]]
            async with async_session_maker() as session:
                await session.execute(
                    update(Threat)
                    .where(Threat.id.in_(threat_ids))
                    .values(status="active", engagement_status="unassigned")
                )
                await session.execute(
                    update(MapEntity)
                    .where(MapEntity.id.in_(squad_ids))
                    .values(status="active")
                )
                await session.commit()
                await _ensure_threats_cache_loaded(session)
        except Exception as e:
            print(f"[SIMULATOR DB SYNC ERROR] {e}")

    async def warmup(self) -> None:
        """Precomputes tactical paths in memory without populating DB until simulation starts."""
        self._init_precomputed_paths()
        print("[SIMULATOR] Engine ready (standing by for start).")

    async def start(self, mode: str = "all") -> dict[str, Any]:
        """
        Launches full tactical simulation instantaneously (zero UI freeze).
        Pre-interpolated routes and cached entities ensure immediate start.
        """
        await self.stop()
        self._is_running = True
        self._current_mode = mode

        entities = await self._load_or_provision_entities()

        # 1. Immediately emit threat active state so radar & map update
        for gt in entities["ground_threats"]:
            await broadcast_threat_event("threat_updated", gt["payload"])

        for d in entities["drones"]:
            await broadcast_threat_event("threat_updated", d["payload"])

        # Immediately emit active unit state so tactical map loads squads without refresh
        for sq in entities["squads"]:
            await broadcast_unit_status_changed(str(sq["id"]), "active")

        # 2. Launch squad patrol tasks with precomputed routes
        if mode in ["all", "squads"]:
            for sq in entities["squads"]:
                path = self._precomputed_paths.get(sq["username"])
                if path:
                    task_name = f"squad_{sq['username']}"
                    self._tasks[task_name] = asyncio.create_task(
                        self._run_squad_patrol(sq["username"], sq["id"], path, delay=0.25)
                    )

        # 3. Launch drone flight tasks with precomputed routes
        if mode in ["all", "drones"]:
            for d in entities["drones"]:
                path = self._precomputed_paths.get(d["name"])
                if path:
                    task_name = f"drone_{d['id']}"
                    self._tasks[task_name] = asyncio.create_task(
                        self._run_drone_flight(d["id"], path, d["cfg"], delay=0.25)
                    )

        # 4. Asynchronously update DB entity statuses in background
        self._spawn_persist_task(self._sync_entities_active_in_db(entities))

        return self.get_status()

    async def stop(self) -> dict[str, Any]:
        """
        Gracefully stops all simulation tasks instantaneously.
        Flushes final resting coordinates to DB in background.
        """
        for name, task in list(self._tasks.items()):
            task.cancel()
        self._tasks.clear()
        self._is_running = False
        self._current_mode = "stopped"

        # Final DB flush in background
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
            async def _flush_all():
                await asyncio.gather(*flush_tasks, return_exceptions=True)
            self._spawn_persist_task(_flush_all())

        return self.get_status()

    async def reset(self) -> dict[str, Any]:
        """Stops simulation tasks and completely purges simulation entities from map and DB."""
        await self.stop()
        self._cached_entities = None
        self._step_indices.clear()
        self._latest_squad_state.clear()
        self._latest_drone_state.clear()

        async with async_session_maker() as session:
            gt_names = [gt["name"] for gt in GROUND_THREATS]
            drone_names = [cfg["name"] for cfg in DRONE_CONFIGS]
            all_sim_threats = gt_names + drone_names

            threats_q = await session.execute(
                select(Threat).where(Threat.name.in_(all_sim_threats))
            )
            sim_threats = threats_q.scalars().all()
            for t in sim_threats:
                await broadcast_threat_event("threat_removed", {"id": str(t.id), "status": "inactive"})
            if sim_threats:
                await session.execute(delete(Threat).where(Threat.id.in_([t.id for t in sim_threats])))

            squad_usernames = [sc["username"] for sc in SQUAD_CONFIGS]
            squads_q = await session.execute(
                select(User).where(User.username.in_(squad_usernames))
            )
            squad_users = squads_q.scalars().all()
            squad_ids = [u.id for u in squad_users]
            if squad_ids:
                await session.execute(update(Soldier).where(Soldier.squad_id.in_(squad_ids)).values(squad_id=None))
                await session.execute(delete(MapEntity).where(MapEntity.id.in_(squad_ids)))
                for sid in squad_ids:
                    await broadcast_unit_status_changed(str(sid), "deleted")
                await session.execute(delete(User).where(User.id.in_(squad_ids)))

            await session.commit()
            await _ensure_threats_cache_loaded(session)

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

            squad_deltas = {
                "up": (delta, 0.0, 0.0),
                "down": (-delta, 0.0, 180.0),
                "right": (0.0, delta, 90.0),
                "left": (0.0, -delta, 270.0),
            }
            d_lat, d_lon, heading = squad_deltas.get(direction, (0.0, 0.0, 0.0))
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

            drone_deltas = {
                "up": (delta, 0.0, 0.0),
                "down": (-delta, 0.0, 0.0),
                "right": (0.0, delta, 0.0),
                "left": (0.0, -delta, 0.0),
                "alt_up": (0.0, 0.0, 20.0),
                "alt_down": (0.0, 0.0, -20.0),
            }
            d_lat, d_lon, d_alt = drone_deltas.get(direction, (0.0, 0.0, 0.0))
            new_lat = curr_lat + d_lat
            new_lon = curr_lon + d_lon
            new_alt = curr_alt + d_alt
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
