# Tactical Pulse — API, WebSocket Contract & Database Schemas

This document defines the formal contract, communication protocol, and database schema for Frontend (React + Zustand + Leaflet Canvas + Socket.IO Client) and Backend (FastAPI + python-socketio + PostgreSQL/PostGIS).

---

## 1. Zones & Visibility Rules

The map of Israel is divided into three operational areas defined by latitude boundaries:
* **`North`**: Lat $\ge 32.7000$
* **`Center`**: $31.9000 \le \text{Lat} < 32.7000$
* **`South`**: Lat $< 31.9000$

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
| **Update Position (`lat`, `lon`)** | Fixed (cannot move) | **`Squad`**, `SapperSquad`, `Radar`, `CommandCenter` | **`Radar` only** (or Command Center) |
| **Resolve (`resolved`)** | **`SapperSquad` only** (or Command Center) | Engaging Squad or Command Center | Engaging Squad or Command Center |
| **Deactivate (`inactive`)** | Command Center or assigned `SapperSquad` | Command Center or engaging Squad | Command Center or engaging Squad |

> **RBAC Security Rule for `PATCH /threats/{id}`:**
> If `threat_type == "drone"` and caller role is a regular `Squad` / `SapperSquad` attempting to alter coordinates (`lat`, `lon`, `altitude`), the server strictly returns `403 Forbidden` (`"Only Radar or Command Center can update aerial drone telemetry"`). Moving ground forces (`personnel`, `vehicle`) can be updated directly by field squads upon visual contact.

### Threat Visual Lifecycle & Map Behavior:
1. **`unassigned`**: Active threat. Rendered as a red hazard marker with a highlighted danger radius buffer (default 150m).
2. **`in_progress`**: Under active mitigation. Rendered as a yellow marker showing the assigned squad badge.
3. **`resolved`**: Neutralized hazard. Rendered as a green/neutralized marker on the map to inform friendly units that the area has been cleared.
4. **`inactive`**: Archived threat. Excluded from `GET /map/snapshot` and removed from the active Leaflet map layer upon receiving `threat_updated` with `status: "inactive"`.

### Coordinate Convention:
* **APIs, Payloads & Leaflet**: `{ "lat": Float, "lon": Float }` or `[lat, lon]` (Latitude first).
* **PostGIS SQL**: `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` (**Longitude first**, WGS 84).

---

## 3. REST API Endpoints

Base URL: `http://<host>/api/v1`

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
      "refresh_token": "dGhpcyBpcyBh...",
      "token_type": "bearer",
      "expires_in": 3600,
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

> **Rate Limiting:** `POST /auth/login` is rate-limited to 5 attempts per minute per IP/username. After 10 consecutive failed attempts, the account is temporarily locked for 15 minutes.

* **POST `/auth/refresh`**
  * **Request Body:**
    ```json
    {
      "refresh_token": "dGhpcyBpcyBh..."
    }
    ```
  * **Response (200 OK):**
    ```json
    {
      "access_token": "eyJhbGciOi...(new)...",
      "expires_in": 3600
    }
    ```

* **POST `/auth/logout`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Invalidates the current access and refresh tokens. Terminates any active WebSocket connections associated with this user.
  * **Response (200 OK):**
    ```json
    {
      "message": "Logged out successfully"
    }
    ```

---

