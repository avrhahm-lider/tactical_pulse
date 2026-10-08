# Tactical Pulse — API, WebSocket Contract & Database Schemas

This document defines the contract, communication protocol, and database schema for Frontend (React + Zustand + Socket.IO Client) and Backend (FastAPI + python-socketio + PostgreSQL/PostGIS).

---

## 1. REST API Endpoints

Base URL: `http://<host>/api/v1`

### Authentication (`/auth`)
* **POST `/auth/login`**
  * **Request Body:** User credentials (`username`, `password`).
  * **Response (200):** 
    ```json
    {
      "access_token": "string",
      "token_type": "bearer",
      "user": {
        "id": "uuid-string",
        "username": "string",
        "role": "MainCommandCenter",
        "status": "active"
      }
    }
    ```

### Administration & User Management (`/admin`) — *MainCommandCenter Only*
* **POST `/admin/users`**
  * **Headers:** `Authorization: Bearer <JWT>` (Must belong to `MainCommandCenter`)
  * **Description:** Creates a new squad, operational center, or radar unit. For squads, pass an array of soldiers (each with a 7-digit ID and a name). If any soldier has `is_sapper: true`, the system automatically assigns the `SapperSquad` role.
  * **Request Body:**
    ```json
    {
      "username": "squad_bravo",
      "password": "secure_password",
      "role": "Squad",
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
  * **Description:** Returns active map snapshot (only `status: "active"` entities).
  * **Response (200):**
    ```json
    {
      "squads": [
        {
          "id": "uuid-string",
          "name": "string",
          "role": "SapperSquad",
          "lat": 0.0,
          "lng": 0.0,
          "status": "active"
        }
      ],
      "threats": [
        {
          "id": "uuid-string",
          "type": "immovable",
          "lat": 0.0,
          "lng": 0.0,
          "status": "active"
        }
      ]
    }
    ```

---

## 2. WebSocket Protocol (Socket.IO)

> **Important Note:** During the Socket.IO handshake, the JWT token must be provided inside the auth payload:
> `io(SOCKET_URL, { auth: { token: "Bearer <JWT>" } })`

### Client ➔ Server Events

1. **`location_update`**
   * **Trigger:** Sent by a squad when its position changes by more than 5 meters.
   * **Payload:**
     ```json
     {
       "lat": 32.0853,
       "lng": 34.7818,
       "heading": 90.0
     }
     ```

2. **`threat_create`**
   * **Trigger:** Creating a new threat marker on the map.
   * **Payload:**
     ```json
     {
       "type": "movable", // or "immovable"
       "lat": 32.0800,
       "lng": 34.7800,
       "description": "string"
     }
     ```

3. **`threat_update_status`**
   * **Trigger:** Soft deletion / resolution of a threat (setting status to `inactive`).
   * **Payload:**
     ```json
     {
       "threat_id": "uuid-string",
       "status": "inactive"
     }
     ```

4. **`chat_message`**
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
       "lat": 0.0,
       "lng": 0.0,
       "updated_at": "timestamp"
     }
     ```

2. **`threat_updated`**
   * **Payload:**
     ```json
     {
       "id": "uuid-string",
       "type": "string",
       "lat": 0.0,
       "lng": 0.0,
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

## 3. Database Schema (PostgreSQL + PostGIS)

```sql
-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Users / Entities Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- MainCommandCenter, AreaCommandCenter, Squad, SapperSquad, Radar
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
    geom GEOMETRY(Point, 4326), -- PostGIS coordinates (lat/lng)
    heading FLOAT DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Threats Table (Specific properties for threats)
CREATE TABLE threats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('movable', 'immovable')),
    geom GEOMETRY(Point, 4326),
    description TEXT,
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