import asyncio
import math
import sys
import httpx
import socketio

BASE_HTTP_URL = "http://127.0.0.1:8000/api/v1"
BASE_SOCKET_URL = "http://127.0.0.1:8000"

# Key patrol landmarks (lat, lon) for ground tactical squads
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

# Aerial flight paths for hostile drones (lat, lon, altitude_m)
# Configured to create realistic danger zone intrusions over friendly patrol corridors
DRONE_CONFIGS = [
    {
        "name": "Hostile UAV Alpha",
        "severity": "critical",
        "radius": 200.0,
        "key_points": [
            (32.0985, 34.8000, 350.0),  # Directly at Paratroopers northern turn!
            (32.1150, 34.8150, 420.0),
            (32.1300, 34.8100, 450.0),
            (32.1100, 34.7950, 390.0),
            (32.0960, 34.7950, 360.0),  # Intersects return patrol path!
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
            (32.0920, 34.7890, 180.0),  # Directly at Golani & Paratroopers patrol intersection!
            (32.0980, 34.7980, 220.0),  # Sweeps along Paratroopers patrol corridor!
            (32.1060, 34.8080, 260.0),
            (32.0940, 34.7904, 210.0),  # Directly sweeps Golani tactical route!
            (32.0865, 34.7830, 190.0),  # Crosses Golani squad base route!
        ],
    },
]


def interpolate_route_2d(key_points: list, step_meters: float = 25.0) -> list:
    """Interpolates dense micro-waypoints (lat, lon) forming a seamless closed loop."""
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


def interpolate_route_3d(key_points: list, step_meters: float = 40.0) -> list:
    """Interpolates 3D aerial flight path (lat, lon, altitude_m) with seamless looping."""
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
# SQUAD PATROL SIMULATOR
# ==============================================================================
async def simulate_single_unit(username: str, password: str, steps: int = 0, delay: float = 1.0, step_meters: float = 25.0):
    key_points = SQUAD_ROUTES.get(username, SQUAD_ROUTES["squad_golani"])
    waypoints = interpolate_route_2d(key_points, step_meters=step_meters)
    total_waypoints = len(waypoints)
    is_infinite = steps <= 0

    print(f"[{username}] Route: {total_waypoints} micro-steps/lap (~{int(step_meters)}m/step)")

    # 1. Login via REST
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                f"{BASE_HTTP_URL}/auth/login",
                json={"username": username, "password": password},
            )
            if resp.status_code != 200:
                print(f"[{username}] Login failed ({resp.status_code}): {resp.text}")
                return
            data = resp.json()
            token = data["access_token"]
            user_info = data["user"]
            print(f"[{username}] Authenticated as {user_info['name']} ({user_info['role']})")
        except Exception as e:
            print(f"[{username}] REST connection error: {e}")
            return

    # 2. Connect via Socket.IO
    sio = socketio.AsyncClient(logger=False, engineio_logger=False)

    @sio.on("danger_zone_alert")
    async def on_danger_alert(data):
        print(f"\n🚨🚨🚨 [{username.upper()} HAZARD ALERT] {data.get('message')} 🚨🚨🚨\n")

    try:
        await sio.connect(
            BASE_SOCKET_URL,
            socketio_path="/socket.io",
            auth={"token": f"Bearer {token}"},
            transports=["websocket"],
        )
    except Exception as e:
        print(f"[{username}] Socket connection error: {e}")
        return

    # 3. Micro-Stepping Movement Loop
    step = 0
    try:
        while is_infinite or step < steps:
            curr_idx = step % total_waypoints
            next_idx = (step + 1) % total_waypoints

            curr_lat, curr_lon = waypoints[curr_idx]
            next_lat, next_lon = waypoints[next_idx]
            heading = calculate_heading(curr_lat, curr_lon, next_lat, next_lon)

            payload = {
                "lat": curr_lat,
                "lon": curr_lon,
                "heading": heading,
            }

            step += 1
            if step % 5 == 0 or step == 1:
                print(f"[{username}] Step #{step} -> Lat: {curr_lat:.5f}, Lon: {curr_lon:.5f}, Heading: {heading:5.1f}°")

            await sio.emit("location_update", payload)

            if step % 20 == 0:
                await sio.emit("heartbeat", {})

            await asyncio.sleep(delay)

    except asyncio.CancelledError:
        pass
    finally:
        await sio.disconnect()
        print(f"[{username}] Patrol ended gracefully.")


