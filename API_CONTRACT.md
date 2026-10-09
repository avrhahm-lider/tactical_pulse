# Tactical Pulse — API, WebSocket Contract & Database Schemas

This document defines the formal contract, communication protocol, and database schema for Frontend (React + Zustand + Leaflet Canvas + Socket.IO Client) and Backend (FastAPI + python-socketio + PostgreSQL/PostGIS).

---

## 1. Zones & Visibility Rules

The map of Israel is divided into three operational areas defined by latitude boundaries:
* **`North`**: $\text{Lat} \ge 32.7000$
* **`Center`**: $31.9000 \le \text{Lat} < 32.7000$
* **`South`**: $\text{Lat} < 31.9000$

### Visibility Permissions:
1. **`MainCommandCenter`**: Global visibility (`area = 'Global'`) — sees all squads, radars, and threats across all zones without restrictions.
2. **`AreaCommandCenter`**: Regional visibility — sees all entities and threats located strictly inside its assigned zone (`Center`, `North`, or `South`).
3. **`Squad` / `SapperSquad` / `Radar`**: Tactical visibility — sees other squads and threats within a **20 km radius** (`20000` meters, calculated in PostGIS via `ST_DWithin(u.geom::geography, target.geom::geography, 20000)`) from their current position.

---

## 2. Threat Handling Matrix (RBAC) & Lifecycle

| Action | Immovable (`explosive` IED) | Movable Ground (`personnel`, `vehicle`) | Movable Air (`drone` UAV) |
|---|---|---|---|
| **Create (`POST /threats`)** | Any `Squad`, `SapperSquad`, `CommandCenter` | Any `Squad`, `SapperSquad`, `Radar`, `CommandCenter` | `Radar`, `Squad`, `CommandCenter` |
| **Take Responsibility (`in_progress`)** | **`SapperSquad` only** (or Command Center) | Any `Squad`, `SapperSquad` (or Command Center) | Any `Squad` or `CommandCenter` |
| **Update Position (`lat`, `lon`)** | **Fixed** (cannot move, returns `400 Bad Request`) | **`Squad`**, `SapperSquad`, `Radar`, `CommandCenter` | **`Radar` only** (or Command Center) |
| **Resolve (`resolved`)** | **`SapperSquad` only** (or Command Center) | Assigned Squad or Command Center | Assigned Squad or Command Center |
| **Deactivate (`inactive`)** | Command Center or assigned `SapperSquad` | Command Center or assigned Squad | Command Center or assigned Squad |

### RBAC & Security Rules for Threats:
1. **Zone Restriction for `AreaCommandCenter`**: An `AreaCommandCenter` can strictly create, modify, or resolve threats located within its designated latitude zone (`North`, `Center`, or `South`). Attempts to modify threats outside its zone return `403 Forbidden`.
2. **Tactical Proximity Restriction for Field Units**: `Squad`, `SapperSquad`, and `Radar` can only take responsibility (`in_progress`), update coordinates, or resolve threats located within their **20 km visibility radius**.
3. **Self-Assignment Rule**: Field squads can only assign threats to themselves (`assigned_to_id == current_user.id`). Only `MainCommandCenter` and `AreaCommandCenter` can assign threats to arbitrary units.
4. **Aerial Threat Telemetry (`drone`)**: If `threat_type == "drone"` and caller role is a regular `Squad` / `SapperSquad` attempting to alter coordinates (`lat`, `lon`, `altitude`), the server returns `403 Forbidden` (`"Only Radar or Command Center can update aerial drone telemetry"`).
5. **Threat Consistency Rule**:
   * If `threat_type == 'explosive'`, `type` MUST be `'immovable'`.
   * If `threat_type IN ('vehicle', 'drone', 'personnel')`, `type` MUST be `'movable'`.
   * Attempts to provide mismatched types return `422 Unprocessable Entity`.

### Threat Visual Lifecycle & Map Behavior:
1. **`unassigned`**: Active hazard. Rendered as a red hazard marker with a danger radius buffer circle (default 150m).
2. **`in_progress`**: Under active mitigation. Rendered as a yellow marker displaying the assigned squad badge.
3. **`resolved`**: Neutralized hazard. Rendered as a green marker to inform friendly units that the area has been cleared.
4. **`inactive`**: Archived threat. Excluded from `GET /map/snapshot` and removed from the active Leaflet map layer upon receiving `threat_updated` with `status: "inactive"`.

