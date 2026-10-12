from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
import socketio

from app.core.config import settings
from app.core.errors import (
    AppException,
    app_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.db.postgres import init_db
from app.api import auth, admin, threats, map as tactical_map, simulator
from app.sockets.server import sio


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
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
