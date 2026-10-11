import React, { useState } from 'react'
import {
  X,
  Users,
  MapPin,
  Clock,
  UserX,
} from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import { api } from '../../services/api'
import type { Squad } from '../../types'

interface UnitListDrawerProps {
  isOpen: boolean
  onClose: () => void
}

function isStale(updatedAt?: string): boolean {
  if (!updatedAt) return false
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  return diffMs > 60000
}

export const UnitListDrawer: React.FC<UnitListDrawerProps> = ({ isOpen, onClose }) => {
  const { squads, removeSquad } = useMapStore()
  const { user } = useAuthStore()
  const [selectedSquad, setSelectedSquad] = useState<Squad | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const isMainAdmin = user?.role === 'MainCommandCenter'
  const squadList = Object.values(squads)

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
        <div className="flex items-center space-x-2.5">
          <Users className="w-5 h-5 text-cyan-400" />
          <h2 className="font-mono text-sm font-bold text-white tracking-wider">
            TACTICAL UNIT ROSTER ({squadList.length})
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {squadList.length === 0 ? (
          <div className="text-center py-12 text-slate-500 font-mono text-xs">
            No active units in sector.
          </div>
        ) : (
          squadList.map((sq) => {
            const stale = isStale(sq.updated_at)
            const isSelected = selectedSquad?.id === sq.id

            return (
              <div
                key={sq.id}
                onClick={() => setSelectedSquad(sq)}
                className={`p-3 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-950/70 border-cyan-500 text-white'
                    : 'bg-slate-900/60 hover:bg-slate-850 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        stale ? 'bg-slate-500' : 'bg-emerald-400 animate-pulse'
                      }`}
                    ></span>
                    <span className="font-bold text-white">{sq.name}</span>
                  </div>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${
                      sq.role === 'AreaCommandCenter'
                        ? 'bg-purple-950/70 text-purple-300 border-purple-700 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                        : sq.role === 'SapperSquad'
                        ? 'bg-amber-950/70 text-amber-300 border-amber-700'
                        : sq.role === 'Radar'
                        ? 'bg-blue-950/70 text-blue-300 border-blue-700'
                        : 'bg-emerald-950/70 text-emerald-300 border-emerald-700'
                    }`}
                  >
                    {sq.role === 'AreaCommandCenter' ? 'REGIONAL HQ' : sq.role}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <div className="flex items-center space-x-1">
                    <MapPin className="w-3 h-3 text-cyan-400" />
                    <span>
                      {sq.lat.toFixed(4)}, {sq.lon.toFixed(4)}
                    </span>
                  </div>
                  <span className="text-slate-500">[{sq.area}]</span>
                </div>

                {stale && (
                  <div className="mt-1 text-[10px] text-amber-400/90 font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>SIGNAL STALE (&gt;60s NO TELEMETRY)</span>
                  </div>
                )}
              </div>
            )
          })
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
