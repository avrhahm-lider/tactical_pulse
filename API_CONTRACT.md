# Tactical Pulse — API & WebSocket Contract

This document defines the contract and communication protocol between the Frontend (React + Zustand + Socket.IO Client) and Backend (FastAPI + python-socketio).

---

## 1. REST API Endpoints

Base URL: `http://<host>/api/v1`

### Authentication (`/auth`)
* **POST `/auth/register`**
  * **Request Body:** User registration payload (`username`, `password`, `role`).
  * **Response (201):** `{ "access_token": "string", "token_type": "bearer", "user": UserSchema }`

* **POST `/auth/login`**
  * **Request Body:** User credentials (`username`, `password`).
  * **Response (200):** `{ "access_token": "string", "token_type": "bearer", "user": UserSchema }`

### Map & Entities (`/map`)
* **GET `/map/snapshot`**
  * **Headers:** `Authorization: Bearer <JWT>`
  * **Description:** Returns the initial state of the map (active squads, threats, and nodes based on the user's role).
  * **Response (200):**
    ```json
    {
      "squads": [
        {
          "id": "uuid-string",
          "name": "string",
          "role": "Squad",
          "lat": 0.0,
          "lng": 0.0
        }
      ],
      "threats": [
        {
          "id": "uuid-string",
          "type": "movable",
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

3. **`chat_message`**
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

## 3. Data Types & RBAC Roles

### Roles
* `MainCommandCenter`
* `AreaCommandCenter`
* `Squad`
* `SapperSquad`
* `Radar`

### Entity Hierarchy
* **MapEntity**: Base object bound to geographical coordinates (`lat`, `lng`).
* **NonMapEntity**: System or operational nodes (`CommandCenter`, `Radar`).