### Coordinate Convention:
* **APIs, Payloads & Leaflet**: `{ "lat": Float, "lon": Float }` or `[lat, lon]` (Latitude first).
* **PostGIS SQL**: `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` (**Longitude first**, WGS 84). Valid operational boundaries: Israel Theater ($\text{Lat} \in [29.0, 33.5], \text{Lon} \in [34.0, 36.0]$).

---

## 3. REST API Endpoints

Base URL: `http://<host>:8000/api/v1`

Standard Error Response Format:
```json
{
  "detail": "Descriptive error message"
}
```

---

### Authentication (`/auth`)

* **POST `/auth/login`**
  * **Request Body:**
    ```json
    {
      "username": "command_north",
      "password": "secret_password"
    }
    ```
  * **Response (200 OK):**
    ```json
    {
      "access_token": "eyJhbGciOi...",
      "token_type": "bearer",
      "user": {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "username": "command_north",
        "role": "AreaCommandCenter",
        "area": "North",
        "name": "Northern Command Center",
        "status": "active"
      }
    }
    ```

* **GET `/auth/me`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Returns profile of the authenticated user. Used by Frontend on page refresh (F5) to rehydrate user state.
  * **Response (200 OK):**
    ```json
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "username": "command_north",
      "role": "AreaCommandCenter",
      "area": "North",
      "name": "Northern Command Center",
      "status": "active"
    }
    ```

---

### Administration & Unit Management (`/admin`) — *MainCommandCenter Only*

* **GET `/admin/users`**
  * **Headers:** `Authorization: Bearer <JWT>` (Must have `role: "MainCommandCenter"` and `status: "active"`)
  * **Description:** Retrieves all registered units for administrative management.
  * **Response (200 OK):**
    ```json
    [
      {
        "id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
        "username": "squad_bravo",
        "role": "SapperSquad",
        "area": "Center",
        "name": "Bravo Assault Team",
        "description": "Primary reconnaissance squad",
        "status": "active",
        "lat": 32.0853,
        "lon": 34.7818,
        "soldiers": [
          { "id": "1234567", "name": "David Cohen", "role": "rifleman" },
          { "id": "7654321", "name": "Yossi Levi", "role": "sapper" }
        ],
        "created_at": "2026-10-08T15:00:00Z"
      }
    ]
    ```

* **POST `/admin/users`**
  * **Headers:** `Authorization: Bearer <JWT>` (Must have `role: "MainCommandCenter"` and `status: "active"`)
  * **Description:** Creates a new squad, operational command center, or radar unit. Accepts initial coordinates (`lat`, `lon`), from which the server automatically calculates and assigns the `area` (`North`, `Center`, or `South`; for `MainCommandCenter` defaults to `'Global'`). For squads (`Squad`, `SapperSquad`), `soldiers` is required (array of objects with 7-digit ID, name, role); for command centers and radars, `soldiers` is optional. If any soldier has `role: "sapper"`, the unit's role is automatically assigned as `SapperSquad`. Automatically creates the initial record in `map_entities` for field units.
  * **Request Body:**
    ```json
    {
      "username": "squad_bravo",
      "password": "secure_password",
      "role": "Squad",
      "name": "Bravo Assault Team",
      "description": "Primary reconnaissance squad",
      "lat": 32.0853,
      "lon": 34.7818,
      "soldiers": [
        { "id": "1234567", "name": "David Cohen", "role": "rifleman" },
        { "id": "7654321", "name": "Yossi Levi", "role": "sapper" }
      ]
    }
    ```
  * **Response (201 Created):**
    ```json
    {
      "id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "username": "squad_bravo",
      "role": "SapperSquad",
      "area": "Center",
      "name": "Bravo Assault Team",
      "description": "Primary reconnaissance squad",
      "status": "active",
      "lat": 32.0853,
      "lon": 34.7818,
      "soldiers": [
        { "id": "1234567", "name": "David Cohen", "role": "rifleman" },
        { "id": "7654321", "name": "Yossi Levi", "role": "sapper" }
      ],
      "created_at": "2026-10-08T15:00:00Z"
    }
    ```

* **PATCH `/admin/users/{user_id}/status`**
  * **Headers:** `Authorization: Bearer <JWT>` (Must have `role: "MainCommandCenter"`)
  * **Description:** Soft-delete / deactivate unit. Server updates `users.status = 'inactive'`, disconnects any active socket for this unit, and broadcasts `unit_status_changed` via WebSocket to inform connected clients to remove the unit marker from the map.
  * **Request Body:**
    ```json
    {
      "status": "inactive"
    }
    ```
  * **Response (200 OK):**
    ```json
    {
      "id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "status": "inactive"
    }
    ```

---

### Threats Management (`/threats`)

