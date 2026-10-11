import asyncio
import math
import sys
import httpx
import socketio

BASE_HTTP_URL = "http://127.0.0.1:8000/api/v1"
BASE_SOCKET_URL = "http://127.0.0.1:8000"

# Key patrol landmarks (lat, lon) forming closed polygons
KEY_ROUTES = {
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


def interpolate_route(key_points: list, step_meters: float = 25.0) -> list:
    """
    Interpolates dense micro-waypoints between key landmarks.
    Automatically closes the polygon loop back to the first point.
    """
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


def calculate_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lon = math.radians(lon2 - lon1)
    y = math.sin(d_lon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360) % 360, 1)


async def simulate_single_unit(username: str, password: str, steps: int = 0, delay: float = 1.0, step_meters: float = 25.0):
    """
    Simulates movement for a single tactical unit with smooth micro-stepping.
    steps <= 0 means run continuously in infinite patrol loop.
    """
    key_points = KEY_ROUTES.get(username, KEY_ROUTES["squad_golani"])
    waypoints = interpolate_route(key_points, step_meters=step_meters)
    total_waypoints = len(waypoints)
    is_infinite = steps <= 0

    print(f"[{username}] Route generated: {total_waypoints} micro-steps per patrol loop (~{int(step_meters)}m/step)")
    print(f"[{username}] Starting simulation (Mode: {'Continuous Loop' if is_infinite else f'{steps} steps'})")

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

    @sio.event
    async def connect():
        print(f"[{username}] Socket.IO connected.")

    @sio.event
    async def disconnect():
        print(f"[{username}] Socket.IO disconnected.")

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
            step_label = f"#{step}" if is_infinite else f"{step}/{steps}"
            lap = (step // total_waypoints) + 1
            progress_in_lap = (step % total_waypoints)
            print(f"[{username}] Step {step_label} (Lap {lap}, point {progress_in_lap}/{total_waypoints}) -> Lat: {curr_lat:.5f}, Lon: {curr_lon:.5f}, Heading: {heading:5.1f}°")

            await sio.emit("location_update", payload)

            # Periodic keep-alive ping every 15 steps
            if step % 15 == 0:
                await sio.emit("heartbeat", {})

            await asyncio.sleep(delay)

    except asyncio.CancelledError:
        pass
    finally:
        await sio.disconnect()
        print(f"[{username}] Patrol ended gracefully after {step} micro-steps.")


async def main():
    # Command-line interface:
    # python simulator/run.py [unit|all] [steps|--loop] [--delay X] [--step-meters Y]
    args = sys.argv[1:]

    target_unit = "all"
    steps = 0  # 0 means infinite loop
    delay = 1.0  # 1.0s per step
    step_meters = 25.0  # 25 meters per micro-step

    if args and not args[0].startswith("-"):
        target_unit = args[0]
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
        elif a in ("--step-meters", "-s", "--step") and i + 1 < len(args):
            try:
                step_meters = float(args[i + 1])
            except ValueError:
                pass
        elif a in ("--loop", "-l"):
            steps = 0

    print("=" * 68)
    print("  TACTICAL PULSE MICRO-STEPPING PATROL SIMULATOR")
    print(f"  Target: {target_unit.upper()} | Mode: {'CONTINUOUS LOOP (Ctrl+C to stop)' if steps <= 0 else f'{steps} steps'}")
    print(f"  Step Size: ~{int(step_meters)} meters | Speed: 1 step / {delay}s (~{int(step_meters / delay * 3.6)} km/h)")
    print("=" * 68)

    units_to_run = []
    if target_unit == "all":
        units_to_run = [
            ("squad_golani", "squad123"),
            ("squad_paratroopers", "squad123"),
        ]
    elif target_unit in KEY_ROUTES:
        units_to_run = [(target_unit, "squad123")]
    else:
        units_to_run = [(target_unit, "squad123")]

    tasks = []
    for u, p in units_to_run:
        tasks.append(
            asyncio.create_task(
                simulate_single_unit(u, p, steps=steps, delay=delay, step_meters=step_meters)
            )
        )
        await asyncio.sleep(1.0)

    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Stopping all patrol tasks...")
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        print("[SIMULATOR] All units stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Stopped by user.")
