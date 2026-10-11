# Tactical Pulse — API, WebSocket Contract & Database Schemas

This document defines the formal contract, communication protocol, and database schema for Frontend (React + Zustand + Leaflet Canvas + Socket.IO Client) and Backend (FastAPI + python-socketio + PostgreSQL/PostGIS).

---

## 1. Zones & Visibility Rules

The map of Israel is divided into three operational areas defined by latitude boundaries within operational bounds ($[29.0, 34.0]$):
* **`North`**: $32.7000 \le \text{Lat} \le 34.0000$
* **`Center`**: $31.9000 \le \text{Lat} < 32.7000$
* **`South`**: $29.0000 \le \text{Lat} < 31.9000$

### Visibility Permissions:
1. **`MainCommandCenter`**: Global visibility (`area = 'Global'`) — sees all squads, radars, and threats across all zones without restrictions.
2. **`AreaCommandCenter`**: Regional visibility — sees all entities and threats located strictly inside its assigned zone (`Center`, `North`, or `South`).
3. **`Squad` / `SapperSquad` / `Radar`**: Tactical visibility — sees other squads and threats within a **20 km radius** (`20000` meters, calculated in PostGIS via `ST_DWithin(u.geom::geography, target.geom::geography, 20000)`) from their current position, plus their own unit at distance 0.

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
* **PostGIS SQL**: `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` (**Longitude first**, WGS 84). Valid operational boundaries: Israel Theater ($\text{Lat} \in [29.0, 34.0], \text{Lon} \in [33.5, 36.5]$).

---

## 3. REST API Endpoints

Base URL: `http://<host>:8000/api/v1`

All endpoints follow the unified Error Response Format defined in **Section 5**:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Descriptive human-readable error message",
    "status": 400,
    "details": {}
  }
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
      "refresh_token": "dGhpcyBpcyBh...(rotated)...",
      "token_type": "bearer",
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
  * **Description:** Creates a new squad, operational command center, or radar unit. Coordinates (`lat`, `lon` within operational bounds) are required for field units (`Squad`, `SapperSquad`, `Radar`), from which the server automatically calculates and assigns `area` (`North`, `Center`, or `South`). For `MainCommandCenter`, `area` is automatically assigned as `'Global'` (coordinates optional). For `AreaCommandCenter`, `area` can be passed explicitly (`North`, `Center`, `South`) or derived from `lat`. For squads (`Squad`, `SapperSquad`), `soldiers` is required (array of objects with 7-digit ID, name, role); for command centers and radars, `soldiers` is optional (defaults to `[]`). If any soldier has `role: "sapper"`, the unit's role is automatically assigned as `SapperSquad`. Automatically creates the initial record in `map_entities` for field units.
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
  * **Description:** Reported by units or command centers. The coordinates (`lat`, `lon`) can originate either from the reporting unit's current GPS position or interactively by clicking a point on the tactical map. Server validates role permissions (RBAC), saves the threat to DB, and **broadcasts `threat_created` via WebSocket** to all clients within visible range.
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
  * **Description:** Updates engagement status (e.g. `in_progress`, `resolved`), assigned squad, coordinates (movable only), danger radius, severity level, description, or deactivates threat (`status: inactive`). Validates RBAC matrix and **broadcasts `threat_updated` via WebSocket** to authorized clients.
  * **Concurrency Control:** If `engagement_status` is being changed to `in_progress`, the server verifies the threat is still `unassigned`. If another squad has already taken responsibility, the server returns `409 Conflict` with the details of the currently assigned squad.
  * **Unassignment Rule:** If `engagement_status` is transitioned back to `unassigned`, `assigned_to_id` is automatically reset to `null`.
  * **Coordinate Handling:** For `lat` and `lon`, omitting the field or sending `null` leaves existing coordinates unchanged. For `immovable` threats, sending non-null coordinates is rejected with `400 Bad Request`. For `drone` threats, only `Radar` or `CommandCenter` may provide coordinates.
  * **Request Body (all fields optional):**
    ```json
    {
      "engagement_status": "in_progress",
      "assigned_to_id": "e4b2a38a-3652-4a0b-930f-b1e15fa4d921",
      "severity_level": "high",
      "description": "Updated tactical reconnaissance notes",
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

* **GET `/threats`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Query Parameters (optional):**
    * `status`: Filter by lifecycle status (`active`, `inactive`; default: `active`).
    * `engagement_status`: Filter by handling status (`unassigned`, `in_progress`, `resolved`).
    * `threat_type`: Filter by type (`explosive`, `vehicle`, `drone`, `personnel`).
  * **Description:** Retrieves threats visible to caller based on RBAC and spatial visibility rules.
  * **Response (200 OK):** Array of Threat objects matching the Threat schema.

---

### Map & Entities Snapshot (`/map`)

* **GET `/map/snapshot`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Returns the active tactical snapshot filtered according to caller role, zone, and 20 km visibility radius rules.
  * *Note:* The `squads` array contains all active tactical field units (roles: `Squad`, `SapperSquad`, `Radar`). For units without personnel (e.g. Radars), `soldiers` defaults to `[]`.
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
   * **Trigger:** Sent when GPS position shifts by more than **5 meters** (max rate: 1 update/sec), OR periodically every **30 seconds** as a keep-alive telemetry ping if stationary.
   * **Payload:**
     ```json
     {
       "lat": 32.0853,
       "lon": 34.7818,
       "heading": 90.0
     }
     ```
   * *Note: Unit ID is derived securely from the authenticated socket session token. `heading` is optional (float `[0.0, 360.0]`, defaults to `0.0`).*

2. **`heartbeat`**
   * **Trigger:** Sent by client every **30 seconds** to signal active connection and prevent connection timeouts.
   * **Payload:** `{}` (empty object — user identity is derived from authenticated session).
   * **Server action:** Updates `map_entities.updated_at = CURRENT_TIMESTAMP` for the sending unit.
   * *Note: If neither `location_update` nor `heartbeat` is received for **60 seconds**, the unit is considered stale and rendered greyed out on tactical maps.*

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
       "area": "Center",
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
   * **Trigger:** Broadcast when a threat is modified, assigned, moved, resolved, or archived (`status: "inactive"`).
   * **Payload:** Complete updated Threat object (matches `PATCH /threats/{id}` 200 response). If `status: "inactive"`, the client removes the threat marker from the map layer.

### Reconnection Strategy
> When a WebSocket connection drops, the client must:
> 1. Attempt automatic reconnection with **exponential backoff** (1s, 2s, 4s, 8s, max 30s).
> 2. On successful reconnect, immediately call `GET /map/snapshot` to re-sync full tactical state.
> 3. Re-authenticate via `auth.token` in the Socket.IO handshake (refresh the JWT if expired).

---

### Phase 2 Socket Events (Post-MVP Chat)
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
CREATE TABLE map_entities (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
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
    assigned_to_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    geom GEOMETRY(Point, 4326) NOT NULL,
    altitude FLOAT DEFAULT NULL, -- Altitude in meters (drone threats)
    radius FLOAT DEFAULT 150.0,  -- Danger radius buffer in meters
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT valid_threat_type CHECK (
        (threat_type = 'explosive' AND type = 'immovable') OR
        (threat_type IN ('vehicle', 'drone', 'personnel') AND type = 'movable')
    ),
    CONSTRAINT valid_lifecycle CHECK (
        NOT (status = 'inactive' AND engagement_status = 'in_progress')
    ),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Audit Log Table (Operational accountability — Phase 1 MVP)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for failed logins with non-existent users
    action VARCHAR(50) NOT NULL, -- Standard actions: 'login_success', 'login_failed', 'token_refresh', 'logout', 'user_created', 'user_deactivated', 'threat_created', 'threat_updated', 'threat_resolved', 'threat_deactivated'
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

---

## 7. Ports, Network & Integration Conventions

| Service | Host & Port | Notes |
|---|---|---|
| **Backend REST API** | `http://localhost:8000/api/v1` | FastAPI with CORS configured for `http://localhost:5173` |
| **Backend WebSocket** | `http://localhost:8000` (path: `/socket.io`) | python-socketio ASGI mount |
| **Frontend Dev Server** | `http://localhost:5173` | Vite dev server |
| **Database** | Supabase (Cloud) | PostgreSQL 15+ with PostGIS extension |

