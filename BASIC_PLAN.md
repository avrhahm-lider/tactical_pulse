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
  1. Backend Agent works on `backend/mvp`, Frontend Agent works on `frontend/mvp`.
  2. Features merge into `dev` via Pull Request / code review after integration verification.
  3. Once the MVP is verified end-to-end in `dev`, it is merged into `main`.

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

### Phase 1: Basic Product (MVP) — *Strict Priority*

1. **Authentication & Session Rehydration**:
   * JWT-based login (`POST /auth/login`).
   * Current user profile endpoint (`GET /auth/me`) for SPA state rehydration upon page refresh.
   * Roles: `MainCommandCenter`, `AreaCommandCenter`, `Squad`, `SapperSquad`, `Radar`.
2. **User & Unit Management (`/admin/users`)**:
   * Unit list (`GET /admin/users`) for MainCommandCenter dashboard.
   * Creation of units (`POST /admin/users`).
   * Squad registration with soldiers (7-digit IDs); soldiers optional for Command Centers/Radars. If any soldier has role `"sapper"`, the unit automatically receives role `SapperSquad`.
   * Automatic calculation of operational `area` (`North`, `Center`, `South` based on latitude; `'Global'` for `MainCommandCenter`).
   * Soft deactivation (`PATCH /admin/users/{id}/status` -> `status = 'inactive'`).
3. **Interactive Map & Operational Zones**:
   * React + Leaflet with Canvas renderer for high-performance tactical markers.
   * Zone visualization with boundaries:
     * **North**: Lat $\ge 32.7000$
     * **Center**: $31.9000 \le \text{Lat} < 32.7000$
     * **South**: Lat $< 31.9000$
   * **Signal Loss Indicator (Stale Marker UX)**: Unit markers turn grey if no coordinates are received for over 60 seconds (calculated via `updated_at`), signaling lost connection or stale telemetry.
   * **Marker Clustering**: Clustering close markers at low zoom levels to maintain tactical clarity.
4. **Real-Time Tactical Positioning (Socket.IO)**:
   * Squads stream position updates (`location_update`) when movement exceeds **5 meters** (rate-limited to 1/s).
   * Server validates, updates `map_entities`, and broadcasts `squad_moved` to clients within visibility range.
   * Admin unit deactivation broadcasts `unit_status_changed` so clients immediately remove deactivated markers.
5. **Visibility Rules Engine**:
   * `MainCommandCenter`: Global visibility — sees all squads and threats across all zones.
   * `AreaCommandCenter`: Regional visibility — sees squads and threats located within its assigned zone.
   * `Squad` / `SapperSquad` / `Radar`: Tactical visibility — sees entities within a **20 km radius** (`ST_DWithin(u.geom::geography, target.geom::geography, 20000)`).
6. **Threats Lifecycle Management**:
   * Form-based creation via REST `POST /threats` (triggers WebSocket broadcast `threat_created`).
   * **Dual Creation Modes (UI/UX)**:
     * *Current Position (Quick GPS)*: Automatically captures squad's live GPS coordinates (`lat`, `lon`).
     * *Interactive Map Point Selection (Pin Drop)*: User clicks "Select on Map", clicks any location on the Leaflet map to capture coordinates (`e.latlng`), sees a temporary placement pin, and submits form.
   * Threat status/engagement updates via REST `PATCH /threats/{id}` (triggers WebSocket broadcast `threat_updated`).
   * **Danger Zone Buffer**: Highlighted danger circle around every threat on the map (default **150 meters**).
   * **Proximity Alerts**: Instant tactical warning banner in client UI when a new threat is reported within **2 km** of the friendly unit.
   * **RBAC & Security Rules**:
     * `immovable` threats (`explosive`): can only be engaged/resolved by `SapperSquad` or Command Center. Coordinates cannot be changed.
     * `movable` ground threats (`personnel`, `vehicle`): coordinates can be updated by regular `Squad`, `SapperSquad`, `Radar`, or Command Center.
     * `movable` aerial threats (`drone`): telemetry (`lat`, `lon`, `altitude`) can strictly only be updated by `Radar` (or Command Center). Regular squads receive 403 Forbidden.
     * Field squads can only assign threats to themselves (`assigned_to_id == current_user.id`) and only within their 20 km visibility range.
7. **Threat Visual Lifecycle States**:
   * `unassigned`: Red active hazard icon with 150 m danger buffer circle.
   * `in_progress`: Yellow warning icon indicating assigned squad badge.
   * `resolved`: Green neutralized icon informing friendly units that the hazard is safe.
   * `inactive`: Archived threat, removed from active map snapshot and client display.
8. **Map Snapshot API (`GET /map/snapshot`)**:
   * Returns active tactical units (squads and radars, with soldier rosters and `updated_at`) and active threats filtered by caller permissions.
9. **Database Seed Script (`backend/app/db/seed.py`)**:
   * Creates initial dev/demo accounts: `admin` (MainCommandCenter), 3 regional centers (`command_north`, `command_center`, `command_south`), 3 tactical squads with soldiers (`squad_golani`, `squad_paratroopers` with sappers, `radar_post_1`), and 2 demo threats (IED and UAV).
10. **Tactical Simulator**:
    * Python test script (`simulator/run.py`) to simulate squads moving and streaming coordinates via Socket.IO to validate real-time updates without manual clicks.
11. **Audit Log**:
    * Every significant action (login, threat creation/update, status change, user management) is recorded in a dedicated `audit_log` table with user ID, action type, resource, timestamp, and IP address. Provides full operational accountability and forensic traceability.

