import asyncio
import math
import sys
import httpx
import socketio

BASE_HTTP_URL = "http://localhost:8000/api/v1"
BASE_SOCKET_URL = "http://localhost:8000"

# Waypoints for movement simulation (Central sector towards coastal ridge)
WAYPOINTS = [
    (32.0853, 34.7818),
    (32.0865, 34.7830),
    (32.0880, 34.7845),
    (32.0895, 34.7860),
    (32.0910, 34.7875),
    (32.0925, 34.7890),
    (32.0915, 34.7875),
    (32.0900, 34.7850),
    (32.0875, 34.7830),
    (32.0853, 34.7818),
]


def calculate_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lon = math.radians(lon2 - lon1)
    y = math.sin(d_lon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(d_lon)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360


async def simulate_movement(username: str = "squad_golani", password: str = "squad123", steps: int = 10):
    print(f"🛰️  Starting Tactical Movement Simulator for unit: '{username}'")
    
    # 1. Login via REST
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{BASE_HTTP_URL}/auth/login",
                json={"username": username, "password": password},
            )
            if resp.status_code != 200:
                print(f"❌ Login failed ({resp.status_code}): {resp.text}")
                return
            data = resp.json()
            token = data["access_token"]
            user_info = data["user"]
            print(f"✅ Authenticated as {user_info['name']} ({user_info['role']}, Sector: {user_info['area']})")
        except Exception as e:
            print(f"❌ Connection to backend failed: {e}")
            return

    # 2. Connect via Socket.IO
    sio = socketio.AsyncClient(logger=False, engineio_logger=False)

    @sio.event
    async def connect():
        print("🔗 Socket.IO connected successfully!")

    @sio.event
    async def disconnect():
        print("🔌 Socket.IO disconnected.")

    @sio.event
    async def squad_moved(data):
        print(f"  📡 [RX: squad_moved] Unit {data['id'][:8]}... -> Lat: {data['lat']:.4f}, Lon: {data['lon']:.4f}, Heading: {data['heading']:.1f}°")

    try:
        await sio.connect(
            BASE_SOCKET_URL,
            socketio_path="/socket.io",
            auth={"token": f"Bearer {token}"},
        )
    except Exception as e:
        print(f"❌ Socket connection error: {e}")
        return

    # 3. Stream Waypoints
    print("🚀 Streaming coordinates via Socket.IO...")
    total_points = len(WAYPOINTS)
    for i in range(min(steps, total_points)):
        current_lat, current_lon = WAYPOINTS[i]
        next_lat, next_lon = WAYPOINTS[(i + 1) % total_points]
        heading = calculate_heading(current_lat, current_lon, next_lat, next_lon)

        payload = {
            "lat": current_lat,
            "lon": current_lon,
            "heading": round(heading, 1),
        }
        print(f"📍 Step {i + 1}/{steps}: Emitting location_update {payload}")
        await sio.emit("location_update", payload)
        await asyncio.sleep(1.0)

    # 4. Emit a heartbeat
    print("💓 Emitting keep-alive heartbeat...")
    await sio.emit("heartbeat", {})
    await asyncio.sleep(0.5)

    await sio.disconnect()
    print("🏁 Simulation finished successfully!")


if __name__ == "__main__":
    unit_name = sys.argv[1] if len(sys.argv) > 1 else "squad_golani"
    step_count = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    asyncio.run(simulate_movement(username=unit_name, steps=step_count))
