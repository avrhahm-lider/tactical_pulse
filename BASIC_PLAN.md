# Tactical Pulse — Project Plan & Roadmap

## 1. Overview
Tactical Pulse is a real-time situational awareness and command platform for tactical units in Israel. It features operational zoning, role-based visibility, dynamic threat tracking, and live squad positioning.

---

## 2. Git Branching Strategy

To isolate frontend and backend development while keeping the release flow organized:

* **`main`**: Production-ready, stable releases only.
* **`dev`**: Main integration branch for tested and reviewed features.
* **Feature / Component Branches**:
  * **`backend/mvp`**: Backend implementation (FastAPI, PostGIS, Socket.IO, DB models, Auth, REST & Sockets).
  * **`frontend/mvp`**: Frontend implementation (React, Leaflet Canvas, Zustand, UI panels, Socket client).
* **Workflow**:
  1. Developers work on `backend/*` and `frontend/*` branches.
  2. Features merge into `dev` via Pull Request / code review.
  3. Once the MVP / milestone is fully integrated and tested in `dev`, it is merged into `main`.

---

## 3. Entity Architecture

```text
Entity
├── User (Auth & Identity: id, username, password_hash, role, area, status)
│    ├── MainCommandCenter   (Global operational visibility)
│    ├── AreaCommandCenter   (Regional zone visibility)
│    ├── Squad               (Tactical assault / reconnaissance force)
│    ├── SapperSquad         (Explosive ordnance disposal unit)
│    └── Radar               (Air / moving target monitoring unit)
│
├── MapEntity (Live map positions: references User, geom, heading, updated_at)
│    ├── Squad / SapperSquad
│    └── Mobile Radar / Field Unit
│
├── Soldier (Unit personnel: exactly 7-digit ID, name, role; 1-to-many from Squad)
│
└── Threat (Operational hazards: movable vs. immovable, independent spatial entity)
     ├── Immovable (IEDs, minefields, blockades — handled by SapperSquad)
     └── Movable   (Hostile UAVs, hostile personnel, enemy vehicles — tracked by Radar/Squads)
```

---

## 4. Development Roadmap

### Phase 1: Basic Product (MVP) — *Priority*
1. **Authentication & RBAC**:
   * JWT-based login (`/auth/login`).
   * Roles: `MainCommandCenter`, `AreaCommandCenter`, `Squad`, `SapperSquad`, `Radar`.
2. **User & Unit Management (`/admin/users`)**:
   * Creation of units by `MainCommandCenter`.
   * Squad registration with soldiers (7-digit IDs); soldiers optional for Command Centers/Radars. If any soldier has role `"sapper"`, the unit automatically receives role `SapperSquad`.
   * Automatic calculation of operational `area` (`North`, `Center`, `South` based on latitude; `'Global'` for `MainCommandCenter`).
   * Soft deactivation (`status = 'inactive'`).
3. **Interactive Map & Operational Zones**:
   * React + Leaflet with Canvas renderer for smooth tactical markers.
   * Zone visualization:
     * **North**: Lat $\ge 32.7000$
     * **Center**: $31.9000 \le \text{Lat} < 32.7000$
     * **South**: Lat $< 31.9000$
   * **Signal Loss Indicator (Stale Marker UX)**: Unit markers turn grey if no coordinates are received for over 60 seconds, signaling lost connection or stale telemetry.
   * **Marker Clustering**: Clustering close markers at low zoom levels to maintain tactical clarity without UI clutter.
4. **Real-Time Tactical Positioning (Socket.IO)**:
   * Squads stream position updates (`location_update`) when movement exceeds **5 meters**.
   * Server validates, updates `map_entities`, and broadcasts `squad_moved`.
5. **Visibility Rules Engine**:
   * `MainCommandCenter`: Sees all squads and threats across all zones.
   * `AreaCommandCenter`: Sees all squads and threats within its assigned zone.
   * `Squad` / `SapperSquad` / `Radar`: Tactical visibility within a **20 km radius** (`ST_DWithin(u.geom::geography, target.geom::geography, 20000)`).
6. **Threats Lifecycle Management**:
   * Form-based creation via REST `POST /threats` (triggers WebSocket broadcast `threat_created`).
   * **Dual Creation Modes (UI/UX)**:
     * *Current Position (Quick GPS)*: Automatically captures and populates the squad's live GPS coordinates (`lat`, `lon`).
     * *Interactive Map Point Selection (Pin Drop)*: User clicks "Select on Map", clicks any location on the Leaflet map to capture coordinates (`e.latlng`), sees a temporary placement marker, and submits the form with those exact coordinates.
   * Threat status / engagement updates via REST `PATCH /threats/{id}` (triggers WebSocket broadcast `threat_updated`).
   * **Danger Zone Buffer**: Every threat displays a highlighted danger perimeter circle on the map (default **150 meters**).
   * **Proximity Alerts**: Instant tactical warning banners/alerts in the client UI when a new threat is reported within **2 km** of the unit.
   * RBAC enforcement:
     * `immovable` threats (`explosive`): can only be engaged/resolved by `SapperSquad` or Command Center.
     * `movable` ground threats (`personnel` terrorist group, `vehicle`): coordinates can be updated by regular `Squad`, `SapperSquad`, `Radar`, or Command Center.
     * `movable` aerial threats (`drone`): telemetry (`lat`, `lon`, `altitude`) can strictly only be updated by `Radar` (or Command Center). Regular squads receive 403 Forbidden.