### Administration & Unit Management (`/admin`) — *MainCommandCenter Only*
* **POST `/admin/users`**
  * **Headers:** `Authorization: Bearer <JWT>` (Must have `role: "MainCommandCenter"` and `status: "active"`)
  * **Description:** Creates a new squad, operational center, or radar unit. Accepts initial coordinates (`lat`, `lon`), from which the server automatically calculates and assigns the `area` (`North`, `Center`, or `South`; for `MainCommandCenter` defaults to `'Global'`). For squads, `soldiers` is required (array of objects with 7-digit ID, name, role); for command centers and radars, `soldiers` is optional. If any soldier in a squad has `role: "sapper"`, the unit's role is automatically assigned as `SapperSquad`. Also automatically creates the initial record in `map_entities`.
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
      ]
    }
    ```

* **PATCH `/admin/users/{user_id}/status`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Soft-delete / deactivate unit.
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
  * **Description:** Submitted by client when reporting a threat. The coordinates (`lat`, `lon`) can originate either from the reporting unit's current GPS position or interactively by clicking a point on the tactical map. Server validates role permissions, saves the threat to DB, and **broadcasts `threat_created` via WebSocket** to all clients within visible range.
  * **Coordinate Validation:** Server enforces geographic bounding box: `lat` must be within `[29.0, 34.0]`, `lon` within `[33.5, 36.5]`, and `altitude` (if provided) must be `>= 0`. Requests with out-of-bounds coordinates are rejected with `422 Unprocessable Entity`.
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
  * **Description:** Updates engagement status (e.g. `in_progress`, `resolved`), assigned squad, coordinates (movable only), danger radius, or deactivates threat (`status: inactive`). Server validates RBAC matrix and **broadcasts `threat_updated` via WebSocket** to authorized clients.
  * **Concurrency Control:** If `engagement_status` is being changed to `in_progress`, the server verifies the threat is still `unassigned`. If another squad has already taken responsibility, the server returns `409 Conflict` with the details of the currently assigned squad.
  * **Request Body:**
    ```json
    {
      "engagement_status": "in_progress",
      "assigned_to_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "radius": 150.0,
      "status": "active",
      "lat": null,
      "lon": null
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
      "updated_at": "2026-10-08T16:05:00Z"
    }
    ```

---

### Map & Entities Snapshot (`/map`)
* **GET `/map/snapshot`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Returns the active tactical snapshot filtered according to caller role, zone, and 20 km visibility radius rules.
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
> const socket = io(SOCKET_URL, {
>   auth: {
>     token: `Bearer ${accessToken}`
>   }
> });
> ```
> * **Active Status Enforcement:** Server verifies JWT signature and validates that `user.status == "active"`. If a user is deactivated (`status: "inactive"`), the handshake is rejected with `401/403`, and any currently active socket connection is terminated immediately.

### Client ➔ Server Events

1. **`location_update`**
   * **Trigger:** Sent by a squad when its GPS position shifts by more than **5 meters**.
   * **Payload:**
     ```json
     {
       "lat": 32.0853,
       "lon": 34.7818,
       "heading": 90.0
     }
     ```
   * *Note: The squad ID is extracted securely from the authenticated socket session token.*

2. **`heartbeat`**
   * **Trigger:** Sent by client every **30 seconds** to signal active connection.
   * **Payload:** `{}` (empty object — user identity is derived from authenticated session).
   * *Note: If no `heartbeat` or `location_update` is received for **60 seconds**, the unit is considered stale and rendered greyed out on tactical maps.*

### Server ➔ Client Events

1. **`squad_moved`**
   * **Trigger:** Broadcast when a squad's position is updated. Sent to clients whose visibility range covers the position.
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

2. **`threat_created`**
   * **Trigger:** Broadcast when a new threat is created via `POST /threats`.
   * **Payload:** Full threat object (matches `POST /threats` response).

3. **`threat_updated`**
   * **Trigger:** Broadcast when a threat is modified, assigned, moved, resolved, or archived (`status: "inactive"`).
   * **Payload:** Full updated threat object.
   * *Note: If `status == "inactive"`, the client removes the threat marker from the map layer.*

4. **`unit_status_changed`**
   * **Trigger:** Broadcast when a unit is deactivated via `PATCH /admin/users/{id}/status`.
   * **Payload:**
     ```json
     {
       "id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
       "status": "inactive"
     }
     ```
   * *Note: If `status == "inactive"`, other clients remove the unit marker from the map immediately.*

