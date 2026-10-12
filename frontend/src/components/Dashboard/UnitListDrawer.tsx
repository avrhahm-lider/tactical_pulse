import React, { useState, useEffect } from 'react'
import {
  X,
  MapPin,
  Clock,
  UserX,
  UserPlus,
  Radio,
  AlertTriangle,
  ChevronRight,
  Flame,
} from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import { api } from '../../services/api'
import type { Squad } from '../../types'
import { isHQOrRadar, isSquadTransmitting } from '../../utils/squadUtils'

interface UnitListDrawerProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'units' | 'alerts'
}

export const UnitListDrawer: React.FC<UnitListDrawerProps> = ({
  isOpen,
  onClose,
  initialTab = 'units',
}) => {
  const { squads, threats, removeSquad, setIsUserRegistrationModalOpen, setSelectedEntity } = useMapStore()
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'units' | 'alerts'>(initialTab)
  const [selectedSquad, setSelectedSquad] = useState<Squad | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Sync tab when initialTab changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab, isOpen])

  const isMainAdmin = user?.role === 'MainCommandCenter'
  // Exclude static Headquarters and Radar installations
  const squadList = Object.values(squads).filter((sq) => !isHQOrRadar(sq))
  const activeThreatList = Object.values(threats).filter(
    (t) => t.status === 'active' && t.engagement_status !== 'resolved'
  )

  const handleDeactivateUnit = async (squadId: string) => {
    if (!window.confirm('Are you sure you want to deactivate this operational unit?')) return
    setIsLoading(true)
    try {
      await api.admin.updateStatus(squadId, 'inactive')
      removeSquad(squadId)
      setSelectedSquad(null)
    } catch (err) {
      console.error(err)
      alert('Failed to deactivate unit.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 right-0 z-[1200] w-96 hud-panel border-l border-slate-800 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {activeTab === 'units' ? (
            <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-400" />
          )}
          <h2 className="font-mono text-sm font-bold text-white tracking-wider">
            {activeTab === 'units' ? 'OPERATIONAL ROSTER' : 'ACTIVE TACTICAL ALERTS'}
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          {activeTab === 'units' && (
            <button
              onClick={() => setIsUserRegistrationModalOpen(true)}
              title="Register new force or headquarters"
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-mono text-[10px] flex items-center gap-1 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ FORCE</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs Switcher: Units vs Alerts */}
      <div className="grid grid-cols-2 p-2 gap-1.5 border-b border-slate-800/80 bg-slate-950/60 font-mono text-xs">
        <button
          onClick={() => setActiveTab('units')}
          className={`py-1.5 px-2 rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer border ${
            activeTab === 'units'
              ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold shadow-sm shadow-emerald-950/40'
              : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 text-slate-400'
          }`}
        >
          <Radio className="w-3.5 h-3.5 text-emerald-400" />
          <span>UNITS ({squadList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('alerts')}
          className={`py-1.5 px-2 rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer border ${
            activeTab === 'alerts'
              ? 'bg-red-950/80 border-red-600 text-red-300 font-bold shadow-sm shadow-red-950/40'
              : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 text-slate-400'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <span>ALERTS ({activeThreatList.length})</span>
        </button>
      </div>

      {/* Content List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activeTab === 'units' ? (
          squadList.length === 0 ? (
            <div className="text-center py-12 text-slate-500 font-mono text-xs">
              No active units in sector.
            </div>
          ) : (
            squadList.map((sq) => {
              const isTransmitting = isSquadTransmitting(sq, user, squadList)
              const isSelected = selectedSquad?.id === sq.id

              return (
                <div
                  key={sq.id}
                  onClick={() => setSelectedSquad(sq)}
                  className={`p-3 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500 text-white'
                      : 'bg-slate-900/60 hover:bg-slate-850 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          isTransmitting
                            ? 'bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse'
                            : 'bg-slate-500'
                        }`}
                      ></span>
                      <span className="font-bold text-white">{sq.name}</span>
                    </div>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${
                        sq.role === 'SapperSquad'
                          ? 'bg-amber-950/70 text-amber-300 border-amber-700'
                          : 'bg-emerald-950/70 text-emerald-300 border-emerald-700'
                      }`}
                    >
                      {sq.role === 'SapperSquad' ? 'SAPPER SQUAD' : 'TACTICAL SQUAD'}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                    <div className="flex items-center space-x-1">
                      <MapPin className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300/90 font-mono">
                        {sq.lat.toFixed(4)}, {sq.lon.toFixed(4)}
                      </span>
                    </div>
                    <span className="text-slate-500">[{sq.area}]</span>
                  </div>

                  {isTransmitting ? (
                    <div className="mt-1 text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <Radio className="w-3 h-3 animate-pulse" />
                      <span>LIVE TRANSMITTING</span>
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-slate-400 font-medium flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>SIGNAL STANDBY (NO TELEMETRY)</span>
                    </div>
                  )}
                </div>
              )
            })
          )
        ) : (
          /* Active Alerts Tab */
          activeThreatList.length === 0 ? (
            <div className="text-center py-12 text-slate-500 font-mono text-xs">
              No active tactical alerts in sector.
            </div>
          ) : (
            activeThreatList.map((th) => (
              <div
                key={th.id}
                onClick={() => setSelectedEntity({ type: 'threat', id: th.id })}
                className="p-3 rounded-lg border border-red-900/60 bg-red-950/20 hover:bg-red-950/50 hover:border-red-600 text-xs font-mono transition-all cursor-pointer shadow-sm shadow-red-950/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Flame className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                    <span className="font-bold text-white">{th.name}</span>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded border uppercase font-bold ${
                      th.severity_level === 'critical'
                        ? 'bg-red-950 text-red-300 border-red-600 shadow-[0_0_8px_#ef4444]'
                        : th.severity_level === 'high'
                        ? 'bg-amber-950 text-amber-300 border-amber-600'
                        : 'bg-yellow-950 text-yellow-300 border-yellow-700'
                    }`}
                  >
                    {th.severity_level}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <div className="flex items-center space-x-1">
                    <MapPin className="w-3 h-3 text-red-400" />
                    <span className="text-red-300 font-mono">
                      {th.lat.toFixed(4)}, {th.lon.toFixed(4)}
                    </span>
                  </div>
                  <span className="text-slate-400">R: {th.radius || 150}m</span>
                </div>

                <div className="mt-2 flex items-center justify-between pt-2 border-t border-red-950/80 text-[10px]">
                  <span className="text-slate-500 uppercase">TYPE: {th.threat_type}</span>
                  <span className="text-cyan-400 flex items-center gap-0.5 hover:underline font-bold">
                    DETAILS <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Selected Unit Details & Personnel Roster */}
      {selectedSquad && (
        <div className="p-4 border-t border-slate-800 bg-slate-950/90 max-h-60 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold font-mono text-white">
              SOLDIER ROSTER ({selectedSquad.soldiers?.length || 0})
            </span>
            {isMainAdmin && (
              <button
                onClick={() => handleDeactivateUnit(selectedSquad.id)}
                disabled={isLoading}
                className="text-[10px] px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-700 text-red-300 rounded font-mono flex items-center space-x-1 cursor-pointer"
              >
                <UserX className="w-3 h-3" />
                <span>DEACTIVATE</span>
              </button>
            )}
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            {selectedSquad.soldiers && selectedSquad.soldiers.length > 0 ? (
              selectedSquad.soldiers.map((soldier) => (
                <div
                  key={soldier.id}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px]"
                >
                  <div>
                    <span className="text-slate-200 font-semibold">{soldier.name}</span>
                    <span className="text-slate-500 text-[10px] ml-1">
                      (ID: {soldier.id})
                    </span>
                  </div>
                  <span
                    className={`text-[9px] px-1 py-0.2 rounded ${
                      soldier.role === 'sapper'
                        ? 'bg-amber-900/60 text-amber-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {soldier.role}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-slate-500 text-[11px]">
                No attached soldier personnel (Center / Radar Unit).
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