* **POST `/threats`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Reported by units or command centers. Coordinates can originate from GPS position or by clicking on the map. Validates RBAC rules, stores to DB, and **broadcasts `threat_created` via WebSocket** to all clients within visible range.
  * **Request Body:**
    ```json
    {
      "type": "immovable",
      "name": "IED Blockade Route 4",
      "description": "Suspicious explosive device spotted near crossroads",
      "threat_type": "explosive",
      "severity_level": "high",
      "radius": 150.0,
      "lat": 32.0800,
      "lon": 34.7800,
      "altitude": null
    }
    ```
  * **Response (201 Created):**
    ```json
    {
      "id": "8f12c3b2-7634-4de2-bc51-03912da74e11",
      "type": "immovable",
      "name": "IED Blockade Route 4",
      "description": "Suspicious explosive device spotted near crossroads",
      "threat_type": "explosive",
      "severity_level": "high",
      "engagement_status": "unassigned",
      "assigned_to_id": null,
      "radius": 150.0,
      "lat": 32.0800,
      "lon": 34.7800,
      "altitude": null,
      "status": "active",
      "created_by_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "created_at": "2026-10-08T16:00:00Z",
      "updated_at": "2026-10-08T16:00:00Z"
    }
    ```

* **PATCH `/threats/{threat_id}`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Updates engagement status (`in_progress`, `resolved`), assigned squad, danger radius, coordinates (movable only), or deactivates threat (`status: inactive`). Validates RBAC matrix and **broadcasts `threat_updated` via WebSocket** to authorized clients.
  * **Request Body (all fields optional):**
    ```json
    {
      "engagement_status": "in_progress",
      "assigned_to_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "radius": 150.0,
      "status": "active",
      "lat": null,
      "lon": null,
      "altitude": null
    }
    ```
  * **Response (200 OK):**
    ```json
    {
      "id": "8f12c3b2-7634-4de2-bc51-03912da74e11",
      "type": "immovable",
      "name": "IED Blockade Route 4",
      "description": "Suspicious explosive device spotted near crossroads",
      "threat_type": "explosive",
      "severity_level": "high",
      "engagement_status": "in_progress",
      "assigned_to_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "radius": 150.0,
      "lat": 32.0800,
      "lon": 34.7800,
      "altitude": null,
      "status": "active",
      "created_by_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "created_at": "2026-10-08T16:00:00Z",
      "updated_at": "2026-10-08T16:05:00Z"
    }
    ```

---

### Map & Entities Snapshot (`/map`)

* **GET `/map/snapshot`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Returns the active tactical snapshot filtered according to caller role, zone, and 20 km visibility radius rules.
  * *Note:* The `squads` array contains all active tactical field units (roles: `Squad`, `SapperSquad`, `Radar`).
  * **Response (200 OK):**
    ```json
    {
      "squads": [
        {
          "id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
          "name": "Bravo Assault Team",
          "description": "Primary reconnaissance squad",
          "role": "SapperSquad",
          "area": "Center",
          "lat": 32.0853,
          "lon": 34.7818,
          "heading": 90.0,
          "status": "active",
          "updated_at": "2026-10-08T16:05:00Z",
          "soldiers": [
            { "id": "1234567", "name": "David Cohen", "role": "rifleman" },
            { "id": "7654321", "name": "Yossi Levi", "role": "sapper" }
          ]
        }
      ],
      "threats": [
        {
          "id": "8f12c3b2-7634-4de2-bc51-03912da74e11",
          "type": "immovable",
          "name": "IED Blockade Route 4",
          "description": "Suspicious explosive device spotted near crossroads",
          "threat_type": "explosive",
          "severity_level": "high",
          "engagement_status": "in_progress",
          "assigned_to_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
          "radius": 150.0,
          "lat": 32.0800,
          "lon": 34.7800,
          "altitude": null,
          "status": "active",
          "created_by_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
          "created_at": "2026-10-08T16:00:00Z",
          "updated_at": "2026-10-08T16:05:00Z"
        }
      ]
    }
    ```

---

## 4. WebSocket Protocol (Socket.IO)

> **Handshake Auth & Security:**
> Token must be passed in the `auth` object:
> ```javascript
> const socket = io("http://localhost:8000", {
>   path: "/socket.io",
>   auth: {
>     token: `Bearer ${accessToken}`
>   }
> });
> ```
> * **Active Status Enforcement:** Server verifies JWT signature and validates that `user.status == "active"`. If user is inactive or deactivated, handshake fails with `connect_error`.
> * **Socket Error Handling on Client:** Frontend listens for `socket.on("connect_error", (err) => ...)` to detect authentication failure and redirect to login if necessary.