### Reconnection Strategy
> When a WebSocket connection drops, the client must:
> 1. Attempt automatic reconnection with **exponential backoff** (1s, 2s, 4s, 8s, max 30s).
> 2. On successful reconnect, immediately call `GET /map/snapshot` to re-sync full tactical state.
> 3. Re-authenticate via `auth.token` in the Socket.IO handshake (refresh the JWT if expired).

---

### Phase 2 Socket Events (Chat & Commands — Post-MVP)
* Client ➔ Server: `chat_message` (`{ "recipient_id": "uuid | null", "text": "string" }`)
* Server ➔ Client: `chat_broadcast` (`{ "sender_id": "uuid", "text": "string", "timestamp": "ISO-string" }`)

---

## 5. Error Response Format

All API errors follow a consistent structure:
```json
{
  "error": {
    "code": "THREAT_ALREADY_ASSIGNED",
    "message": "This threat is already being handled by another squad",
    "status": 409,
    "details": {}
  }
}
```

| HTTP Status | Error Code | Description |
|-------------|-----------|-------------|
| 400 | `INVALID_REQUEST` | Malformed request body or missing required fields |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT token |
| 403 | `FORBIDDEN` | Insufficient role permissions (RBAC violation) |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Concurrent modification or duplicate resource |
| 422 | `VALIDATION_ERROR` | Coordinates out of bounds or invalid field values |
| 429 | `RATE_LIMITED` | Too many requests (login brute-force protection) |

---

## 6. Database Schema (PostgreSQL 15+ & PostGIS)

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
    id VARCHAR(7) PRIMARY KEY CHECK (id ~ '^\d{7}$'), -- exactly 7 digits, enforced
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) DEFAULT 'rifleman' -- e.g., 'sapper', 'medic', 'rifleman', 'recon'
);

-- 3. Live Entity Locations & State (Map Entities)
-- Stores real-time spatial position & heading for active units
CREATE TABLE map_entities (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    geom GEOMETRY(Point, 4326) NOT NULL, -- PostGIS coordinates (SRID 4326: lon/lat)
    heading FLOAT DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Threats Table (Operational hazards)
CREATE TABLE threats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('movable', 'immovable')),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    threat_type VARCHAR(50) NOT NULL, -- 'explosive', 'vehicle', 'drone', 'personnel'
    severity_level VARCHAR(20) NOT NULL CHECK (severity_level IN ('low', 'medium', 'high', 'critical')),
    engagement_status VARCHAR(30) DEFAULT 'unassigned' CHECK (engagement_status IN ('unassigned', 'in_progress', 'resolved')),
    assigned_to_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    geom GEOMETRY(Point, 4326) NOT NULL,
    altitude FLOAT DEFAULT NULL, -- Altitude in meters (aerial threats)
    radius FLOAT DEFAULT 150.0, -- Danger radius buffer in meters
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT valid_lifecycle CHECK (
        NOT (status = 'inactive' AND engagement_status = 'in_progress')
    ),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Audit Log Table (Operational accountability — Phase 1 MVP)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(50) NOT NULL, -- e.g., 'login_success', 'login_failed', 'threat_created', 'threat_updated', 'user_deactivated'
    resource_type VARCHAR(50),   -- e.g., 'threat', 'user', 'map_entity'
    resource_id UUID,
    details JSONB,               -- Additional context (old/new values, reason, etc.)
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Chat History Table (Phase 2 - Post-MVP)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recipient_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for broadcast
    text TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Spatial Indexes
CREATE INDEX idx_map_entities_geom ON map_entities USING GIST (geom);
CREATE INDEX idx_threats_geom ON threats USING GIST (geom);

-- Query Performance & Audit Indexes
CREATE INDEX idx_users_role_area_status ON users(role, area, status);
CREATE INDEX idx_threats_status ON threats(status, engagement_status);
CREATE INDEX idx_threats_assigned ON threats(assigned_to_id);
CREATE INDEX idx_soldiers_user ON soldiers(user_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action, created_at);
```