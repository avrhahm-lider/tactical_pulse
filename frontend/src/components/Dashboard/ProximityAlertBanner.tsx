import React from 'react'
import { X, Crosshair, ShieldAlert } from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'

export const ProximityAlertBanner: React.FC = () => {
  const {
    dangerZoneAlerts,
    dismissDangerZoneAlert,
    setSelectedEntity,
  } = useMapStore()

  const { user } = useAuthStore()

  // Only show alert if this squad has entered the red danger circle specified for the threat!
  const relevantDangerAlerts = dangerZoneAlerts.filter(
    (alert) => user && alert.squad_id === user.id
  )

  if (relevantDangerAlerts.length === 0) return null

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] w-full max-w-xl px-4 space-y-2 pointer-events-none">
      {/* Critical Danger Zone Intrusion Alerts (Squad inside Threat's red circle) */}
      {relevantDangerAlerts.map((alert) => (
        <div
          key={alert.id}
          className="pointer-events-auto p-3.5 rounded-lg bg-red-950/95 border-2 border-red-500 shadow-2xl hud-glow-red flex items-center justify-between animate-bounce"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-full bg-red-600 text-white animate-ping">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="font-mono text-xs font-bold text-red-100 tracking-wider flex items-center gap-2">
                <span className="text-red-400 animate-pulse font-black">🚨 DANGER ZONE INTRUSION ALERT</span>
                <span className="px-1.5 py-0.2 bg-red-700 text-white rounded text-[10px] font-bold">
                  {alert.severity_level.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-red-200 mt-0.5 font-mono">
                <strong className="text-white underline">{alert.squad_name}</strong> entered{' '}
                <strong className="text-amber-300">{alert.threat_name}</strong> red danger perimeter!{' '}
                <span className="text-red-300 font-bold">
                  ({alert.distance_meters}m &le; {alert.danger_radius_meters}m)
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedEntity({ type: 'threat', id: alert.threat_id })}
              className="px-2.5 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-semibold flex items-center space-x-1 cursor-pointer shadow-lg"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>EVADE / ENGAGE</span>
            </button>
            <button
              onClick={() => dismissDangerZoneAlert(alert.id)}
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
