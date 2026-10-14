import React, { useState } from 'react'
import {
  X,
  MapPin,
  Radio,
  AlertTriangle,
  ChevronRight,
  Flame,
  Users,
} from 'lucide-react'
import { DroneIcon } from '../Common/DroneIcon'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import type { Squad } from '../../types'
import { isHQOrRadar, isSquadTransmitting } from '../../utils/squadUtils'

interface OperationsDrawerProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'live' | 'alerts'
}

export const OperationsDrawer: React.FC<OperationsDrawerProps> = ({
  isOpen,
  onClose,
  initialTab = 'live',
}) => {
  const {
    squads,
    threats,
    focusEntity,
  } = useMapStore()
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'live' | 'alerts'>(initialTab)
  const [selectedSquad, setSelectedSquad] = useState<Squad | null>(null)
  const [prevTab, setPrevTab] = useState(initialTab)

  if (initialTab !== prevTab) {
    setPrevTab(initialTab)
    setActiveTab(initialTab)
  }

  const allSquadsList = Object.values(squads)
  const rosterList = allSquadsList.filter((sq) => sq.status === 'active')

  // Live session transmitting units only (Field units currently transmitting telemetry)
  const fieldSquadList = rosterList.filter((sq) => !isHQOrRadar(sq))
  const liveSquadList = fieldSquadList.filter((sq) => isSquadTransmitting(sq, user, fieldSquadList))

  // Active tactical alerts
  const activeThreatList = Object.values(threats).filter(
    (t) => t.status === 'active' && t.engagement_status !== 'resolved'
  )

  const handleFocusSquad = (sq: Squad) => {
    setSelectedSquad(sq)
    focusEntity('squad', sq.id, sq.lat, sq.lon, 15)
  }

  const handleFocusThreat = (th: typeof activeThreatList[number]) => {
    focusEntity('threat', th.id, th.lat, th.lon, 15)
  }

  const getRoleBadge = (sq: Squad) => {
    switch (sq.role) {
      case 'MainCommandCenter':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-purple-950/70 text-purple-300 border-purple-700">
            MAIN HQ
          </span>
        )
      case 'AreaCommandCenter':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-indigo-950/70 text-indigo-300 border-indigo-700">
            REGIONAL HQ ({sq.area.toUpperCase()})
          </span>
        )
      case 'Radar':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-sky-950/70 text-sky-300 border-sky-700">
            RADAR
          </span>
        )
      case 'SapperSquad':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-amber-950/70 text-amber-300 border-amber-700">
            SAPPER SQUAD
          </span>
        )
      default:
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-emerald-950/70 text-emerald-300 border-emerald-700">
            TACTICAL SQUAD
          </span>
        )
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 left-0 z-[1200] w-96 hud-panel border-r border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {activeTab === 'live' ? (
            <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
          )}
          <h2 className="font-mono text-sm font-bold text-white tracking-wider">
            {activeTab === 'live' ? 'LIVE OPERATIONS' : 'TACTICAL ALERTS'}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs: Live vs Alerts */}
      <div className="grid grid-cols-2 p-2 gap-1.5 border-b border-slate-800/80 bg-slate-950/60 font-mono text-xs">
        <button
          onClick={() => setActiveTab('live')}
          className={`py-2 px-3 rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer border ${
            activeTab === 'live'
              ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold shadow-sm shadow-emerald-950/40'
              : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 text-slate-400'
          }`}
        >
          <Radio className="w-4 h-4 text-emerald-400" />
          <span>LIVE ({liveSquadList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('alerts')}
          className={`py-2 px-3 rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer border ${
            activeTab === 'alerts'
              ? 'bg-red-950/80 border-red-600 text-red-300 font-bold shadow-sm shadow-red-950/40'
              : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 text-slate-400'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span>ALERTS ({activeThreatList.length})</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {activeTab === 'live' ? (
          liveSquadList.length === 0 ? (
            <div className="text-center py-16 text-slate-500 font-mono text-xs">
              <Radio className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
              <div>NO TRANSMITTING FIELD UNITS</div>
              <div className="text-[10px] text-slate-600 mt-1">Field units appear here when transmitting live coordinates</div>
            </div>
          ) : (
            liveSquadList.map((sq) => {
              const isSelected = selectedSquad?.id === sq.id
              return (
                <div
                  key={sq.id}
                  onClick={() => handleFocusSquad(sq)}
                  className={`p-3 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-md shadow-emerald-950/30'
                      : 'bg-slate-900/60 hover:bg-slate-850 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse"></span>
                      <span className="font-bold text-white">{sq.name}</span>
                    </div>
                    {getRoleBadge(sq)}
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

                  <div className="mt-2 flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px]">
                    <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                      <Radio className="w-3 h-3 animate-pulse" />
                      <span>LIVE TELEMETRY ACTIVE</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleFocusSquad(sq)
                      }}
                      className="px-2 py-0.5 rounded bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-300 flex items-center gap-1 font-bold text-[10px] transition-colors cursor-pointer"
                    >
                      FOCUS <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })
          )
        ) : (
          activeThreatList.length === 0 ? (
            <div className="text-center py-16 text-slate-500 font-mono text-xs">
              <AlertTriangle className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
              <div>NO ACTIVE THREATS IN SECTOR</div>
              <div className="text-[10px] text-slate-600 mt-1">All tactical sectors reported clear</div>
            </div>
          ) : (
            activeThreatList.map((th) => (
              <div
                key={th.id}
                onClick={() => handleFocusThreat(th)}
                className="p-3 rounded-lg border border-red-900/60 bg-red-950/20 hover:bg-red-950/50 hover:border-red-600 text-xs font-mono transition-all cursor-pointer shadow-sm shadow-red-950/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {th.threat_type === 'drone' || th.name.toLowerCase().includes('drone') ? (
                      <DroneIcon size={15} className="text-red-400 animate-pulse" />
                    ) : (
                      <Flame className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                    )}
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

      {/* Selected Unit Personnel Roster Inspector */}
      {selectedSquad && activeTab === 'live' && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 font-mono text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              <span>ROSTER: {selectedSquad.name}</span>
            </span>
            <button
              onClick={() => setSelectedSquad(null)}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              CLOSE
            </button>
          </div>
          {selectedSquad.soldiers && selectedSquad.soldiers.length > 0 ? (
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {selectedSquad.soldiers.map((s) => (
                <div
                  key={s.id}
                  className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] flex items-center justify-between"
                >
                  <span className="text-slate-300">{s.name}</span>
                  <span className="text-cyan-400 font-mono text-[9px] uppercase">
                    [{s.role}] #{s.id}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 italic">No soldiers assigned to unit roster</div>
          )}
        </div>
      )}
    </div>
  )
}
