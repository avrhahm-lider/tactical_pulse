import React from 'react'
import {
  Shield,
  Radio,
  AlertTriangle,
  Users,
  LogOut,
  PlusCircle,
} from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { useMapStore } from '../../store/useMapStore'

interface HeaderProps {
  onOpenCreateThreat: () => void
  onToggleUnitDrawer: () => void
  isUnitDrawerOpen: boolean
}

export const Header: React.FC<HeaderProps> = ({
  onOpenCreateThreat,
  onToggleUnitDrawer,
  isUnitDrawerOpen,
}) => {
  const { user, logout } = useAuthStore()
  const { squads, threats } = useMapStore()

  const activeThreatCount = Object.values(threats).filter(
    (t) => t.status === 'active' && t.engagement_status !== 'resolved'
  ).length

  const activeSquadCount = Object.values(squads).filter(
    (s) => s.status === 'active'
  ).length

  // Area badge color
  const getAreaColor = (area?: string) => {
    switch (area) {
      case 'North':
        return 'text-cyan-400 border-cyan-800 bg-cyan-950/60'
      case 'Center':
        return 'text-amber-400 border-amber-800 bg-amber-950/60'
      case 'South':
        return 'text-emerald-400 border-emerald-800 bg-emerald-950/60'
      case 'Global':
        return 'text-purple-400 border-purple-800 bg-purple-950/60'
      default:
        return 'text-slate-400 border-slate-700 bg-slate-800/60'
    }
  }

  return (
    <header className="h-16 hud-glass border-b border-slate-800 px-6 flex items-center justify-between z-10 shrink-0">
      {/* Left: Branding & Connection Status */}
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-950 border border-cyan-500/60 flex items-center justify-center text-cyan-400 shadow-md shadow-cyan-900/30">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-widest text-white">TACTICAL PULSE</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-600 text-cyan-400 font-mono">
                C2 LIVE
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs font-mono text-slate-400">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>SOCKET LINK ACTIVE (PORT 8000)</span>
            </div>
          </div>
        </div>

        {/* Live Counters */}
        <div className="hidden lg:flex items-center space-x-4 pl-6 border-l border-slate-800">
          <div className="flex items-center space-x-2 text-xs font-mono bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-md">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400">UNITS:</span>
            <span className="font-bold text-emerald-400">{activeSquadCount}</span>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-md">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-slate-400">ACTIVE THREATS:</span>
            <span className="font-bold text-red-400">{activeThreatCount}</span>
          </div>
        </div>
      </div>

      {/* Right: Actions & User Info */}
      <div className="flex items-center space-x-4">
        {/* Create Threat Button */}
        <button
          onClick={onOpenCreateThreat}
          className="px-3.5 py-2 rounded-lg bg-red-600/90 hover:bg-red-500 text-white font-mono text-xs font-semibold tracking-wider flex items-center space-x-2 shadow-lg shadow-red-950/40 border border-red-500/50 transition-all cursor-pointer"
        >
          <PlusCircle className="w-4 h-4" />
          <span>REPORT THREAT</span>
        </button>

        {/* Toggle Unit Drawer */}
        <button
          onClick={onToggleUnitDrawer}
          className={`px-3.5 py-2 rounded-lg font-mono text-xs font-semibold tracking-wider flex items-center space-x-2 border transition-all cursor-pointer ${
            isUnitDrawerOpen
              ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
              : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-300'
          }`}
        >
          <Users className="w-4 h-4 text-cyan-400" />
          <span>ROSTER ({activeSquadCount})</span>
        </button>

        {/* User Badge */}
        {user && (
          <div className="hidden sm:flex items-center space-x-3 pl-4 border-l border-slate-800">
            <div className="text-right">
              <div className="text-xs font-bold text-white leading-tight">{user.name}</div>
              <div className="flex items-center justify-end space-x-1.5 mt-0.5">
                <span className="text-[10px] text-slate-400 font-mono">[{user.role}]</span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded border font-mono font-semibold ${getAreaColor(
                    user.area
                  )}`}
                >
                  {user.area}
                </span>
              </div>
            </div>

            <button
              onClick={() => logout()}
              title="Logout"
              className="p-2 rounded-lg bg-slate-900/80 hover:bg-red-950/60 border border-slate-800 hover:border-red-700 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
