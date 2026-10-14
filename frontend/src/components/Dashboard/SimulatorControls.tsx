import React, { useState, useEffect, useRef } from 'react'
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
  Layers,
  Check,
  Globe,
  Moon,
  Map as MapIcon,
  Plane,
  Users,
  Rocket,
  RotateCcw,
  X,
} from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { useMapStore } from '../../store/useMapStore'
import { simulatorApi } from '../../services/api'
import { simulationEngine } from '../../services/simulationEngine'
import { isHQOrRadar } from '../../utils/squadUtils'

export const SimulatorControls: React.FC = () => {
  const { user } = useAuthStore()
  const { squads, threats, activeTileLayer, setActiveTileLayer } = useMapStore()

  // Track backend simulator status via polling/mounting
  const [isSimulatorRunning, setIsSimulatorRunning] = useState(false)
  const [simMode, setSimMode] = useState<string>('stopped')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let isMounted = true
    const fetchStatus = async () => {
      try {
        const status = await simulatorApi.getStatus()
        if (isMounted) {
          setIsSimulatorRunning(status.is_running)
          setSimMode(status.mode)
        }
      } catch {
        // Non-admin roles (e.g. Squad) may get 403; ignore gracefully
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])

  // Re-render when manual simulationEngine D-Pad step changes
  const [, setTick] = useState(0)
  useEffect(() => {
    return simulationEngine.subscribe(() => setTick((t) => t + 1))
  }, [])

  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

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

  const activeSquadId =
    selectedSquadId && combatSquads.some((s) => s.id === selectedSquadId)
      ? selectedSquadId
      : combatSquads[0]?.id || ''

  const activeDroneId =
    selectedDroneId && droneThreats.some((d) => d.id === selectedDroneId)
      ? selectedDroneId
      : droneThreats[0]?.id || ''

  // Rewire "MASTER SIMULATION" Button to backend REST API
  const handleToggleMaster = async () => {
    setLoading(true)
    try {
      if (isSimulatorRunning) {
        await simulatorApi.stop()
        setIsSimulatorRunning(false)
        setSimMode('stopped')
      } else {
        await simulatorApi.start('all')
        setIsSimulatorRunning(true)
        setSimMode('all')
      }
    } catch (err) {
      console.error('Failed to toggle master simulation:', err)
    } finally {
      setLoading(false)
    }
  }

  // Rewire "AUTO-PATROL (LIVE)" for Squads to backend REST API
  const handleToggleSquadPatrol = async () => {
    setLoading(true)
    try {
      if (isSimulatorRunning && simMode === 'squads') {
        await simulatorApi.stop()
        setIsSimulatorRunning(false)
        setSimMode('stopped')
      } else {
        await simulatorApi.start('squads')
        setIsSimulatorRunning(true)
        setSimMode('squads')
      }
    } catch (err) {
      console.error('Failed to toggle squad patrol:', err)
    } finally {
      setLoading(false)
    }
  }

  // Rewire "START DRONE LIVE" / Radar Simulation to backend REST API
  const handleToggleDroneFlight = async () => {
    setLoading(true)
    try {
      if (isSimulatorRunning && simMode === 'drones') {
        await simulatorApi.stop()
        setIsSimulatorRunning(false)
        setSimMode('stopped')
      } else {
        await simulatorApi.start('drones')
        setIsSimulatorRunning(true)
        setSimMode('drones')
      }
    } catch (err) {
      console.error('Failed to toggle drone flight:', err)
    } finally {
      setLoading(false)
    }
  }

  // Reset simulation and clear simulated entities from the tactical map
  const handleResetSimulation = async () => {
    if (!window.confirm('Reset simulation and clear all simulated forces & threats from the tactical map?')) {
      return
    }
    setLoading(true)
    try {
      await simulatorApi.reset()
      setIsSimulatorRunning(false)
      setSimMode('stopped')
      await useMapStore.getState().loadSnapshot()
    } catch (err) {
      console.error('Failed to reset simulation:', err)
    } finally {
      setLoading(false)
    }
  }

  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(false)
  const layerMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isLayerMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (layerMenuRef.current && !layerMenuRef.current.contains(e.target as Node)) {
        setIsLayerMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isLayerMenuOpen])

  if (!user) return null

  const mapLayerOptions: Array<{ id: 'dark' | 'satellite' | 'osm'; label: string; desc: string; icon: React.ReactNode }> = [
    { id: 'dark', label: 'Tactical Dark', desc: 'Esri Dark Canvas', icon: <Moon className="w-3.5 h-3.5 text-cyan-400" /> },
    { id: 'satellite', label: 'Satellite View', desc: 'High-res Imagery', icon: <Globe className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'osm', label: 'OpenStreetMap', desc: 'Standard Vector Map', icon: <MapIcon className="w-3.5 h-3.5 text-amber-400" /> },
  ]

  // Unified Bottom-Left Map Controls Dock: Map View Switcher + Simulator Toggle Button
  const renderDock = () => (
    <div className="absolute bottom-4 left-4 z-[1000] flex items-center gap-2">
      {/* 1. Map Layer View Style Selector */}
      <div className="relative" ref={layerMenuRef}>
        <button
          onClick={() => {
            setIsLayerMenuOpen((prev) => {
              const next = !prev
              if (next) setIsOpen(false)
              return next
            })
          }}
          title="Change Map View Style"
          aria-label="Change Map View Style"
          className={`w-9 h-9 rounded-lg border flex items-center justify-center shadow-xl transition-all cursor-pointer backdrop-blur-md ${
            isLayerMenuOpen
              ? 'bg-cyan-950/95 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400/50'
              : 'bg-slate-900/90 hover:bg-slate-800 border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-500'
          }`}
        >
          <Layers className={`w-4 h-4 ${isLayerMenuOpen ? 'text-cyan-400' : 'text-slate-300'}`} />
        </button>

        {/* Popover Menu: Opens directly upwards */}
        {isLayerMenuOpen && (
          <div className="absolute bottom-full mb-2 left-0 w-52 rounded-xl bg-slate-950/95 border border-slate-800/90 shadow-2xl backdrop-blur-md p-1.5 z-50 font-mono text-xs">
            <div className="px-2 py-1 text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-800/80 mb-1 flex items-center justify-between">
              <span>Map View Style</span>
              <span className="text-[9px] text-cyan-400 font-normal">Layer</span>
            </div>
            <div className="space-y-1">
              {mapLayerOptions.map((opt) => {
                const isActive = activeTileLayer === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setActiveTileLayer(opt.id)
                      setIsLayerMenuOpen(false)
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-all cursor-pointer ${
                      isActive
                        ? 'bg-cyan-950/80 border border-cyan-500/50 text-cyan-200'
                        : 'hover:bg-slate-900/80 text-slate-300 hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {opt.icon}
                      <div>
                        <div className="font-semibold text-[11px] leading-tight">{opt.label}</div>
                        <div className="text-[9px] text-slate-500 leading-tight">{opt.desc}</div>
                      </div>
                    </div>
                    {isActive && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2. Tactical Simulator Button */}
      <div className="relative">
        <button
          onClick={() => {
            setIsOpen((prev) => {
              const next = !prev
              if (next) setIsLayerMenuOpen(false)
              return next
            })
          }}
          title={isOpen ? 'Close Tactical Simulator Panel' : 'Open Tactical Simulator Panel'}
          aria-label="Tactical Simulator"
          className={`relative w-9 h-9 rounded-lg border flex items-center justify-center shadow-xl transition-all cursor-pointer backdrop-blur-md ${
            isOpen
              ? 'bg-cyan-950/95 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400/50'
              : 'bg-slate-900/90 hover:bg-slate-800 border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-500'
          }`}
        >
          <Sliders className={`w-4 h-4 ${isOpen ? 'text-cyan-400' : isSimulatorRunning ? 'text-emerald-400' : 'text-slate-300'}`} />
          {isSimulatorRunning && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-slate-900"></span>
            </span>
          )}
        </button>
      </div>
    </div>
  )

  const role = user.role

  // If panel is closed, render the unified dock
  if (!isOpen) {
    return renderDock()
  }

  // -------------------------------------------------------------
  // 1. COMBAT SQUADS VIEW (Squad / SapperSquad)
  // -------------------------------------------------------------
  if (role === 'Squad' || role === 'SapperSquad') {
    const mySquad = squads[user.id]
    const isLive = isSimulatorRunning && (simMode === 'squads' || simMode === 'all')

    return (
      <>
        {renderDock()}
        <div className="absolute bottom-[60px] left-4 z-[1000] hud-panel w-72 rounded-xl border border-cyan-800 shadow-2xl hud-glow-cyan text-xs font-mono max-h-[calc(100vh-100px)] overflow-y-auto">
          <div className="p-3 flex items-center justify-between border-b border-slate-800 bg-slate-950/80">
            <div className="flex items-center space-x-2 text-cyan-400 font-bold">
              <Navigation className="w-4 h-4 animate-pulse" />
              <span>SQUAD TELEMETRY D-PAD</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-slate-400 hover:text-white cursor-pointer"
                title={isCollapsed ? 'Expand' : 'Collapse'}
              >
                {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer p-0.5"
                title="Close simulator panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
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

            {/* Auto-Patrol Live Toggle via Backend REST API */}
            <button
              onClick={handleToggleSquadPatrol}
              disabled={loading}
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
      </>
    )
  }

  // -------------------------------------------------------------
  // 2. RADAR STATIONS VIEW (Radar)
  // -------------------------------------------------------------
  if (role === 'Radar') {
    const curDrone = droneThreats.find((d) => d.id === activeDroneId)
    const isDroneLive = isSimulatorRunning && (simMode === 'drones' || simMode === 'all')

    return (
      <>
        {renderDock()}
        <div className="absolute bottom-[60px] left-4 z-[1000] hud-panel w-84 rounded-xl border border-sky-800 shadow-2xl hud-glow-cyan text-xs font-mono max-h-[calc(100vh-100px)] overflow-y-auto">
          <div className="p-3 flex items-center justify-between border-b border-slate-800 bg-slate-950/80">
            <div className="flex items-center space-x-2 text-sky-400 font-bold">
              <Radio className="w-4 h-4 animate-pulse" />
              <span>RADAR DRONE INTERCEPT SIMULATOR</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-slate-400 hover:text-white cursor-pointer"
                title={isCollapsed ? 'Expand' : 'Collapse'}
              >
                {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer p-0.5"
                title="Close simulator panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
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
                  value={activeDroneId}
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
                      onClick={() => simulationEngine.stepDrone(activeDroneId, 'north')}
                      title="North"
                      className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <div></div>

                    <button
                      onClick={() => simulationEngine.stepDrone(activeDroneId, 'west')}
                      title="West"
                      className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <div className="flex items-center justify-center text-[8px] text-sky-400 font-bold">
                      UAV
                    </div>
                    <button
                      onClick={() => simulationEngine.stepDrone(activeDroneId, 'east')}
                      title="East"
                      className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>

                    <div></div>
                    <button
                      onClick={() => simulationEngine.stepDrone(activeDroneId, 'south')}
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
                      onClick={() => simulationEngine.stepDrone(activeDroneId, 'north', 50)}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                    >
                      +Alt 50m
                    </button>
                    <button
                      onClick={() => simulationEngine.stepDrone(activeDroneId, 'south', -50)}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                    >
                      -Alt 50m
                    </button>
                  </div>
                </div>

                {/* Live Flight Actions via Backend REST API */}
                <div className="space-y-1.5 pt-1">
                  <button
                    onClick={handleToggleDroneFlight}
                    disabled={loading}
                    className={`w-full py-1.5 px-3 rounded font-semibold flex items-center justify-center space-x-2 cursor-pointer transition-colors ${
                      isDroneLive
                        ? 'bg-red-950 hover:bg-red-900 border border-red-700 text-red-200'
                        : 'bg-sky-950 hover:bg-sky-900 border border-sky-600 text-sky-200'
                    }`}
                  >
                    {isDroneLive ? (
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
                    onClick={handleToggleDroneFlight}
                    disabled={loading}
                    className="w-full py-1.5 px-3 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-600 text-amber-300 font-semibold flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    <span>{isDroneLive ? 'STOP DRONE SIMULATION' : 'LAUNCH DRONES (BACKEND)'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      </>
    )
  }

  // -------------------------------------------------------------
  // 3. MAIN COMMAND CENTER (Admin) & AREA COMMAND CENTER
  // -------------------------------------------------------------
  const curSquad = combatSquads.find((s) => s.id === activeSquadId)
  const isSquadLive = isSimulatorRunning && (simMode === 'squads' || simMode === 'all')

  const curDrone = droneThreats.find((d) => d.id === activeDroneId)
  const isDroneLive = isSimulatorRunning && (simMode === 'drones' || simMode === 'all')

  return (
    <>
      {renderDock()}
      <div className="absolute bottom-[60px] left-4 z-[1000] hud-panel w-96 rounded-xl border border-cyan-800 shadow-2xl hud-glow-cyan text-xs font-mono max-h-[calc(100vh-100px)] overflow-y-auto">
        {/* Header with Master Simulation Toggle */}
        <div className="p-3 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-cyan-400 font-bold">
            <Sliders className="w-4 h-4" />
            <span>TACTICAL SIMULATION DASHBOARD</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-slate-400 hover:text-white cursor-pointer"
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white cursor-pointer p-0.5"
              title="Close simulator panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

      {!isCollapsed && (
        <div className="p-3 space-y-3">
          {/* Prominent Master Toggle Button via Backend REST API */}
          <button
            onClick={handleToggleMaster}
            disabled={loading}
            className={`w-full py-2.5 px-3 rounded-lg font-bold flex items-center justify-center space-x-2 cursor-pointer transition-all shadow-lg ${
              isSimulatorRunning
                ? 'bg-red-950 hover:bg-red-900 border border-red-500 text-red-200 shadow-red-950/50 animate-pulse'
                : 'bg-gradient-to-r from-cyan-950 via-blue-950 to-emerald-950 hover:from-cyan-900 hover:to-emerald-900 border border-cyan-500 text-cyan-200 shadow-cyan-950/50'
            }`}
          >
            {isSimulatorRunning ? (
              <>
                <Square className="w-4 h-4" />
                <span>⏹ STOP MASTER SIMULATION ({simMode.toUpperCase()})</span>
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4 text-cyan-400" />
                <span>🚀 START MASTER SIMULATION (ALL UNITS)</span>
              </>
            )}
          </button>

          {/* Reset / Clear Map Button */}
          <button
            onClick={handleResetSimulation}
            disabled={loading}
            className="w-full py-1.5 px-3 rounded-lg font-medium text-xs flex items-center justify-center space-x-2 cursor-pointer transition-all bg-slate-900/80 hover:bg-red-950/50 border border-slate-700/80 hover:border-red-600/80 text-slate-300 hover:text-red-200"
            title="Purge simulated squads and threats to show a clean map"
          >
            <RotateCcw className="w-3.5 h-3.5 text-red-400" />
            <span>RESET SIMULATION (CLEAR MAP)</span>
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
                  value={activeSquadId}
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
                      onClick={() => simulationEngine.stepSquad(activeSquadId, 'up')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <div></div>

                    <button
                      onClick={() => simulationEngine.stepSquad(activeSquadId, 'left')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <div className="flex items-center justify-center text-[8px] text-cyan-400 font-bold">
                      STEP
                    </div>
                    <button
                      onClick={() => simulationEngine.stepSquad(activeSquadId, 'right')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>

                    <div></div>
                    <button
                      onClick={() => simulationEngine.stepSquad(activeSquadId, 'down')}
                      className="p-1.5 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <div></div>
                  </div>

                  {/* Auto-Patrol via Backend REST API */}
                  <button
                    onClick={handleToggleSquadPatrol}
                    disabled={loading}
                    className={`w-full py-1.5 px-3 rounded font-semibold flex items-center justify-center space-x-2 cursor-pointer transition-colors ${
                      isSquadLive
                        ? 'bg-red-950 hover:bg-red-900 border border-red-700 text-red-200'
                        : 'bg-cyan-950 hover:bg-cyan-900 border border-cyan-600 text-cyan-200'
                    }`}
                  >
                    {isSquadLive ? (
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
                    value={activeDroneId}
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
                        onClick={() => simulationEngine.stepDrone(activeDroneId, 'north')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <div></div>

                      <button
                        onClick={() => simulationEngine.stepDrone(activeDroneId, 'west')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <div className="flex items-center justify-center text-[8px] text-sky-400 font-bold">
                        UAV
                      </div>
                      <button
                        onClick={() => simulationEngine.stepDrone(activeDroneId, 'east')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>

                      <div></div>
                      <button
                        onClick={() => simulationEngine.stepDrone(activeDroneId, 'south')}
                        className="p-1.5 rounded bg-slate-800 hover:bg-sky-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <div></div>
                    </div>

                    <div className="flex flex-col space-y-1.5">
                      <button
                        onClick={() => simulationEngine.stepDrone(activeDroneId, 'north', 50)}
                        className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                      >
                        +Alt 50m
                      </button>
                      <button
                        onClick={() => simulationEngine.stepDrone(activeDroneId, 'south', -50)}
                        className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-amber-900 border border-slate-700 text-amber-300 font-bold text-[10px] cursor-pointer"
                      >
                        -Alt 50m
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={handleToggleDroneFlight}
                      disabled={loading}
                      className={`py-1.5 px-2 rounded font-semibold text-[11px] flex items-center justify-center space-x-1 cursor-pointer transition-colors ${
                        isDroneLive
                          ? 'bg-red-950 hover:bg-red-900 border border-red-700 text-red-200'
                          : 'bg-sky-950 hover:bg-sky-900 border border-sky-600 text-sky-200'
                      }`}
                    >
                      <span>{isDroneLive ? 'STOP DRONES' : 'FLY DRONES'}</span>
                    </button>

                    <button
                      onClick={handleToggleMaster}
                      disabled={loading}
                      className="py-1.5 px-2 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-600 text-amber-300 font-semibold text-[11px] flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <span>{isSimulatorRunning ? 'STOP ALL' : 'ALL UNITS'}</span>
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
                      isSimulatorRunning ? 'text-emerald-400 animate-pulse' : 'text-slate-500'
                    }`}
                  >
                    {isSimulatorRunning ? `LIVE AUTONOMOUS (${simMode.toUpperCase()})` : 'STANDBY'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  )
}
