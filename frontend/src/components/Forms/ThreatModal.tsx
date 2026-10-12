import React, { useState, useEffect } from 'react'
import {
  X,
  AlertTriangle,
  Crosshair,
  MapPin,
  Plane,
} from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import { api } from '../../services/api'
import type { ThreatType, ThreatCategory, SeverityLevel } from '../../types'

interface ThreatModalProps {
  isOpen: boolean
  onClose: () => void
}

export const ThreatModal: React.FC<ThreatModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuthStore()
  const {
    squads,
    pickedLocation,
    setPickedLocation,
    setIsPickingLocationOnMap,
    addOrUpdateThreat,
  } = useMapStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<ThreatType>('immovable')
  const [threatType, setThreatType] = useState<ThreatCategory>('explosive')
  const [severityLevel, setSeverityLevel] = useState<SeverityLevel>('high')
  const [radius, setRadius] = useState<number>(150)
  const [lat, setLat] = useState<string>('32.0800')
  const [lon, setLon] = useState<string>('34.7800')
  const [altitude, setAltitude] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Retrieve current user's attached soldier roster
  const unitSoldiers = user?.soldiers || (user?.id ? squads[user.id]?.soldiers : []) || []
  const defaultSoldierId = user?.soldier_id || user?.soldier?.id || unitSoldiers[0]?.id || ''
  const [reportingSoldierId, setReportingSoldierId] = useState<string>(defaultSoldierId)

  useEffect(() => {
    if (!reportingSoldierId && defaultSoldierId) {
      setReportingSoldierId(defaultSoldierId)
    }
  }, [defaultSoldierId, reportingSoldierId])

  // Update coordinates when picked from map
  useEffect(() => {
    if (pickedLocation) {
      setLat(pickedLocation.lat.toFixed(6))
      setLon(pickedLocation.lon.toFixed(6))
    }
  }, [pickedLocation])

  // Quick GPS mode: grab coordinates from current user if field unit
  const handleUseQuickGPS = () => {
    if (user?.id && squads[user.id]) {
      const mySquad = squads[user.id]
      setLat(mySquad.lat.toFixed(6))
      setLon(mySquad.lon.toFixed(6))
      setPickedLocation(null)
    } else {
      // Default to central Israel if command center
      setLat('32.0853')
      setLon('34.7818')
    }
  }

  // Interactive Pin Drop mode
  const handleSelectOnMap = () => {
    setIsPickingLocationOnMap(true)
    onClose() // Close modal temporarily while user clicks on map
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setIsLoading(true)

    const parsedLat = parseFloat(lat)
    const parsedLon = parseFloat(lon)

    if (isNaN(parsedLat) || isNaN(parsedLon)) {
      setErrorMessage('Invalid coordinates format.')
      setIsLoading(false)
      return
    }

    if (parsedLat < 29.0 || parsedLat > 34.0 || parsedLon < 33.5 || parsedLon > 36.5) {
      setErrorMessage('Coordinates out of Israeli bounding box (Lat: 29.0-34.0, Lon: 33.5-36.5).')
      setIsLoading(false)
      return
    }

    if (user?.role !== 'Radar' && (type === 'movable' || threatType === 'drone' || threatType === 'vehicle')) {
      setErrorMessage('Permission Denied: Only Radar stations can add drones or moving objects. Other units may only register stationary objects.')
      setIsLoading(false)
      return
    }

    try {
      const newThreat = await api.threats.create({
        name,
        description,
        type,
        threat_type: threatType,
        severity_level: severityLevel,
        radius: Number(radius) || 150,
        lat: parsedLat,
        lon: parsedLon,
        altitude: threatType === 'drone' && altitude ? parseFloat(altitude) : null,
        soldier_id: reportingSoldierId || undefined,
      })

      // Add to local state (Socket also receives it)
      addOrUpdateThreat(newThreat, user?.id)
      setPickedLocation(null)
      onClose()
    } catch (err: unknown) {
      let msg = 'Failed to report threat.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        msg = axiosErr.response?.data?.error?.message || msg
      }
      setErrorMessage(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[1500] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 ${
        !isOpen ? 'hidden pointer-events-none' : ''
      }`}
    >
      <div className="relative w-full max-w-xl hud-panel rounded-xl border border-red-900/60 shadow-2xl p-6 overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-red-950 border border-red-700/60 text-red-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono tracking-wider">
                OPEN TACTICAL ALERT
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                BROADCASTS NEW HAZARD &amp; TRIGGER 150M DANGER RADIUS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/80 border border-red-700 text-red-200 text-xs font-mono">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Dual GPS Capture Buttons */}
          <div className="grid grid-cols-2 gap-3 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
            <button
              type="button"
              onClick={handleUseQuickGPS}
              className="py-2 px-3 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono flex items-center justify-center space-x-2 transition-colors cursor-pointer"
            >
              <Crosshair className="w-4 h-4 text-emerald-400" />
              <span>CURRENT GPS COORDS</span>
            </button>

            <button
              type="button"
              onClick={handleSelectOnMap}
              className="py-2 px-3 rounded bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-xs font-mono flex items-center justify-center space-x-2 transition-colors cursor-pointer"
            >
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span>SELECT FROM MAP</span>
            </button>
          </div>

          {/* Coordinates Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="threat-lat" className="block text-[11px] font-mono text-slate-300 mb-1">
                LATITUDE (29.0° – 34.0°)
              </label>
              <input
                id="threat-lat"
                name="lat"
                type="number"
                step="0.000001"
                required
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs focus:border-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="threat-lon" className="block text-[11px] font-mono text-slate-300 mb-1">
                LONGITUDE (33.5° – 36.5°)
              </label>
              <input
                id="threat-lon"
                name="lon"
                type="number"
                step="0.000001"
                required
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Reporting Soldier / Operator Selection */}
          <div className="p-2.5 rounded bg-slate-900/80 border border-slate-700/80 space-y-1">
            <label htmlFor="reporting-soldier" className="block text-[11px] font-mono text-cyan-300 font-semibold uppercase">
              REPORTING SOLDIER / OPERATOR
            </label>
            {unitSoldiers.length > 0 ? (
              <select
                id="reporting-soldier"
                name="reporting_soldier"
                value={reportingSoldierId}
                onChange={(e) => setReportingSoldierId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white font-mono text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
              >
                {unitSoldiers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} [ID: {s.id}] — {s.role.toUpperCase()}
                  </option>
                ))}
              </select>
            ) : user?.soldier_id ? (
              <div className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-cyan-300 flex justify-between items-center">
                <span>{user.name}</span>
                <span className="text-slate-400">Military ID: {user.soldier_id}</span>
              </div>
            ) : (
              <div className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-slate-400">
                Operating Unit: {user?.name || 'Tactical Force'}
              </div>
            )}
            <p className="text-[10px] text-slate-400 font-mono">
              Attaches military operator attribution to this intelligence incident report.
            </p>
          </div>

          {/* Name & Threat Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="threat-name" className="block text-[11px] font-mono text-slate-300 mb-1">
                THREAT DESIGNATION / NAME
              </label>
              <input
                id="threat-name"
                name="name"
                type="text"
                required
                placeholder="e.g. IED Blockade Route 4"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="threat-category" className="block text-[11px] font-mono text-slate-300 mb-1">
                CATEGORY (THREAT TYPE)
              </label>
              <select
                id="threat-category"
                name="threat_type"
                value={threatType}
                onChange={(e) => {
                  const val = e.target.value as ThreatCategory
                  setThreatType(val)
                  if (val === 'explosive') {
                    setType('immovable')
                  } else {
                    setType('movable')
                  }
                }}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs focus:border-red-500 focus:outline-none"
              >
                <option value="explosive">Explosive / IED (Stationary)</option>
                {user?.role === 'Radar' ? (
                  <>
                    <option value="drone">Hostile UAV / Drone (Radar Auth)</option>
                    <option value="vehicle">Hostile Vehicle (Radar Auth)</option>
                    <option value="personnel">Hostile Personnel (Movable)</option>
                  </>
                ) : (
                  <>
                    <option value="drone" disabled>Hostile UAV / Drone (Radar Only)</option>
                    <option value="vehicle" disabled>Hostile Vehicle (Radar Only)</option>
                    <option value="personnel" disabled>Hostile Personnel (Radar Only)</option>
                  </>
                )}
              </select>
              {user?.role !== 'Radar' && (
                <p className="text-[10px] text-amber-400/90 font-mono mt-1">
                  * Only Radar stations can add aerial drones or moving objects.
                </p>
              )}
            </div>
          </div>

          {/* Severity & Danger Radius (Admin Defined Threat Zone) */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="threat-mobility" className="block text-[11px] font-mono text-slate-300 mb-1">
                MOBILITY TYPE
              </label>
              <select
                id="threat-mobility"
                name="type"
                value={type}
                disabled={user?.role !== 'Radar'}
                onChange={(e) => setType(e.target.value as ThreatType)}
                className={`w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded font-mono text-xs focus:border-red-500 focus:outline-none ${
                  user?.role !== 'Radar' ? 'text-slate-400 cursor-not-allowed' : 'text-white'
                }`}
              >
                <option value="immovable">Immovable (Stationary)</option>
                {user?.role === 'Radar' && <option value="movable">Movable (Moving)</option>}
              </select>
            </div>

            <div>
              <label htmlFor="threat-severity" className="block text-[11px] font-mono text-slate-300 mb-1">
                SEVERITY LEVEL
              </label>
              <select
                id="threat-severity"
                name="severity_level"
                value={severityLevel}
                onChange={(e) => setSeverityLevel(e.target.value as SeverityLevel)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs focus:border-red-500 focus:outline-none"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label htmlFor="threat-radius" className="block text-[11px] font-mono text-slate-300 mb-1">
                DANGER ZONE (X METERS)
              </label>
              <input
                id="threat-radius"
                name="radius"
                type="number"
                min="10"
                max="5000"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs focus:border-red-500 focus:outline-none"
              />
              <div className="flex gap-1 mt-1">
                {[100, 150, 300, 500].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRadius(preset)}
                    className={`text-[9px] px-1 py-0.5 rounded border ${
                      radius === preset
                        ? 'bg-red-950 border-red-500 text-red-200'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {preset}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Altitude for UAV Drone */}
          {threatType === 'drone' && (
            <div>
              <label htmlFor="threat-altitude" className="block text-[11px] font-mono text-cyan-300 mb-1 flex items-center gap-1">
                <Plane className="w-3.5 h-3.5" />
                <span>UAV ALTITUDE (METERS AGL)</span>
              </label>
              <input
                id="threat-altitude"
                name="altitude"
                type="number"
                min="0"
                placeholder="e.g. 250"
                value={altitude}
                onChange={(e) => setAltitude(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-cyan-800 rounded text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label htmlFor="threat-description" className="block text-[11px] font-mono text-slate-300 mb-1">
              TACTICAL INTEL / DESCRIPTION
            </label>
            <textarea
              id="threat-description"
              name="description"
              rows={2}
              placeholder="e.g. Visual confirmed: suspicious cylindrical object on road shoulder..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs focus:border-red-500 focus:outline-none resize-none"
            />
          </div>

          {/* Submit */}
          <div className="pt-2 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 rounded bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold tracking-wider uppercase transition-all shadow-lg shadow-red-900/50 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? 'SUBMITTING INTEL...' : 'BROADCAST THREAT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
