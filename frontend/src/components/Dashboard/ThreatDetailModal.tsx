import React, { useState } from 'react'
import {
  X,
  AlertTriangle,
  Shield,
  CheckCircle,
  Archive,
  UserCheck,
  Compass,
  MapPin,
} from 'lucide-react'
import { DroneIcon } from '../Common/DroneIcon'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import { api } from '../../services/api'
import type { Threat } from '../../types'

interface ThreatDetailModalProps {
  threat: Threat
  onClose: () => void
}

export const ThreatDetailModal: React.FC<ThreatDetailModalProps> = ({
  threat,
  onClose,
}) => {
  const { user } = useAuthStore()
  const { squads, addOrUpdateThreat, removeThreat } = useMapStore()
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isCommandCenter =
    user?.role === 'MainCommandCenter' || user?.role === 'AreaCommandCenter'
  const isRegionalTOC = isCommandCenter
  const isSapper = user?.role === 'SapperSquad'
  const isRadar = user?.role === 'Radar'

  // EOD Specialist detection: Sapper squad role, or soldier with sapper role in team, or command center
  const hasEODSpecialist =
    isSapper ||
    Boolean(user?.soldiers?.some((s) => s.role === 'sapper')) ||
    Boolean(user?.soldier?.role === 'sapper') ||
    isCommandCenter

  const [customRadius, setCustomRadius] = useState<number>(threat.radius || 150)
  const [isSavingRadius, setIsSavingRadius] = useState<boolean>(false)
  const [radiusSuccessMsg, setRadiusSuccessMsg] = useState<string | null>(null)

  const handleUpdateDangerRadius = async () => {
    if (!customRadius || customRadius < 10) return
    setIsSavingRadius(true)
    setRadiusSuccessMsg(null)
    try {
      const updated = await api.threats.update(threat.id, { radius: customRadius })
      addOrUpdateThreat(updated, user?.id)
      setRadiusSuccessMsg(`Danger zone radius successfully set to ${customRadius}m`)
      setTimeout(() => setRadiusSuccessMsg(null), 3000)
    } catch (err: unknown) {
      console.error('Failed to update radius', err)
      setErrorMessage('Failed to update danger zone radius.')
    } finally {
      setIsSavingRadius(false)
    }
  }

  const assignedSquad = threat.assigned_to_id
    ? squads[threat.assigned_to_id]
    : null

  // Action: Take Responsibility (in_progress)
  const handleTakeResponsibility = async () => {
    if (!user) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const updated = await api.threats.update(threat.id, {
        engagement_status: 'in_progress',
        assigned_to_id: user.id,
      })
      addOrUpdateThreat(updated, user.id)
      onClose()
    } catch (err: unknown) {
      let msg = 'Failed to assign threat.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as {
          response?: { status?: number; data?: { error?: { message?: string } } }
        }
        if (axiosErr.response?.status === 409) {
          msg = '409 Conflict: This threat is already assigned to another unit.'
        } else {
          msg = axiosErr.response?.data?.error?.message || msg
        }
      }
      setErrorMessage(msg)
    } finally {
      setIsLoading(false)
    }
  }

  // Action: Resolve Threat (resolved)
  const handleResolve = async () => {
    if (!user) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const updated = await api.threats.update(threat.id, {
        engagement_status: 'resolved',
      })
      addOrUpdateThreat(updated, user.id)
      onClose()
    } catch (err: unknown) {
      let msg = 'Failed to resolve threat.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        msg = axiosErr.response?.data?.error?.message || msg
      }
      setErrorMessage(msg)
    } finally {
      setIsLoading(false)
    }
  }

  // Action: Archive Threat (inactive)
  const handleArchive = async () => {
    if (!user) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const updated = await api.threats.update(threat.id, {
        status: 'inactive',
      })
      addOrUpdateThreat(updated, user.id)
      removeThreat(threat.id)
      onClose()
    } catch (err: unknown) {
      let msg = 'Failed to archive threat.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        msg = axiosErr.response?.data?.error?.message || msg
      }
      setErrorMessage(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusBadge = () => {
    switch (threat.engagement_status) {
      case 'unassigned':
        return (
          <span className="px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-700 font-mono text-xs">
            UNASSIGNED (ACTIVE HAZARD)
          </span>
        )
      case 'in_progress':
        return (
          <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-700 font-mono text-xs">
            IN PROGRESS (BEING NEUTRALIZED)
          </span>
        )
      case 'resolved':
        return (
          <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700 font-mono text-xs">
            RESOLVED (AREA SECURED)
          </span>
        )
    }
  }

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg hud-panel rounded-xl border border-slate-700 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-red-950/80 border border-red-600 text-red-400">
              {threat.threat_type === 'drone' ? (
                <DroneIcon size={20} className="text-red-400 animate-pulse" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono tracking-wide">
                {threat.name}
              </h2>
              <div className="flex items-center space-x-2 mt-1">
                {getStatusBadge()}
                <span className="text-[10px] text-slate-400 font-mono uppercase">
                  [{threat.threat_type} • {threat.severity_level}]
                </span>
              </div>
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

        {/* Content & Details */}
        <div className="mt-4 space-y-3.5 text-xs font-mono">
          {threat.description && (
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-slate-300">
              <span className="text-slate-500 block mb-1">INTEL DISPATCH:</span>
              {threat.description}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-slate-300">
            <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 flex items-center space-x-2">
              <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-500 block">COORDINATES</span>
                <span>
                  {threat.lat.toFixed(4)}, {threat.lon.toFixed(4)}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 flex items-center space-x-2">
              <Compass className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-500 block">DANGER PERIMETER</span>
                <span>{threat.radius || 150}m RADIUS BUFFER</span>
              </div>
            </div>
          </div>

          {threat.altitude !== null && threat.altitude !== undefined && (
            <div className="p-2.5 rounded bg-slate-900/60 border border-cyan-800 text-cyan-300">
              UAV ALTITUDE: {threat.altitude} METERS AGL
            </div>
          )}

          {/* Author / Soldier Attribution Display */}
          {(threat.created_by_soldier_name || threat.created_by_unit_name) && (
            <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300">
              <span className="text-[10px] text-slate-500 block uppercase font-mono">THREAT ATTRIBUTION</span>
              <span className="font-mono text-cyan-300 font-semibold">
                Reported by:{' '}
                {threat.created_by_soldier_name
                  ? `${threat.created_by_soldier_name} (ID: ${threat.created_by_soldier_id || 'N/A'}) - ${threat.created_by_unit_name || 'Duty Desk'}`
                  : threat.created_by_unit_name || 'Authorized Unit'}
              </span>
            </div>
          )}

          {assignedSquad && (
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/60 text-amber-300 flex items-center space-x-2">
              <UserCheck className="w-4 h-4 shrink-0" />
              <div>
                <span className="text-[10px] text-amber-400/80 block">ASSIGNED TACTICAL UNIT:</span>
                <span className="font-bold">{assignedSquad.name}</span>{' '}
                <span className="text-xs text-amber-400/70">[{assignedSquad.role}]</span>
              </div>
            </div>
          )}

          {/* Administrator Danger Zone Definition (Applicable to both moving & stationary threats) */}
          {isCommandCenter && (
            <div className="mt-4 p-3 rounded-lg bg-slate-900/90 border border-cyan-800/60 font-mono">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-cyan-400" />
                  <span>ADMINISTRATOR THREAT ZONE DEFINITION</span>
                </span>
                <span className="text-[10px] text-slate-400 uppercase">
                  [{threat.type === 'movable' ? 'MOVING THREAT' : 'STATIONARY THREAT'}]
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mb-2">
                Set operational danger zone radius (X meters) to designate the active red hazard buffer.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="10"
                  max="5000"
                  value={customRadius}
                  onChange={(e) => setCustomRadius(Number(e.target.value))}
                  className="w-28 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-xs text-slate-400">m</span>
                <div className="flex gap-1">
                  {[100, 150, 300, 500].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCustomRadius(preset)}
                      className={`text-[9px] px-1.5 py-0.5 rounded border ${
                        customRadius === preset
                          ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {preset}m
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleUpdateDangerRadius}
                  disabled={isSavingRadius}
                  className="ml-auto px-3 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold font-mono transition-all cursor-pointer shadow"
                >
                  {isSavingRadius ? 'SAVING...' : 'APPLY ZONE'}
                </button>
              </div>
              {radiusSuccessMsg && (
                <div className="mt-1.5 text-[10px] text-emerald-400 font-bold">
                  ✓ {radiusSuccessMsg}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tactical Actions (RBAC Enforced: EOD handles, TOC manager removes) */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap gap-2 justify-end items-center">
          {/* DRONE THREATS: RADAR DESTROYS, REGIONAL TOC REMOVES */}
          {threat.threat_type === 'drone' ? (
            <>
              {isRadar && threat.engagement_status !== 'resolved' && (
                <button
                  onClick={handleResolve}
                  disabled={isLoading}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold flex items-center space-x-1.5 shadow-lg shadow-emerald-900/40 transition-all cursor-pointer"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>CONFIRM DRONE DESTROYED</span>
                </button>
              )}
              {isRegionalTOC ? (
                <button
                  onClick={handleArchive}
                  disabled={isLoading}
                  className="px-3.5 py-2 rounded bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-200 font-mono text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>REMOVE / ARCHIVE DRONE TRACK</span>
                </button>
              ) : (
                <span className="text-[10px] text-slate-500 font-mono">
                  * Only Regional TOC Manager can remove alerts
                </span>
              )}
            </>
          ) : (
            <>
              {/* NON-DRONE THREATS: A team with an EOD specialist can handle them */}
              {threat.engagement_status === 'unassigned' && (
                <button
                  onClick={handleTakeResponsibility}
                  disabled={isLoading || !hasEODSpecialist}
                  className={`px-4 py-2 rounded font-mono text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                    hasEODSpecialist
                      ? 'bg-amber-600 hover:bg-amber-500 text-black shadow-lg shadow-amber-900/40'
                      : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                  title={
                    !hasEODSpecialist
                      ? 'Only a team with an EOD specialist (Sapper) can handle this threat'
                      : ''
                  }
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>
                    {!hasEODSpecialist
                      ? 'REQUIRES EOD SPECIALIST'
                      : 'TAKE RESPONSIBILITY'}
                  </span>
                </button>
              )}

              {threat.engagement_status === 'in_progress' && (
                <button
                  onClick={handleResolve}
                  disabled={isLoading || !hasEODSpecialist}
                  className={`px-4 py-2 rounded text-white font-mono text-xs font-semibold flex items-center space-x-1.5 shadow-lg transition-all cursor-pointer ${
                    hasEODSpecialist
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/40'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>MARK RESOLVED / NEUTRALIZED</span>
                </button>
              )}

              {/* Only Regional TOC Manager can remove items */}
              {isRegionalTOC ? (
                <button
                  onClick={handleArchive}
                  disabled={isLoading}
                  className="px-3.5 py-2 rounded bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-200 font-mono text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>REMOVE / ARCHIVE THREAT</span>
                </button>
              ) : (
                <span className="text-[10px] text-slate-500 font-mono">
                  * Only Regional TOC Manager can remove alerts
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