---

## 8. Dev & Demo Seed Inventory (`backend/app/db/seed.py`)

All development, testing, and UI demo accounts use standardized fixtures:

### Users & Tactical Units

| Username | Default Password | Role | Area | Initial Lat, Lon | Heading | Soldiers |
|---|---|---|---|---|---|---|
| `admin` | `admin123` | `MainCommandCenter` | `Global` | `null, null` | `0.0` | `[]` |
| `command_north` | `command123` | `AreaCommandCenter` | `North` | `33.0000, 35.3000` | `0.0` | `[]` |
| `command_center` | `command123` | `AreaCommandCenter` | `Center` | `32.1000, 34.8000` | `0.0` | `[]` |
| `command_south` | `command123` | `AreaCommandCenter` | `South` | `31.2000, 34.7000` | `0.0` | `[]` |
| `squad_golani` | `squad123` | `Squad` | `Center` | `32.0853, 34.7818` | `90.0` | `1000001` (Rifleman), `1000002` (Medic), `1000003` (Recon) |
| `squad_paratroopers` | `squad123` | `SapperSquad` | `Center` | `32.0920, 34.7890` | `180.0` | `2000001` (Rifleman), `2000002` (Sapper), `2000003` (Sapper) |
| `radar_post_1` | `radar123` | `Radar` | `North` | `33.1500, 35.5000` | `45.0` | `[]` |

### Initial Demo Threats

| Name | Type | Threat Type | Severity | Status | Engagement | Lat, Lon | Altitude | Radius |
|---|---|---|---|---|---|---|---|---|
| `IED Blockade Route 4` | `immovable` | `explosive` | `high` | `active` | `unassigned` | `32.0800, 34.7800` | `null` | `150.0m` |
| `Hostile Recon Drone` | `movable` | `drone` | `critical` | `active` | `unassigned` | `33.1800, 35.5200` | `450.0m` | `300.0m` |
