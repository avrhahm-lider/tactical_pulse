# Tactical Pulse — API, WebSocket Contract & Database Schemas

This document defines the contract, communication protocol, and database schema for Frontend (React + Zustand + Socket.IO Client) and Backend (FastAPI + python-socketio + PostgreSQL/PostGIS).

---

## 1. Zones & Visibility Rules

The map is divided into three operational areas:
* `Center`
* `North`
* `South`

### Visibility Permissions:
1. **`MainCommandCenter`**: Has global visibility — sees all squads, radars, and threats across all zones without restrictions.
2. **`AreaCommandCenter`**: Has regional visibility — sees all entities and threats strictly inside its assigned zone (`Center`, `North`, or `South`), determined dynamically by its initial location on the map.
3. **`Squad` / `SapperSquad` / `Radar`**: Tactical visibility — sees other squads and threats within a **20 km radius** (`20000` meters) from their current position.

---

## 2. REST API Endpoints

Base URL: `http://<host>/api/v1`

### Authentication (`/auth`)
* **POST `/auth/login`**
  * **Request Body:** User credentials (`username`, `password`).
  * **Response (200):** 
    ```json
    {
      "access_token": "eyJhbGciOi...",
      "user": {
        "id": "uuid-string",
        "username": "string",
        "role": "MainCommandCenter",
        "area": "Center",
        "status": "active"
      }
    }
    ```

### Administration & User Management (`/admin`) — *MainCommandCenter Only*
* **POST `/admin/users`**
  * **Headers:** `Authorization: Bearer <JWT>` (Must belong to `MainCommandCenter`)
  * **Description:** Creates a new squad, operational center, or radar unit. You pass initial coordinates (`lat`, `lon`), and the server automatically calculates and assigns the operational `area` (`Center`, `North`, or `South`). For squads, you specify a `name`, `description`, and soldiers array. If any soldier has `is_sapper: true`, the role automatically resolves to `SapperSquad`.
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
        { "id": "1234567", "name": "John Doe", "is_sapper": false },
        { "id": "7654321", "name": "Jane Smith", "is_sapper": true }
      ]
    }
    ```
  * **Response (201):** 
    ```json
    {
      "id": "uuid-string",
      "username": "squad_bravo",
      "role": "SapperSquad",
      "area": "North", // Calculated automatically by server geometry intersection
      "name": "Bravo Assault Team",
      "description": "Primary reconnaissance squad",
      "status": "active",
      "soldiers": [
        { "id": "1234567", "name": "John Doe", "is_sapper": false },
        { "id": "7654321", "name": "Jane Smith", "is_sapper": true }
      ]
    }
    ```

* **PATCH `/admin/users/{user_id}/status`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Soft delete / deactivation. Changes status from `active` to `inactive`.
  * **Request Body:** `{ "status": "inactive" }`
  * **Response (200):** `{ "id": "uuid-string", "status": "inactive" }`

### Map & Entities (`/map`)
* **GET `/map/snapshot`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Returns active map snapshot filtered by user role, zone, and 20km radius rules.
  * **Response (200):**
    ```json
    {
      "squads": [
        {
          "id": "uuid-string",
          "name": "Bravo Assault Team",
          "description": "Primary reconnaissance squad",
          "role": "SapperSquad",
          "area": "North",
          "lat": 32.0853,
          "lon": 34.7818,
          "heading": 90.0,
          "status": "active"
        }
      ],
      "threats": [
        {
          "id": "uuid-string",
          "type": "immovable",
          "name": "IED Blockade",
          "description": "Suspicious object on main road",
          "threat_type": "explosive",
          "severity_level": "high",
          "engagement_status": "in_progress",
          "assigned_to_id": "uuid-string-of-squad",
          "lat": 32.0800,
          "lon": 34.7800,
          "altitude": null,
          "status": "active"
        }
      ]
    }
    ```

---

## 3. WebSocket Protocol (Socket.IO)

> **Important Note:** During the Socket.IO handshake, the JWT token must be provided inside the auth payload:
> `io(SOCKET_URL, { auth: { token: "Bearer <JWT>" } })`

### Client ➔ Server Events

1. **`location_update`**
   * **Trigger:** Sent by a squad when its position changes by more than 5 meters.
   * **Payload:**
     ```json
     {
       "lat": 32.0853,
       "lon": 34.7818,
       "heading": 90.0
     }
     ```

2. **`threat_create`**
   * **Trigger:** Creating a new threat marker on the map.
   * **Payload:**
     ```json
     {
       "type": "movable", // or "immovable"
       "name": "Hostile Drone",
       "description": "Low-flying aerial target",
       "threat_type": "drone",
       "severity_level": "medium",
       "lat": 32.0800,
       "lon": 34.7800,
       "altitude": 150.0
     }
     ```

3. **`threat_update_engagement`**
   * **Trigger:** When a squad takes responsibility for a threat or updates its progress state.
   * **Payload:**
     ```json
     {
       "threat_id": "uuid-string",
       "engagement_status": "in_progress" // 'unassigned', 'in_progress', 'resolved'
     }
     ```

4. **`threat_update_status`**
   * **Trigger:** Soft deletion / deactivation of a threat.
   * **Payload:**
     ```json
     {
       "threat_id": "uuid-string",
       "status": "inactive"
     }
     ```

5. **`chat_message`**
   * **Trigger:** Command center messaging.
   * **Payload:**
     ```json
     {
       "recipient_id": "uuid-string | null",
       "text": "string"
     }
     ```

### Server ➔ Client Events

1. **`squad_moved`**
   * **Payload:**
     ```json
     {
       "id": "uuid-string",
       "lat": 32.0853,
       "lon": 34.7818,
       "heading": 90.0,
       "updated_at": "timestamp"
     }
     ```

2. **`threat_updated`**
   * **Payload:**
     ```json
     {
       "id": "uuid-string",
       "type": "string",
       "name": "string",
       "description": "string",
       "threat_type": "string",
       "severity_level": "string",
       "engagement_status": "string",
       "assigned_to_id": "uuid-string | null",
       "lat": 32.0800,
       "lon": 34.7800,
       "altitude": 150.0,
       "status": "active",
       "updated_by_role": "string"
     }
     ```

3. **`chat_broadcast`**
   * **Payload:**
     ```json
     {
       "sender_id": "uuid-string",
       "text": "string",
       "timestamp": "string"
     }
     ```

---

## 4. Database Schema (PostgreSQL + PostGIS)

```sql
-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Users / Entities Table (Area is computed or stored based on location)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- MainCommandCenter, AreaCommandCenter, Squad, SapperSquad, Radar
    area VARCHAR(20) NOT NULL CHECK (area IN ('Center', 'North', 'South')), -- Determined by server on creation
    name VARCHAR(150), -- Display name for squads/centers
    description TEXT, -- Operational description
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Soldiers Table (7-digit IDs, names, assigned to squads)
CREATE TABLE soldiers (
    id VARCHAR(7) PRIMARY KEY, -- exactly 7 digits
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_sapper BOOLEAN DEFAULT FALSE
);

