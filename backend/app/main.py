from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, simulator, threats
from app.api import map as tactical_map
from app.core.config import settings
from app.core.errors import (
    AppException,
    app_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.db.postgres import init_db
from app.sockets.server import sio


import asyncio

from app.simulator.engine import simulator_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Pre-warm simulation engine in background for instant start responses
    asyncio.create_task(simulator_engine.warmup())
    yield


# Initialize FastAPI application
fastapi_app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Exception handlers matching API_CONTRACT.md Section 5 unified format
fastapi_app.add_exception_handler(AppException, app_exception_handler)
fastapi_app.add_exception_handler(HTTPException, http_exception_handler)
fastapi_app.add_exception_handler(RequestValidationError, validation_exception_handler)

# CORS Configuration
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include REST Routers under /api/v1
fastapi_app.include_router(auth.router, prefix=settings.API_V1_STR)
fastapi_app.include_router(admin.router, prefix=settings.API_V1_STR)
fastapi_app.include_router(threats.router, prefix=settings.API_V1_STR)
fastapi_app.include_router(tactical_map.router, prefix=settings.API_V1_STR)
fastapi_app.include_router(simulator.router, prefix=settings.API_V1_STR)


@fastapi_app.get("/health")
async def health_check():
    return {"status": "ok", "app": settings.PROJECT_NAME}


# Wrap FastAPI with python-socketio ASGI mount on /socket.io
app = socketio.ASGIApp(
    sio,
    other_asgi_app=fastapi_app,
    socketio_path="/socket.io",
)
