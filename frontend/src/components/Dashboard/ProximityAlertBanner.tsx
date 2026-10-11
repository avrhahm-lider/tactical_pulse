import React from 'react'
import { AlertOctagon, AlertTriangle, X, Crosshair, ShieldAlert } from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'

export const ProximityAlertBanner: React.FC = () => {
  const {
    proximityAlerts,
    dangerZoneAlerts,
    dismissAlert,
    dismissDangerZoneAlert,
    setSelectedEntity,
  } = useMapStore()

  if (proximityAlerts.length === 0 && dangerZoneAlerts.length === 0) return null

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] w-full max-w-xl px-4 space-y-2 pointer-events-none">
      {/* 1. Critical Danger Zone Intrusion Alerts (Squad inside Drone / Threat radius) */}
      {dangerZoneAlerts.map((alert) => (
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
                <strong className="text-white underline">{alert.squad_name}</strong> is inside{' '}
                <strong className="text-amber-300">{alert.threat_name}</strong> lethal zone!{' '}
                <span className="text-red-300 font-bold">
                  (Dist: {alert.distance_meters}m &le; {alert.danger_radius_meters}m)
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

      {/* 2. Tactical Proximity Alerts (<2 km) */}
      {proximityAlerts.map((threat) => (
        <div
          key={threat.id}
          className="pointer-events-auto p-3 rounded-lg bg-slate-900/90 border border-amber-500/80 shadow-xl flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <div className="p-1.5 rounded-full bg-amber-500/20 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="font-mono text-xs font-bold text-amber-200 tracking-wider flex items-center gap-2">
                <span>TACTICAL PROXIMITY ALERT (&lt;2 KM)</span>
                <span className="px-1.5 py-0.2 bg-amber-800 text-white rounded text-[10px]">
                  {threat.severity_level.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 font-mono">
                {threat.name} — {threat.threat_type} detected nearby!
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedEntity({ type: 'threat', id: threat.id })}
              className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-semibold flex items-center space-x-1 cursor-pointer"
            >
              <Crosshair className="w-3 h-3" />
              <span>INSPECT</span>
            </button>
            <button
              onClick={() => dismissAlert(threat.id)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
