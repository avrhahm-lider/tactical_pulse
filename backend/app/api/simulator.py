from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.dependencies import require_main_command
from app.models.user import User
from app.simulator.engine import simulator_engine

router = APIRouter(prefix="/admin/simulator", tags=["Tactical Simulator"])


class SimulatorStartRequest(BaseModel):
    mode: Literal["all", "squads", "drones"] = "all"


class SimulatorStepRequest(BaseModel):
    target_type: Literal["squad", "drone"]
    target_id: UUID
    direction: Literal["up", "down", "left", "right", "alt_up", "alt_down"]
    delta: float | None = Field(0.0005, ge=0.00001, le=0.01)


@router.get("/status")
async def get_simulator_status(
    current_admin: User = Depends(require_main_command),
):
    """Returns current execution status of background simulation engine."""
    return simulator_engine.get_status()


@router.post("/start")
async def start_simulator(
    req: SimulatorStartRequest,
    current_admin: User = Depends(require_main_command),
):
    """Starts autonomous live simulation (all, squads, or drones)."""
    res = await simulator_engine.start(mode=req.mode)
    return res


@router.post("/stop")
async def stop_simulator(
    current_admin: User = Depends(require_main_command),
):
    """Stops all running simulation tasks."""
    res = await simulator_engine.stop()
    return res


@router.post("/step")
async def manual_step_simulator(
    req: SimulatorStepRequest,
    current_admin: User = Depends(require_main_command),
):
    """Manually nudges a single squad or drone by one step in the specified direction."""
    res = await simulator_engine.manual_step(
        target_type=req.target_type,
        target_id=req.target_id,
        direction=req.direction,
        delta=req.delta or 0.0005,
    )
    return res
