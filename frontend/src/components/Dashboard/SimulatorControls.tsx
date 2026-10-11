import React, { useState } from 'react'
import { Navigation, Play, Square, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { useMapStore } from '../../store/useMapStore'
import { emitLocationUpdate } from '../../services/socket'

export const SimulatorControls: React.FC = () => {
  const { user } = useAuthStore()
  const { squads, updateSquadPosition } = useMapStore()
  const [isPatrolling, setIsPatrolling] = useState(false)
  const [patrolInterval, setPatrolInterval] = useState<ReturnType<typeof setInterval> | null>(null)

  // Only field squads / radars have live positions that move
  if (!user || (user.role !== 'Squad' && user.role !== 'SapperSquad' && user.role !== 'Radar')) {
    return null
  }

  const mySquad = squads[user.id]

  const moveSquad = (deltaLat: number, deltaLon: number, heading: number) => {
    const currentLat = mySquad ? mySquad.lat : 32.0853
    const currentLon = mySquad ? mySquad.lon : 34.7818

    const newLat = currentLat + deltaLat
    const newLon = currentLon + deltaLon

    // Emit live WebSocket update
    emitLocationUpdate(newLat, newLon, heading)

    // Local optimistic update
    updateSquadPosition({
      id: user.id,
      lat: newLat,
      lon: newLon,
      heading,
      updated_at: new Date().toISOString(),
    })
  }

  const toggleAutoPatrol = () => {
    if (isPatrolling) {
      if (patrolInterval) clearInterval(patrolInterval)
      setPatrolInterval(null)
      setIsPatrolling(false)
    } else {
      let step = 0
      const timer = setInterval(() => {
        step = (step + 1) % 4
        // Circular patrol
        switch (step) {
          case 0:
            moveSquad(0.0003, 0, 0)
            break
          case 1:
            moveSquad(0, 0.0003, 90)
            break
          case 2:
            moveSquad(-0.0003, 0, 180)
            break
          case 3:
            moveSquad(0, -0.0003, 270)
            break
        }
      }, 3000)
      setPatrolInterval(timer)
      setIsPatrolling(true)
    }
  }

  return (
    <div className="absolute bottom-6 left-6 z-[1000] hud-panel p-3.5 rounded-xl border border-cyan-800 shadow-2xl hud-glow-cyan text-xs font-mono">
      <div className="flex items-center space-x-2 text-cyan-400 font-bold mb-2 pb-1.5 border-b border-slate-800">
        <Navigation className="w-4 h-4" />
        <span>FIELD GPS TELEMETRY SIMULATOR</span>
      </div>

      <div className="text-[11px] text-slate-300 mb-2">
        <span>CURRENT: </span>
        <span className="text-emerald-400 font-bold">
          {mySquad ? `${mySquad.lat.toFixed(4)}, ${mySquad.lon.toFixed(4)}` : 'ACQUIRING...'}
        </span>
        <span className="ml-2 text-slate-500">[{mySquad?.heading || 0}°]</span>
      </div>

      {/* Manual D-Pad */}
      <div className="grid grid-cols-3 gap-1 w-28 mx-auto mb-3">
        <div></div>
        <button
          onClick={() => moveSquad(0.0005, 0, 0)}
          className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <div></div>

        <button
          onClick={() => moveSquad(0, -0.0005, 270)}
          className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center justify-center text-[10px] text-slate-500 font-bold">
          GPS
        </div>
        <button
          onClick={() => moveSquad(0, 0.0005, 90)}
          className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        <div></div>
        <button
          onClick={() => moveSquad(-0.0005, 0, 180)}
          className="p-2 rounded bg-slate-800 hover:bg-cyan-900 border border-slate-700 text-slate-200 flex justify-center cursor-pointer"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
        <div></div>
      </div>

      {/* Auto Patrol toggle */}
      <button
        onClick={toggleAutoPatrol}
        className={`w-full py-1.5 px-2 rounded font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-colors ${
          isPatrolling
            ? 'bg-red-950 text-red-300 border border-red-700'
            : 'bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700'
        }`}
      >
        {isPatrolling ? (
          <>
            <Square className="w-3 h-3" />
            <span>STOP AUTO-PATROL</span>
          </>
        ) : (
          <>
            <Play className="w-3 h-3" />
            <span>START AUTO-PATROL (LIVE)</span>
          </>
        )}
      </button>
    </div>
  )
}
