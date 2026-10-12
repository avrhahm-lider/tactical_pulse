import asyncio
import math
from datetime import datetime, timezone
from typing import Dict, Any
from uuid import UUID
from sqlalchemy import select
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y

from app.db.postgres import async_session_maker
from app.models.user import User
from app.models.map_entity import MapEntity
from app.models.threat import Threat
from app.schemas.threat import ThreatResponse
from app.services.spatial import calculate_area_from_lat
from app.sockets.server import (
    broadcast_to_visibility_range,
    broadcast_threat_event,
)

# ==============================================================================
# WAYPOINTS & TRAJECTORIES
# ==============================================================================

SQUAD_ROUTES = {
    "squad_golani": [
        (32.0853, 34.7818),
        (32.0880, 34.7845),
        (32.0915, 34.7875),
        (32.0945, 34.7910),
        (32.0935, 34.7945),
        (32.0905, 34.7925),
        (32.0875, 34.7870),
    ],
    "squad_paratroopers": [
        (32.0920, 34.7890),
        (32.0945, 34.7925),
        (32.0970, 34.7965),
        (32.0985, 34.8000),
        (32.0955, 34.8025),
        (32.0925, 34.7995),
        (32.0905, 34.7945),
        (32.0910, 34.7910),
    ],
}

DRONE_CONFIGS = [
    {
        "name": "Hostile UAV Alpha",
        "severity": "critical",
        "radius": 200.0,
        "key_points": [
            (32.0985, 34.8000, 350.0),
            (32.1150, 34.8150, 420.0),
            (32.1300, 34.8100, 450.0),
            (32.1100, 34.7950, 390.0),
            (32.0960, 34.7950, 360.0),
        ],
    },
    {
        "name": "Hostile UAV Bravo",
        "severity": "high",
        "radius": 150.0,
        "key_points": [
            (32.0800, 34.7500, 320.0),
            (32.1000, 34.7550, 340.0),
            (32.1200, 34.7600, 330.0),
            (32.1050, 34.7750, 325.0),
            (32.0850, 34.7650, 315.0),
        ],
    },
    {
        "name": "Kamikaze Drone Charlie",
        "severity": "critical",
        "radius": 250.0,
        "key_points": [
            (32.0920, 34.7890, 180.0),
            (32.0980, 34.7980, 220.0),
            (32.1060, 34.8080, 260.0),
            (32.0940, 34.7904, 210.0),
            (32.0865, 34.7830, 190.0),
        ],
    },
]


def interpolate_route_2d(key_points: list, step_meters: float = 25.0) -> list:
    dense_path = []
    num_pts = len(key_points)
    for i in range(num_pts):
        lat1, lon1 = key_points[i]
        lat2, lon2 = key_points[(i + 1) % num_pts]

        d_lat_m = (lat2 - lat1) * 111320.0
        d_lon_m = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
        segment_dist_m = math.sqrt(d_lat_m**2 + d_lon_m**2)

        sub_steps = max(1, int(segment_dist_m / step_meters))
        for s in range(sub_steps):
            t = s / sub_steps
            lat = lat1 + (lat2 - lat1) * t
            lon = lon1 + (lon2 - lon1) * t
            dense_path.append((round(lat, 6), round(lon, 6)))
    return dense_path


def interpolate_route_3d(key_points: list, step_meters: float = 70.0) -> list:
    dense_path = []
    num_pts = len(key_points)
    for i in range(num_pts):
        lat1, lon1, alt1 = key_points[i]
        lat2, lon2, alt2 = key_points[(i + 1) % num_pts]

        d_lat_m = (lat2 - lat1) * 111320.0
        d_lon_m = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
        segment_dist_m = math.sqrt(d_lat_m**2 + d_lon_m**2)

        sub_steps = max(1, int(segment_dist_m / step_meters))
        for s in range(sub_steps):
            t = s / sub_steps
            lat = lat1 + (lat2 - lat1) * t
            lon = lon1 + (lon2 - lon1) * t
            alt = alt1 + (alt2 - alt1) * t
            dense_path.append((round(lat, 6), round(lon, 6), round(alt, 1)))
    return dense_path


def calculate_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lon = math.radians(lon2 - lon1)
    y = math.sin(d_lon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360) % 360, 1)


# ==============================================================================
# SIMULATION ENGINE STATE
# ==============================================================================

