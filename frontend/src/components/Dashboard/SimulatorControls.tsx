import React, { useState, useEffect } from 'react'
import {
  Navigation,
  Play,
  Square,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Radio,
  ChevronDown,
  ChevronUp,
  Sliders,
  Plane,
  Users,
  Rocket,
} from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { useMapStore } from '../../store/useMapStore'
import { simulationEngine } from '../../services/simulationEngine'
import { isHQOrRadar } from '../../utils/squadUtils'

export const SimulatorControls: React.FC = () => {
  const { user } = useAuthStore()
  const { squads, threats } = useMapStore()

  // Re-render when simulationEngine state changes
  const [, setTick] = useState(0)
  useEffect(() => {
    return simulationEngine.subscribe(() => setTick((t) => t + 1))
  }, [])

  const [isCollapsed, setIsCollapsed] = useState(false)

  // Tabs for Admin/HQ: 'squads' | 'drones' | 'master'
  const [activeTab, setActiveTab] = useState<'squads' | 'drones' | 'master'>('master')

  // Selected entities for admin/radar
  const [selectedSquadId, setSelectedSquadId] = useState<string>('')
  const [selectedDroneId, setSelectedDroneId] = useState<string>('')

  // Active combat squads (excluding static HQ/Radar)
  const combatSquads = Object.values(squads).filter(
    (s) => s.status === 'active' && !isHQOrRadar(s)
  )

  // Active tracked drones
  const droneThreats = Object.values(threats).filter(
    (t) => t.threat_type === 'drone' && t.status === 'active'
  )

  // Auto-select first squad / drone when list loads
  useEffect(() => {
    if (!selectedSquadId && combatSquads.length > 0) {
      setSelectedSquadId(combatSquads[0].id)
    }
  }, [combatSquads, selectedSquadId])

  useEffect(() => {
    if (!selectedDroneId && droneThreats.length > 0) {
      setSelectedDroneId(droneThreats[0].id)
    }
  }, [droneThreats, selectedDroneId])

  if (!user) return null

  const role = user.role
  const isMasterLive = simulationEngine.isMasterLive()

  // -------------------------------------------------------------
  // 1. COMBAT SQUADS VIEW (Squad / SapperSquad)
  // -------------------------------------------------------------
  if (role === 'Squad' || role === 'SapperSquad') {
    const mySquad = squads[user.id]
    const isLive = simulationEngine.isSquadLive(user.id)

    return (
      <div className="absolute bottom-6 left-6 z-[1000] hud-panel w-72 rounded-xl border border-cyan-800 shadow-2xl hud-glow-cyan text-xs font-mono">
        <div className="p-3 flex items-center justify-between border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center space-x-2 text-cyan-400 font-bold">
            <Navigation className="w-4 h-4 animate-pulse" />
            <span>SQUAD TELEMETRY D-PAD</span>
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {!isCollapsed && (
          <div className="p-3 space-y-3">
            <div className="text-[11px] text-slate-300">
              <span className="text-slate-400">POSITION: </span>
              <span className="text-emerald-400 font-bold">
                {mySquad ? `${mySquad.lat.toFixed(4)}, ${mySquad.lon.toFixed(4)}` : 'ACQUIRING...'}
              </span>
              <span className="ml-2 text-slate-500">[{mySquad?.heading || 0}°]</span>
            </div>

            {/* Manual 4-way D-Pad */}
            <div className="grid grid-cols-3 gap-1 w-28 mx-auto">
              <div></div>
              <button
                onClick={() => simulationEngine.stepSquad(user.id, 'up')}
                title="Step North"
                className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer transition-colors"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <div></div>

              <button
                onClick={() => simulationEngine.stepSquad(user.id, 'left')}
                title="Step West"
                className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center justify-center text-[9px] text-cyan-400 font-bold">
                D-PAD
              </div>
              <button
                onClick={() => simulationEngine.stepSquad(user.id, 'right')}
                title="Step East"
                className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer transition-colors"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <div></div>
              <button
                onClick={() => simulationEngine.stepSquad(user.id, 'down')}
                title="Step South"
                className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer transition-colors"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <div></div>
            </div>

            {/* Auto-Patrol Live Toggle */}
            <button
              onClick={() => {
                if (isLive) {
                  simulationEngine.stopSquadLive(user.id)
                } else {
                  simulationEngine.startSquadLive(user.id)
                }
              }}
              className={`w-full py-2 px-3 rounded-lg font-semibold flex items-center justify-center space-x-2 cursor-pointer transition-all ${
                isLive
                  ? 'bg-red-950/90 hover:bg-red-900 border border-red-600 text-red-200 shadow-md shadow-red-950/50 animate-pulse'
                  : 'bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-600 text-emerald-300 shadow-md shadow-emerald-950/50'
              }`}
            >
              {isLive ? (
                <>
                  <Square className="w-3.5 h-3.5" />
                  <span>STOP AUTO-PATROL</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>START AUTO-PATROL (LIVE)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------
  // 2. RADAR STATIONS VIEW (Radar)
  // -------------------------------------------------------------
  if (role === 'Radar') {
    const curDrone = droneThreats.find((d) => d.id === selectedDroneId)
    const isCurDroneLive = selectedDroneId ? simulationEngine.isDroneLive(selectedDroneId) : false

    return (
      <div className="absolute bottom-6 left-6 z-[1000] hud-panel w-84 rounded-xl border border-sky-800 shadow-2xl hud-glow-cyan text-xs font-mono">
        <div className="p-3 flex items-center justify-between border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center space-x-2 text-sky-400 font-bold">
            <Radio className="w-4 h-4 animate-pulse" />
            <span>RADAR DRONE INTERCEPT SIMULATOR</span>
          </div>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {!isCollapsed && (
          <div className="p-3 space-y-3">
            {/* Drone Selector Dropdown */}
            <div>
              <label className="text-[10px] text-slate-400 uppercase block mb-1">
                Select Tracked Drone:
              </label>
              {droneThreats.length === 0 ? (
                <div className="text-slate-500 text-[11px] py-1">No active drones detected.</div>
              ) : (
                <select
                  value={selectedDroneId}
                  onChange={(e) => setSelectedDroneId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono text-xs focus:border-sky-500 focus:outline-none"
                >
                  {droneThreats.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.altitude || 300}m)
                    </option>
                  ))}
                </select>
              )}
            </div>

            {curDrone && (
              <>
                <div className="text-[11px] text-slate-300 flex justify-between bg-slate-900/60 p-2 rounded border border-slate-800">
                  <span>
                    POS: <b className="text-sky-300">{curDrone.lat.toFixed(4)}, {curDrone.lon.toFixed(4)}</b>
                  </span>
                  <span>
                    ALT: <b className="text-amber-300">{curDrone.altitude || 300}m</b>
                  </span>
                </div>

                {/* 4-way D-Pad + Altitude Controls */}
                <div className="flex items-center justify-around py-1">
                  {/* Direction D-Pad */}
                  <div className="grid grid-cols-3 gap-1 w-24">
                    <div></div>
                    <button
                      onClick={() => simulationEngine.stepDrone(selectedDroneId, 'north')}
                      title="North"
                      className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <div></div>

                    <button
                      onClick={() => simulationEngine.stepDrone(selectedDroneId, 'west')}
                      title="West"
                      className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <div className="flex items-center justify-center text-[8px] text-sky-400 font-bold">
                      UAV
                    </div>
                    <button
                      onClick={() => simulationEngine.stepDrone(selectedDroneId, 'east')}
                      title="East"
                      className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>

                    <div></div>
                    <button
                      onClick={() => simulationEngine.stepDrone(selectedDroneId, 'south')}
                      title="South"
                      className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <div></div>
                  </div>

                  {/* Altitude Up / Down */}
                  <div className="flex flex-col space-y-1.5">
                    <button
                      onClick={() => simulationEngine.stepDrone(selectedDroneId, 'north', 50)}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                    >
                      +Alt 50m
                    </button>
                    <button
                      onClick={() => simulationEngine.stepDrone(selectedDroneId, 'south', -50)}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                    >
                      -Alt 50m
                    </button>
                  </div>
                </div>

                {/* Live Flight Actions */}
                <div className="space-y-1.5 pt-1">
                  <button
                    onClick={() => {
                      if (isCurDroneLive) {
                        simulationEngine.stopDroneLive(selectedDroneId)
                      } else {
                        simulationEngine.startDroneLive(selectedDroneId)
                      }
                    }}
                    className={`w-full py-1.5 px-3 rounded font-semibold flex items-center justify-center space-x-2 cursor-pointer transition-colors ${
                      isCurDroneLive
                        ? 'bg-red-950 hover:bg-red-900 border border-red-700 text-red-200'
                        : 'bg-sky-950 hover:bg-sky-900 border border-sky-600 text-sky-200'
                    }`}
                  >
                    {isCurDroneLive ? (
                      <>
                        <Square className="w-3.5 h-3.5" />
                        <span>STOP DRONE FLIGHT</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>START LIVE FLIGHT</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => simulationEngine.startAllDronesLive(droneThreats)}
                    className="w-full py-1.5 px-3 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-600 text-amber-300 font-semibold flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    <span>LAUNCH ALL DRONES LIVE</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------
  // 3. MAIN COMMAND CENTER (Admin) & AREA COMMAND CENTER
  // -------------------------------------------------------------
  const curSquad = combatSquads.find((s) => s.id === selectedSquadId)
  const isCurSquadLive = selectedSquadId ? simulationEngine.isSquadLive(selectedSquadId) : false

  const curDrone = droneThreats.find((d) => d.id === selectedDroneId)
  const isCurDroneLive = selectedDroneId ? simulationEngine.isDroneLive(selectedDroneId) : false

  return (
    <div className="absolute bottom-6 left-6 z-[1000] hud-panel w-96 rounded-xl border border-cyan-800 shadow-2xl hud-glow-cyan text-xs font-mono">
      {/* Header with Master Simulation Toggle */}
      <div className="p-3 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-cyan-400 font-bold">
          <Sliders className="w-4 h-4" />
          <span>TACTICAL SIMULATION DASHBOARD</span>
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!isCollapsed && (
        <div className="p-3 space-y-3">
          {/* Prominent Master Toggle Button */}
          <button
            onClick={() => {
              if (isMasterLive) {
                simulationEngine.stopMasterSimulation()
              } else {
                simulationEngine.startMasterSimulation(squads, droneThreats)
              }
            }}
            className={`w-full py-2.5 px-3 rounded-lg font-bold flex items-center justify-center space-x-2 cursor-pointer transition-all shadow-lg ${
              isMasterLive
                ? 'bg-red-950 hover:bg-red-900 border border-red-500 text-red-200 shadow-red-950/50 animate-pulse'
                : 'bg-gradient-to-r from-cyan-950 via-blue-950 to-emerald-950 hover:from-cyan-900 hover:to-emerald-900 border border-cyan-500 text-cyan-200 shadow-cyan-950/50'
            }`}
          >
            {isMasterLive ? (
              <>
                <Square className="w-4 h-4" />
                <span>⏹ STOP MASTER SIMULATION</span>
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4 text-cyan-400" />
                <span>🚀 START MASTER SIMULATION (ALL UNITS)</span>
              </>
            )}
          </button>

          {/* Switcher Tabs: Squads | Drones | Master Mode */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800 text-[11px]">
            <button
              onClick={() => setActiveTab('squads')}
              className={`py-1 rounded flex items-center justify-center space-x-1 cursor-pointer transition-colors ${
                activeTab === 'squads'
                  ? 'bg-cyan-900/80 text-cyan-200 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3 h-3" />
              <span>Squads</span>
            </button>
            <button
              onClick={() => setActiveTab('drones')}
              className={`py-1 rounded flex items-center justify-center space-x-1 cursor-pointer transition-colors ${
                activeTab === 'drones'
                  ? 'bg-cyan-900/80 text-cyan-200 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Plane className="w-3 h-3" />
              <span>Drones</span>
            </button>
            <button
              onClick={() => setActiveTab('master')}
              className={`py-1 rounded flex items-center justify-center space-x-1 cursor-pointer transition-colors ${
                activeTab === 'master'
                  ? 'bg-cyan-900/80 text-cyan-200 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>Status</span>
            </button>
          </div>

          {/* TAB 1: SQUADS */}
          {activeTab === 'squads' && (
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">SELECT SQUAD:</label>
                <select
                  value={selectedSquadId}
                  onChange={(e) => setSelectedSquadId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                >
                  {combatSquads.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} [{s.role}]
                    </option>
                  ))}
                </select>
              </div>

              {curSquad && (
                <>
                  <div className="text-[11px] text-slate-300 flex justify-between bg-slate-900/60 p-2 rounded border border-slate-800">
                    <span>
                      POS: <b className="text-emerald-300">{curSquad.lat.toFixed(4)}, {curSquad.lon.toFixed(4)}</b>
                    </span>
                    <span>HDG: [{curSquad.heading || 0}°]</span>
                  </div>

                  {/* Manual D-Pad */}
                  <div className="grid grid-cols-3 gap-1 w-24 mx-auto">
                    <div></div>
                    <button
                      onClick={() => simulationEngine.stepSquad(selectedSquadId, 'up')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <div></div>

                    <button
                      onClick={() => simulationEngine.stepSquad(selectedSquadId, 'left')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <div className="flex items-center justify-center text-[8px] text-cyan-400 font-bold">
                      STEP
                    </div>
                    <button
                      onClick={() => simulationEngine.stepSquad(selectedSquadId, 'right')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>

                    <div></div>
                    <button
                      onClick={() => simulationEngine.stepSquad(selectedSquadId, 'down')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <div></div>
                  </div>

                  <button
                    onClick={() => {
                      if (isCurSquadLive) {
                        simulationEngine.stopSquadLive(selectedSquadId)
                      } else {
                        simulationEngine.startSquadLive(selectedSquadId)
                      }
                    }}
                    className={`w-full py-1.5 px-3 rounded font-semibold flex items-center justify-center space-x-2 cursor-pointer transition-colors ${
                      isCurSquadLive
                        ? 'bg-red-950 hover:bg-red-900 border border-red-700 text-red-200'
                        : 'bg-cyan-950 hover:bg-cyan-900 border border-cyan-600 text-cyan-200'
                    }`}
                  >
                    {isCurSquadLive ? (
                      <>
                        <Square className="w-3.5 h-3.5" />
                        <span>STOP LIVE PATROL</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>START LIVE PATROL</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {/* TAB 2: DRONES */}
          {activeTab === 'drones' && (
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">SELECT DRONE:</label>
                {droneThreats.length === 0 ? (
                  <div className="text-slate-500 text-[11px] py-1">No tracked drones.</div>
                ) : (
                  <select
                    value={selectedDroneId}
                    onChange={(e) => setSelectedDroneId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  >
                    {droneThreats.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.altitude || 300}m)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {curDrone && (
                <>
                  <div className="text-[11px] text-slate-300 flex justify-between bg-slate-900/60 p-2 rounded border border-slate-800">
                    <span>
                      POS: <b className="text-sky-300">{curDrone.lat.toFixed(4)}, {curDrone.lon.toFixed(4)}</b>
                    </span>
                    <span>
                      ALT: <b className="text-amber-300">{curDrone.altitude || 300}m</b>
                    </span>
                  </div>

                  <div className="flex items-center justify-around py-1">
                    <div className="grid grid-cols-3 gap-1 w-24">
                      <div></div>
                      <button
                        onClick={() => simulationEngine.stepDrone(selectedDroneId, 'north')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <div></div>

                      <button
                        onClick={() => simulationEngine.stepDrone(selectedDroneId, 'west')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <div className="flex items-center justify-center text-[8px] text-sky-400 font-bold">
                        UAV
                      </div>
                      <button
                        onClick={() => simulationEngine.stepDrone(selectedDroneId, 'east')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>

                      <div></div>
                      <button
                        onClick={() => simulationEngine.stepDrone(selectedDroneId, 'south')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <div></div>
                    </div>

                    <div className="flex flex-col space-y-1.5">
                      <button
                        onClick={() => simulationEngine.stepDrone(selectedDroneId, 'north', 50)}
                        className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                      >
                        +Alt 50m
                      </button>
                      <button
                        onClick={() => simulationEngine.stepDrone(selectedDroneId, 'south', -50)}
                        className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                      >
                        -Alt 50m
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => {
                        if (isCurDroneLive) {
                          simulationEngine.stopDroneLive(selectedDroneId)
                        } else {
                          simulationEngine.startDroneLive(selectedDroneId)
                        }
                      }}
                      className={`py-1.5 px-2 rounded font-semibold text-[11px] flex items-center justify-center space-x-1 cursor-pointer transition-colors ${
                        isCurDroneLive
                          ? 'bg-red-950 hover:bg-red-900 border border-red-700 text-red-200'
                          : 'bg-sky-950 hover:bg-sky-900 border border-sky-600 text-sky-200'
                      }`}
                    >
                      <span>{isCurDroneLive ? 'STOP DRONE' : 'FLY DRONE'}</span>
                    </button>

                    <button
                      onClick={() => simulationEngine.startAllDronesLive(droneThreats)}
                      className="py-1.5 px-2 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-600 text-amber-300 font-semibold text-[11px] flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <span>ALL DRONES</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 3: MASTER / STATUS */}
          {activeTab === 'master' && (
            <div className="space-y-2 text-[11px]">
              <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>ACTIVE COMBAT FORCES:</span>
                  <span className="text-emerald-400 font-bold">{combatSquads.length} UNITS</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>TRACKED HOSTILE DRONES:</span>
                  <span className="text-sky-400 font-bold">{droneThreats.length} UAVs</span>
                </div>
                <div className="flex justify-between text-slate-300 pt-1 border-t border-slate-800">
                  <span>SIMULATION STATE:</span>
                  <span
                    className={`font-bold ${
                      isMasterLive ? 'text-emerald-400 animate-pulse' : 'text-slate-500'
                    }`}
                  >
                    {isMasterLive ? 'LIVE AUTONOMOUS (ACTIVE)' : 'STANDBY'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
