# Basic app

## Plan

### Entities
- Entity 
-- MapEntity(Entity)
--- Squad(MapEntity)
---- SapperSquad(Squad)
--- Threat(MapEntity)
---- Movable(Threat)
---- Immovable(Threat)
-- NonMapEntity(Entity)
--- CommandCenter(NonMapEntity)
--- Radar(NonMapEntity)



### Project flow
- Squad is a user - every squad can see other squads and threats (depending on its role)
- Command Center can see all information of the area (or all information)
- Squad send location on every change (change more than 5 meters)
- Server listen the sockets and update the db if received change of location
- Server sends updated location to every squad and command centers with access
- Squad can add entity threats
    - immovable - only SapperSquad can update
    - movable - only radar can update 

### Roles
- MainCommandCenter
- AreaCommandCenter
- Squad
- SapperSquad
- Radar
 

## Features
- Movable terrorist that can be updated by regular force

- Navigation
-- Navigate SapperSquad to threat
-- Navigate Squad to his destination avoiding threats

-- CommandCenter can send message to squads

-- Chat of Command Centers

## Simulator
App for test the main app
Simulate forces and radar that sends locations and updates to main app 


## Tech-Stack
- Frontend: React, Leaflet (using canva), Zustand, Socket.IO-client.

- Backend: Python, FastAPI, python-socketio, Pydantic, JWT (PyJWT), bcrypt (passlib), networkx (for fast in-memory dynamic routing).

- Databases: PostgreSQL + PostGIS (core & spatial DB), Redis (live coords & sockets).

- Routing: pgRouting (SQL/roads) + networkx (Server-side dynamic graph adjustments).

- Deployment: Vercel (Frontend), Render (FastAPI + Redis), Supabase (PostgreSQL + PostGIS) - (Ensure Render and Supabase are deployed in the exact same region/data center to minimize latency).


## Structure

```text
frontend/
├── public/                 # Static assets and map icons (threats, squads)
├── src/
│   ├── assets/             # Global styles (e.g., index.css, tailwind.css)
│   ├── components/         # React UI components
│   │   ├── Map/            # Leaflet layers (Map.tsx, MarkerLayer.tsx, RouteLayer.tsx)
│   │   ├── Dashboard/      # UI Panels, Sidebar, and active unit lists
│   │   ├── Auth/           # Login and Registration forms
│   │   ├── Chat/           # Chat UI for Command Centers (MessageList, ChatInput)
│   │   └── shared/         # Reusable UI elements (Buttons, Modals, Inputs)
│   ├── hooks/              # Custom React hooks (e.g., useChat, useGeoLocation)
│   ├── routes/             # Routing logic (ProtectedRoute.tsx, AppRoutes.tsx)
│   ├── store/              # Zustand state managers
│   │   ├── useMapStore.ts  # Live coordinates and threat cache
│   │   └── useAuthStore.ts # JWT token, user profile, and RBAC role
│   ├── services/           # External communication
│   │   ├── socket.ts       # Socket.IO-client connection and event listeners
│   │   └── api.ts          # Axios wrapper for REST (with auth interceptors)
│   ├── types/              # TypeScript interfaces (Entity, Threat, Squad, Message)
│   ├── utils/              # Pure functions (date formatting, local coordinate math)
│   ├── App.tsx             # Root component and providers
│   └── main.tsx            # App entry point
├── .env                    # VITE_API_URL, VITE_SOCKET_URL
├── package.json
└── tailwind.config.js      # Utility-first styling configuration


backend/
├── alembic/                # Database migrations directory
├── alembic.ini             # Alembic configuration file
├── app/
│   ├── api/                # REST HTTP routers
│   │   ├── dependencies.py # RBAC logic (RoleChecker) and JWT extraction
│   │   ├── auth.py         # POST /login, POST /register
│   │   └── map.py          # GET /snapshot (Initial map state)
│   ├── core/               # App configuration
│   │   ├── config.py       # Environment variables parsing
│   │   └── security.py     # bcrypt hashing and JWT encoding logic
│   ├── db/                 # Database clients
│   │   ├── postgres.py     # asyncpg / SQLAlchemy setup
│   │   └── redis.py        # Redis connection setup
│   ├── models/             # ORM Models (PostgreSQL tables)
│   │   ├── user.py         # Users and roles tables
│   │   ├── threat.py       # Threats (with PostGIS Geometry column)
│   │   └── message.py      # Chat history table
│   ├── schemas/            # Pydantic schemas (Data Validation)
│   │   ├── entity.py       # BaseEntity, Squad, Threat payloads
│   │   └── chat.py         # Chat message validation
│   ├── services/           # Core business and spatial logic
│   │   ├── routing.py      # Navigation algorithms (A* or pgRouting queries)
│   │   └── geo.py          # PostGIS ST_Intersects and ST_Buffer logic
│   ├── sockets/            # WebSocket handlers
│   │   ├── connection.py   # JWT handshake, user connection, room assignment
│   │   ├── events.py       # Live location updates, threat additions
│   │   └── chat.py         # Broadcasting messages between Command Centers
│   └── main.py             # FastAPI application and Socket.IO bootstrap
├── simulator/              # Load testing & mock data generator
│   └── run.py              # Script to emulate squad movements
├── tests/                  # Unit and integration tests
│   ├── test_api.py         # Testing REST endpoints and RBAC
│   └── test_sockets.py     # Testing WebSocket broadcasts
├── docker-compose.yml      # Local dev environment (Redis, Postgres+PostGIS)
├── .env                    # DATABASE_URL, REDIS_URL, SECRET_KEY
├── Dockerfile              # Deployment config for Render
└── requirements.txt        # fastapi, python-socketio, alembic, asyncpg, etc.


## Comments
Socket.io - token must be sended in body
Routing - calculations must be server-side