class SimulatorEngine:
    def __init__(self):
        self._tasks: Dict[str, asyncio.Task] = {}
        self._step_indices: Dict[str, int] = {}
        self._is_running = False
        self._current_mode = "stopped"

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def mode(self) -> str:
        return self._current_mode

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self._is_running,
            "mode": self._current_mode,
            "active_tasks": list(self._tasks.keys()),
        }

    async def update_squad_location(self, squad_id: UUID, lat: float, lon: float, heading: float):
        now = datetime.now(timezone.utc)
        area = calculate_area_from_lat(lat)

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

        # Broadcast live movement to map
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

    async def update_drone_location(self, threat_id: UUID, lat: float, lon: float, altitude: float):
        now = datetime.now(timezone.utc)
        async with async_session_maker() as session:
            stmt = select(Threat).where(Threat.id == threat_id)
            res = await session.execute(stmt)
            threat = res.scalar_one_or_none()
            if not threat or threat.status != "active":
                return

            threat.geom = WKTElement(f"POINT({lon} {lat})", srid=4326)
            threat.altitude = altitude
            threat.updated_at = now
            await session.commit()
            await session.refresh(threat)

            resp = ThreatResponse.from_threat(threat, lat, lon)
            await broadcast_threat_event("threat_updated", resp.model_dump(mode="json"))

    async def _run_squad_patrol(self, squad_username: str, squad_id: UUID, path: list, delay: float = 1.0):
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

    async def _run_drone_flight(self, threat_id: UUID, path: list, delay: float = 0.5):
        total = len(path)
        step = self._step_indices.get(str(threat_id), 0)
        try:
            while True:
                lat, lon, alt = path[step % total]
                await self.update_drone_location(threat_id, lat, lon, alt)
                step += 1
                self._step_indices[str(threat_id)] = step
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            pass

    async def start(self, mode: str = "all") -> Dict[str, Any]:
        await self.stop()
        self._is_running = True
        self._current_mode = mode

        # Load squads from DB
        async with async_session_maker() as session:
            squads_stmt = select(User).where(User.role.in_(["Squad", "SapperSquad"]), User.status == "active")
            squads = (await session.execute(squads_stmt)).scalars().all()

            # Load or create drones from DB
            drones_stmt = select(Threat).where(Threat.threat_type == "drone", Threat.status == "active")
            drones = (await session.execute(drones_stmt)).scalars().all()

        # Launch squad simulations
        if mode in ["all", "squads"]:
            for u in squads:
                key = u.username if u.username in SQUAD_ROUTES else "squad_golani"
                dense_path = interpolate_route_2d(SQUAD_ROUTES[key], step_meters=25.0)
                task_name = f"squad_{u.username}"
                self._tasks[task_name] = asyncio.create_task(
                    self._run_squad_patrol(u.username, u.id, dense_path, delay=1.0)
                )

        # Launch drone simulations
        if mode in ["all", "drones"]:
            for i, d in enumerate(drones):
                cfg = DRONE_CONFIGS[i % len(DRONE_CONFIGS)]
                dense_path = interpolate_route_3d(cfg["key_points"], step_meters=70.0)
                task_name = f"drone_{d.id}"
                self._tasks[task_name] = asyncio.create_task(
                    self._run_drone_flight(d.id, dense_path, delay=0.5)
                )

        return self.get_status()

    async def stop(self) -> Dict[str, Any]:
        for name, task in list(self._tasks.items()):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
        self._is_running = False
        self._current_mode = "stopped"
        return self.get_status()

    async def manual_step(self, target_type: str, target_id: UUID, direction: str, delta: float = 0.0005) -> Dict[str, Any]:
        """Manual step for a squad or drone."""
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
            heading = 0.0 if direction == "up" else (180.0 if direction == "down" else (90.0 if direction == "right" else 270.0))

            new_lat = curr_lat + d_lat
            new_lon = curr_lon + d_lon
            await self.update_squad_location(target_id, new_lat, new_lon, heading)
            return {"status": "ok", "target_id": str(target_id), "lat": new_lat, "lon": new_lon, "heading": heading}

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
            await self.update_drone_location(target_id, new_lat, new_lon, new_alt)
            return {"status": "ok", "threat_id": str(target_id), "lat": new_lat, "lon": new_lon, "altitude": new_alt}

        return {"error": "Unknown target_type"}


# Global singleton engine
simulator_engine = SimulatorEngine()
