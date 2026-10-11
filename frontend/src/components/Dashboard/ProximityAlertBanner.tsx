import React from 'react'
import { AlertOctagon, X, Crosshair } from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'

export const ProximityAlertBanner: React.FC = () => {
  const { proximityAlerts, dismissAlert, setSelectedEntity } = useMapStore()

  if (proximityAlerts.length === 0) return null

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] w-full max-w-xl px-4 space-y-2 pointer-events-none">
      {proximityAlerts.map((threat) => (
        <div
          key={threat.id}
          className="pointer-events-auto p-3.5 rounded-lg bg-red-950/95 border-2 border-red-500 shadow-2xl hud-glow-red flex items-center justify-between animate-bounce"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-full bg-red-600 text-white animate-pulse">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <div className="font-mono text-xs font-bold text-red-100 tracking-wider flex items-center gap-2">
                <span>TACTICAL PROXIMITY ALERT (&lt;2 KM)</span>
                <span className="px-1.5 py-0.2 bg-red-800 text-white rounded text-[10px]">
                  {threat.severity_level.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-red-200 mt-0.5 font-mono">
                {threat.name} — {threat.threat_type} danger zone nearby!
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedEntity({ type: 'threat', id: threat.id })}
              className="px-2.5 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-semibold flex items-center space-x-1 cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>ENGAGE</span>
            </button>
            <button
              onClick={() => dismissAlert(threat.id)}
              className="p-1 rounded text-red-300 hover:text-white hover:bg-red-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
