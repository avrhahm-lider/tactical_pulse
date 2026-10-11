import asyncio
import math
import sys
import httpx
import socketio

BASE_HTTP_URL = "http://127.0.0.1:8000/api/v1"
BASE_SOCKET_URL = "http://127.0.0.1:8000"

# Waypoints for patrol routes (lat, lon)
ROUTES = {
    "squad_golani": [
        (32.0853, 34.7818),
        (32.0868, 34.7832),
        (32.0885, 34.7850),
        (32.0902, 34.7868),
        (32.0920, 34.7885),
        (32.0935, 34.7905),
        (32.0928, 34.7882),
        (32.0910, 34.7860),
        (32.0890, 34.7840),
        (32.0870, 34.7825),
        (32.0853, 34.7818),
    ],
    "squad_paratroopers": [
        (32.0920, 34.7890),
        (32.0935, 34.7915),
        (32.0950, 34.7938),
        (32.0965, 34.7960),
        (32.0952, 34.7980),
        (32.0935, 34.7965),
        (32.0918, 34.7942),
        (32.0905, 34.7920),
        (32.0912, 34.7905),
        (32.0920, 34.7890),
    ],
}


def calculate_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lon = math.radians(lon2 - lon1)
    y = math.sin(d_lon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(y, x))
    return round((bearing + 360) % 360, 1)


async def simulate_single_unit(username: str, password: str, steps: int = 0, delay: float = 1.5):
    """
    Simulates movement for a single tactical unit.
    steps <= 0 means run continuously in infinite patrol loop.
    """
    waypoints = ROUTES.get(username, ROUTES["squad_golani"])
    total_waypoints = len(waypoints)
    is_infinite = steps <= 0

    print(f"[SIMULATOR] Starting unit: '{username}' (Mode: {'Continuous Loop' if is_infinite else f'{steps} steps'})")

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
        )
    except Exception as e:
        print(f"[{username}] Socket connection error: {e}")
        return

    # 3. Movement Loop
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
            print(f"[{username}] Step {step_label} -> Lat: {curr_lat:.4f}, Lon: {curr_lon:.4f}, Heading: {heading}°")

            await sio.emit("location_update", payload)

            # Periodic heartbeat ping every 10 steps
            if step % 10 == 0:
                await sio.emit("heartbeat", {})

            await asyncio.sleep(delay)

    except asyncio.CancelledError:
        pass
    finally:
        await sio.disconnect()
        print(f"[{username}] Patrol finished after {step} steps.")


async def main():
    # Parsing command-line arguments
    # Usage: python simulator/run.py [unit|all] [steps|--loop] [--delay X]
    args = sys.argv[1:]

    target_unit = "all"
    steps = 0  # 0 means infinite loop
    delay = 1.5

    # Check first argument: unit name or "all"
    if args and not args[0].startswith("-"):
        target_unit = args[0]
        args = args[1:]

    # Check second argument: step count or "--loop"
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

    # Check optional --delay
    for i, a in enumerate(args):
        if a in ("--delay", "-d") and i + 1 < len(args):
            try:
                delay = float(args[i + 1])
            except ValueError:
                pass
        elif a in ("--loop", "-l"):
            steps = 0

    print("=" * 60)
    print("  TACTICAL PULSE MOVEMENT SIMULATOR")
    print(f"  Target: {target_unit.upper()} | Steps: {'CONTINUOUS (Ctrl+C to stop)' if steps <= 0 else steps} | Delay: {delay}s")
    print("=" * 60)

    units_to_run = []
    if target_unit == "all":
        units_to_run = [
            ("squad_golani", "squad123"),
            ("squad_paratroopers", "squad123"),
        ]
    elif target_unit in ROUTES:
        units_to_run = [(target_unit, "squad123")]
    else:
        # Custom unit name, default password
        units_to_run = [(target_unit, "squad123")]

    tasks = []
    for u, p in units_to_run:
        tasks.append(asyncio.create_task(simulate_single_unit(u, p, steps=steps, delay=delay)))
        await asyncio.sleep(2.0)

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