---

### Phase 2: Post-MVP Features (Deferred)
1. **Navigation & Dynamic Threat Avoidance**:
   * Route calculation for regular squads avoiding known threat radiuses (pgRouting + NetworkX).
   * Direct vector navigation for `SapperSquad` to assigned IED threats.
2. **Command & Tactical Chat**:
   * Secure messaging between Command Centers (`chat_message` / `chat_broadcast`).
   * Operational broadcast from Command Center to squads (by zone or global).
3. **High-Frequency Live Cache**:
   * Redis pub/sub layer for sub-millisecond coordinate streaming if horizontal scaling is required.
4. **Transport Layer Security (TLS / HTTPS & WSS)**:
   * Production SSL/TLS encryption for REST and WebSocket traffic via reverse proxy (Nginx / Cloud ALB). Deferred from MVP for simplified local development.

---

## 5. Agent Task Division & Implementation Workflow (MVP)

To ensure smooth parallel execution between **Backend Agent** and **Frontend Agent** without integration friction:

### Backend Agent Scope (`backend/mvp` branch)
* **Milestone B1: Database & Core**
  * PostgreSQL + PostGIS Docker Compose configuration.
  * SQLAlchemy async models: `User`, `Soldier`, `MapEntity`, `Threat`.
  * Alembic migration scripts.
  * Database seeder script (`seed.py`) with all test users, squads, and threats.
* **Milestone B2: Auth & Admin API**
  * JWT generation, hashing (passlib/bcrypt), role & active status dependencies.
  * `POST /api/v1/auth/login` and `GET /api/v1/auth/me`.
  * `GET /api/v1/admin/users`, `POST /api/v1/admin/users`, `PATCH /api/v1/admin/users/{id}/status`.
* **Milestone B3: Threats & Map Snapshot API**
  * Spatial query service using PostGIS (`ST_DWithin`, latitude zone boundaries).
  * `GET /api/v1/map/snapshot` with role-based filtering.
  * `POST /api/v1/threats` and `PATCH /api/v1/threats/{id}` with strict RBAC validation.
* **Milestone B4: Socket.IO Server & Simulator**
  * python-socketio server with JWT handshake authentication and active status enforcement.
  * Handlers for `location_update`, broadcasts for `squad_moved`, `unit_status_changed`, `threat_created`, `threat_updated`.
  * CLI movement simulator (`simulator/run.py`).

### Frontend Agent Scope (`frontend/mvp` branch)
* **Milestone F1: Setup & Design System**
  * Vite + React + TypeScript initialized in `frontend/`.
  * Tactical dark-mode theme, military styling, icons (Lucide / Leaflet custom markers).
  * TypeScript types matching `API_CONTRACT.md` schemas exactly (`User`, `Squad`, `Soldier`, `Threat`).
* **Milestone F2: Auth & Session Management**
  * Zustand `useAuthStore` handling login, token storage in `localStorage`, and session rehydration via `GET /auth/me`.
  * Login screen with role switcher / pre-filled demo accounts.
* **Milestone F3: Tactical Leaflet Map**
  * Leaflet with Canvas renderer, centered on Israel (`[31.5, 34.8]`, zoom 8).
  * Operational zone overlay (North, Center, South dividing lines and labels).
  * Squad & Radar markers with headings, military symbols, and Stale Signal Indicator (>60s grey icon).
  * Threat markers (`unassigned` red, `in_progress` yellow, `resolved` green) with 150m danger buffer circles.
* **Milestone F4: Threat Creation & Management UX**
  * Threat creation modal with Dual Mode (Quick GPS vs. "Select on Map" pin click).
  * Threat detail drawer / action modal for status transitions (`in_progress`, `resolved`).
  * 2 km Proximity Alert banner for field units.
* **Milestone F5: Socket.IO Real-Time Sync**
  * `useSocket` hook connecting to `http://localhost:8000` with JWT auth token.
  * Real-time listeners: `squad_moved`, `unit_status_changed`, `threat_created`, `threat_updated`.
  * Field squad GPS simulation toggle to emit `location_update` on movement.

---

## 6. Tech Stack & Engineering Standards

* **Frontend**: React (Vite), TypeScript, Leaflet (Canvas renderer), Zustand, Socket.IO-client, Tailwind CSS.
* **Backend**: Python 3.11+, FastAPI, python-socketio, SQLAlchemy (asyncpg), Pydantic v2, PyJWT, passlib (bcrypt).
* **Database**: PostgreSQL 15+ with PostGIS extension.
* **GIS Coordinates Convention**:
  * Client APIs & Leaflet: `lat, lon` (Latitude first).
  * PostGIS Geometry: `ST_MakePoint(lon, lat)` (Longitude first, standard WGS 84 / SRID 4326).
* **Security**: JWT with refresh token rotation, rate limiting on authentication, bcrypt password hashing, audit logging (TLS/HTTPS deferred to Phase 2).
* **Testing & Tools**: Pytest, Alembic migrations, Docker Compose.
* **Ports**:
  * Backend API: `http://localhost:8000/api/v1`
  * Backend Socket: `http://localhost:8000` (`/socket.io`)
  * Frontend Dev: `http://localhost:5173`

---

## 7. Project Structure

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
│   │   ├── auth.py         # /auth/login, /auth/me
│   │   ├── admin.py        # /admin/users (GET, POST, PATCH status)
│   │   ├── threats.py      # /threats (POST, PATCH)
│   │   └── map.py          # /map/snapshot
│   ├── core/               # Configuration & Security (JWT, hashing, CORS)
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