-- 3. Live Entity Locations & State (Map Entities)
CREATE TABLE map_entities (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- squad, threat, radar, command_center
    geom GEOMETRY(Point, 4326), -- PostGIS coordinates (lon/lat)
    heading FLOAT DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Threats Table (Specific properties for threats including altitude and handling status)
CREATE TABLE threats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('movable', 'immovable')), -- movement classification
    name VARCHAR(150) NOT NULL, -- Threat title/name
    description TEXT, -- Detailed description
    threat_type VARCHAR(50) NOT NULL, -- e.g., 'explosive', 'vehicle', 'drone', 'personnel'
    severity_level VARCHAR(20) NOT NULL CHECK (severity_level IN ('low', 'medium', 'high', 'critical')),
    engagement_status VARCHAR(30) DEFAULT 'unassigned' CHECK (engagement_status IN ('unassigned', 'in_progress', 'resolved')),
    assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Squad currently handling the threat
    geom GEOMETRY(Point, 4326),
    altitude FLOAT DEFAULT NULL, -- Height in meters (for aerial threats, null for ground)
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    updated_by_role VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Chat History Table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID REFERENCES users(id),
    recipient_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for broadcast
    text TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Spatial Indexes
CREATE INDEX idx_map_entities_geom ON map_entities USING GIST (geom);
CREATE INDEX idx_threats_geom ON threats USING GIST (geom);