# ==============================================================================
# RADAR DRONE SIMULATOR (3 Drones Managed by Radar Post)
# ==============================================================================
async def simulate_radar_drones(radar_username: str = "radar_post_1", radar_password: str = "radar123", steps: int = 0, delay: float = 1.2, step_meters: float = 35.0):
    is_infinite = steps <= 0
    print(f"\n[RADAR] Authenticating radar station '{radar_username}' for drone air surveillance...")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Login as Radar Station
        try:
            resp = await client.post(
                f"{BASE_HTTP_URL}/auth/login",
                json={"username": radar_username, "password": radar_password},
            )
            if resp.status_code != 200:
                print(f"[RADAR] Login failed ({resp.status_code}): {resp.text}")
                return
            token = resp.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            print(f"[RADAR] Authenticated. Initializing 3 aerial drone tracks...")
        except Exception as e:
            print(f"[RADAR] Authentication error: {e}")
            return

        # 2. Query Existing Threats to Avoid Duplicates
        drone_entities = []
        try:
            list_resp = await client.get(f"{BASE_HTTP_URL}/threats", headers=headers)
            existing_threats = list_resp.json() if list_resp.status_code == 200 else []
            existing_by_name = {t["name"]: t["id"] for t in existing_threats if isinstance(t, dict) and "name" in t}
        except Exception:
            existing_by_name = {}

        # 3. Create or Bind Drones
        for cfg in DRONE_CONFIGS:
            drone_name = cfg["name"]
            flight_path = interpolate_route_3d(cfg["key_points"], step_meters=step_meters)
            init_lat, init_lon, init_alt = flight_path[0]

            if drone_name in existing_by_name:
                drone_id = existing_by_name[drone_name]
                print(f"[RADAR] Bound to existing drone track: '{drone_name}' (ID: {drone_id[:8]}...)")
            else:
                create_payload = {
                    "name": drone_name,
                    "description": f"Aerial radar contact tracked by {radar_username}",
                    "threat_type": "drone",
                    "type": "movable",
                    "severity_level": cfg["severity"],
                    "radius": cfg["radius"],
                    "altitude": init_alt,
                    "lat": init_lat,
                    "lon": init_lon,
                }
                try:
                    c_resp = await client.post(f"{BASE_HTTP_URL}/threats", json=create_payload, headers=headers)
                    if c_resp.status_code == 201:
                        drone_id = c_resp.json()["id"]
                        print(f"[RADAR] Reported NEW drone track: '{drone_name}' (Alt: {init_alt}m, ID: {drone_id[:8]}...)")
                    else:
                        print(f"[RADAR] Failed to register drone '{drone_name}': {c_resp.text}")
                        continue
                except Exception as cre:
                    print(f"[RADAR] Drone registration error for '{drone_name}': {cre}")
                    continue

            drone_entities.append({
                "id": drone_id,
                "name": drone_name,
                "path": flight_path,
                "total": len(flight_path),
            })

        if not drone_entities:
            print("[RADAR] No drones available to simulate.")
            return

        print(f"[RADAR] Commencing real-time telemetry updates for {len(drone_entities)} drones...")

        # 4. Continuous Aerial Telemetry Update Loop
        step = 0
        try:
            while is_infinite or step < steps:
                step += 1
                for d in drone_entities:
                    idx = step % d["total"]
                    lat, lon, alt = d["path"][idx]

                    patch_payload = {
                        "lat": lat,
                        "lon": lon,
                        "altitude": alt,
                    }

                    try:
                        patch_res = await client.patch(
                            f"{BASE_HTTP_URL}/threats/{d['id']}",
                            json=patch_payload,
                            headers=headers,
                        )
                        if patch_res.status_code == 200:
                            if step % 5 == 0 or step == 1:
                                print(f"[RADAR] Track '{d['name']}' -> Lat: {lat:.5f}, Lon: {lon:.5f}, Alt: {alt}m")
                        else:
                            print(f"[RADAR] Track '{d['name']}' update failed ({patch_res.status_code}): {patch_res.text}")
                    except Exception as pe:
                        print(f"[RADAR] Telemetry send error for {d['name']}: {pe}")

                await asyncio.sleep(delay)

        except asyncio.CancelledError:
            pass
        finally:
            print("[RADAR] Drone air surveillance ended.")


# ==============================================================================
# MAIN ENTRY POINT
# ==============================================================================
async def main():
    args = sys.argv[1:]

    target_mode = "all"  # "all", "squads", "drones", or specific squad name
    steps = 0            # 0 means continuous infinite loop
    delay = 1.0          # 1.0s delay
    step_meters = 25.0

    if args and not args[0].startswith("-"):
        target_mode = args[0].lower()
        args = args[1:]

    if args and not args[0].startswith("-"):
        val = args[0].lower()
        if val in ("--loop", "loop", "inf", "infinite"):
            steps = 0
        else:
            try:
                steps = int(val)
            except ValueError:
                steps = 0
        args = args[1:]

    for i, a in enumerate(args):
        if a in ("--delay", "-d") and i + 1 < len(args):
            try:
                delay = float(args[i + 1])
            except ValueError:
                pass
        elif a in ("--step", "--step-meters", "-s") and i + 1 < len(args):
            try:
                step_meters = float(args[i + 1])
            except ValueError:
                pass
        elif a in ("--loop", "-l"):
            steps = 0

    print("=" * 72)
    print("  TACTICAL PULSE COMPREHENSIVE SIMULATOR (SQUADS + RADAR DRONES)")
    print(f"  Mode: {target_mode.upper()} | Patrol: {'CONTINUOUS LOOP (Ctrl+C to stop)' if steps <= 0 else f'{steps} steps'}")
    print(f"  Step Size: ~{int(step_meters)}m | Update Rate: 1 step / {delay}s")
    print("=" * 72)

    tasks = []

    # Launch Ground Squads
    if target_mode in ("all", "squads"):
        for unit_name, pwd in [("squad_golani", "squad123"), ("squad_paratroopers", "squad123")]:
            tasks.append(
                asyncio.create_task(
                    simulate_single_unit(unit_name, pwd, steps=steps, delay=delay, step_meters=step_meters)
                )
            )
            await asyncio.sleep(0.8)
    elif target_mode in SQUAD_ROUTES:
        tasks.append(
            asyncio.create_task(
                simulate_single_unit(target_mode, "squad123", steps=steps, delay=delay, step_meters=step_meters)
            )
        )

    # Launch Radar Drones
    if target_mode in ("all", "drones", "radar"):
        tasks.append(
            asyncio.create_task(
                simulate_radar_drones(steps=steps, delay=delay * 1.2, step_meters=step_meters * 1.5)
            )
        )

    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Stopping all simulation tasks...")
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        print("[SIMULATOR] Simulator cleanly stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Stopped by user.")