7. **Threat Visual Lifecycle States**:
   * `unassigned`: Red active hazard icon with highlighted 150 m danger buffer circle.
   * `in_progress`: Yellow warning icon indicating an assigned squad is currently neutralizing/handling the threat.
   * `resolved`: Green neutralized icon remaining visible on map to inform friendly units that the hazard is safe.
   * `inactive`: Archived / soft-deleted threat, completely removed from active map snapshot and client display.
8. **Map Snapshot API (`GET /map/snapshot`)**:
   * Returns active squads (with soldier rosters) and active threats filtered by caller permissions.
9. **Database Seed Script (`backend/app/db/seed.py`)**:
   * Creates initial dev/demo accounts: `admin` (MainCommandCenter), 3 regional centers (`command_north`, `command_center`, `command_south`), 3 tactical squads with soldiers (`squad_golani`, `squad_paratroopers` with sappers, `radar_post_1`), and 2 demo threats (IED and UAV).
10. **Tactical Simulator**:
    * Python test script to simulate squads moving and sending coordinates to validate real-time updates without manual clicks.

---

### Phase 2: Post-MVP Features (Future Enhancements)
1. **Navigation & Dynamic Threat Avoidance**:
   * Route calculation for regular squads avoiding known threat radiuses.
   * Direct vector navigation for `SapperSquad` to assigned IED threats.
   * Server-side routing graph using `pgRouting` and `networkx`.
2. **Command & Tactical Chat**:
   * Secure messaging between Command Centers (`chat_message`).
   * Operational broadcast from Command Center to squads (by zone or global).
3. **High-Frequency Live Cache**:
   * Redis pub/sub layer for sub-millisecond coordinate streaming if horizontal scaling is required.

---

## 5. Tech Stack & Engineering Standards

* **Frontend**: React (Vite), TypeScript, Leaflet (Canvas renderer), Zustand, Socket.IO-client, Tailwind CSS.
* **Backend**: Python 3.11+, FastAPI, python-socketio, SQLAlchemy (asyncpg), Pydantic v2, PyJWT, passlib (bcrypt).
* **Database**: PostgreSQL 15+ with PostGIS extension.
* **GIS Coordinates Convention**:
  * Client APIs & Leaflet: `lat, lon` (Latitude first).
  * PostGIS Geometry: `ST_MakePoint(lon, lat)` (Longitude first, standard WGS 84 / SRID 4326).
* **Testing & Tools**: Pytest, Alembic migrations, Docker Compose.
* **Phase 2 Additions**: Redis, pgRouting, NetworkX.

---

## 6. Project Structure

```text
frontend/
├── public/                 # Static assets, map markers, military iconography
├── src/
│   ├── assets/             # Global styles
│   ├── components/         # React UI components
│   │   ├── Map/            # Tactical map (Canvas Leaflet, MarkerLayer, ZoneLayer)
│   │   ├── Dashboard/      # Unit list, threat details, operational panels
│   │   ├── Auth/           # Login form
│   │   ├── Forms/          # Threat creation modal, unit management modal
│   │   └── shared/         # Common UI elements (Button, Modal, Input, Badge)
│   ├── hooks/              # Custom hooks (useSocket, useSnapshot)
│   ├── routes/             # App routing & ProtectedRoute
│   ├── store/              # Zustand stores (useAuthStore, useMapStore)
│   ├── services/           # External APIs (api.ts for Axios REST, socket.ts)
│   ├── types/              # TypeScript types (User, Squad, Soldier, Threat)
│   ├── utils/              # Coordinate helpers, zone math
│   ├── App.tsx             # Main container
│   └── main.tsx            # Entry point
├── package.json
└── vite.config.ts

backend/
├── alembic/                # DB migrations
├── app/
│   ├── api/                # REST Routers
│   │   ├── dependencies.py # JWT extraction & RoleChecker
│   │   ├── auth.py         # /auth/login
│   │   ├── admin.py        # /admin/users (create units & soldiers, status change)
│   │   ├── threats.py      # /threats (POST create, PATCH update, GET list)
│   │   └── map.py          # /map/snapshot
│   ├── core/               # Configuration & Security (JWT, hashing)
│   ├── db/                 # PostgreSQL + PostGIS session setup
│   │   ├── postgres.py     # Engine and async session
│   │   └── seed.py         # Dev/demo data seeder script
│   ├── models/             # SQLAlchemy Models (User, Soldier, MapEntity, Threat)
│   ├── schemas/            # Pydantic Schemas (Auth, User, Soldier, Threat, Map)
│   ├── services/           # Spatial visibility calculations (ST_DWithin, zones)
│   ├── sockets/            # Socket.IO setup, auth handshake, location & threat broadcasts
│   └── main.py             # FastAPI & Socket.IO app bootstrap
├── simulator/              # CLI script to simulate movements & live telemetry
├── docker-compose.yml      # Local dev environment (Postgres + PostGIS)
├── Dockerfile
└── requirements.txt
```