### Client ➔ Server Events

1. **`location_update`**
   * **Sender:** Field units (`Squad`, `SapperSquad`, `Radar`).
   * **Trigger:** Sent when GPS position shifts by more than **5 meters** (max rate: 1 update/sec).
   * **Payload:**
     ```json
     {
       "lat": 32.0853,
       "lon": 34.7818,
       "heading": 90.0
     }
     ```
   * *Note: Unit ID is derived securely from the authenticated socket session token.*

### Server ➔ Client Events

1. **`squad_moved`**
   * **Trigger:** Broadcast when a unit's position is updated. Dispatched to MainCommandCenter, relevant AreaCommandCenter, and field units within 20 km.
   * **Payload:**
     ```json
     {
       "id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
       "lat": 32.0853,
       "lon": 34.7818,
       "heading": 90.0,
       "updated_at": "2026-10-08T16:05:00Z"
     }
     ```

2. **`unit_status_changed`**
   * **Trigger:** Broadcast when an admin deactivates a unit (`PATCH /admin/users/{id}/status`).
   * **Payload:**
     ```json
     {
       "id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
       "status": "inactive"
     }
     ```
   * *Frontend action:* Immediately remove this unit marker from the map.

3. **`threat_created`**
   * **Trigger:** Broadcast when a new threat is created via `POST /threats`.
   * **Payload:** Complete Threat object (matches `POST /threats` 201 response).

4. **`threat_updated`**
   * **Trigger:** Broadcast when a threat is modified, assigned, moved, or resolved via `PATCH /threats/{id}`.
   * **Payload:** Complete updated Threat object (matches `PATCH /threats/{id}` 200 response). If `status: "inactive"`, frontend removes the marker.

---

### Phase 2 Socket Events (Post-MVP Chat)
* Client ➔ Server: `chat_message` (`{ "recipient_id": "uuid | null", "text": "string" }`)
* Server ➔ Client: `chat_broadcast` (`{ "sender_id": "uuid", "text": "string", "timestamp": "ISO-string" }`)

---

## 5. Database Schema (PostgreSQL 15+ & PostGIS)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Users / Accounts Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('MainCommandCenter', 'AreaCommandCenter', 'Squad', 'SapperSquad', 'Radar')),
    area VARCHAR(20) NOT NULL CHECK (area IN ('Center', 'North', 'South', 'Global')),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Soldiers Table (7-digit IDs, flexible tactical roles)
CREATE TABLE soldiers (
    id VARCHAR(7) PRIMARY KEY, -- exactly 7 digits
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) DEFAULT 'rifleman' -- e.g., 'sapper', 'medic', 'rifleman', 'recon'
);

-- 3. Live Entity Locations & State (Map Entities)
CREATE TABLE map_entities (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    geom GEOMETRY(Point, 4326) NOT NULL, -- PostGIS coordinates (SRID 4326: lon/lat)
    heading FLOAT DEFAULT 0.0 CHECK (heading >= 0.0 AND heading <= 360.0),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Threats Table (Operational hazards)
CREATE TABLE threats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('movable', 'immovable')),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    threat_type VARCHAR(50) NOT NULL CHECK (threat_type IN ('explosive', 'vehicle', 'drone', 'personnel')),
    severity_level VARCHAR(20) NOT NULL CHECK (severity_level IN ('low', 'medium', 'high', 'critical')),
    engagement_status VARCHAR(30) DEFAULT 'unassigned' CHECK (engagement_status IN ('unassigned', 'in_progress', 'resolved')),
    assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    altitude FLOAT DEFAULT NULL, -- Altitude in meters (drone threats)
    radius FLOAT DEFAULT 150.0,  -- Danger radius buffer in meters
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Chat History Table (Phase 2 - Post-MVP)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES users(id),
    recipient_id UUID REFERENCES users(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Spatial Indexes
CREATE INDEX idx_map_entities_geom ON map_entities USING GIST (geom);
CREATE INDEX idx_threats_geom ON threats USING GIST (geom);
```

---

## 6. Ports, Network & Integration Conventions

| Service | Host & Port | Notes |
|---|---|---|
| **Backend REST API** | `http://localhost:8000/api/v1` | FastAPI with CORS configured for `http://localhost:5173` |
| **Backend WebSocket** | `http://localhost:8000` (path: `/socket.io`) | python-socketio ASGI mount |
| **Frontend Dev Server** | `http://localhost:5173` | Vite dev server |
| **Database** | `localhost:5432` | PostgreSQL + PostGIS via Docker Compose |