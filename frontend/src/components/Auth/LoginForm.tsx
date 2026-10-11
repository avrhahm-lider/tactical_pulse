import React, { useState } from 'react'
import { Shield, Lock, User, AlertCircle, ChevronRight, Terminal } from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: 'MainCommandCenter', label: 'Main Command (Global)', badge: 'GLOBAL' },
  { username: 'command_north', password: 'command123', role: 'AreaCommandCenter', label: 'North Command', badge: 'NORTH' },
  { username: 'command_center', password: 'command123', role: 'AreaCommandCenter', label: 'Center Command', badge: 'CENTER' },
  { username: 'command_south', password: 'command123', role: 'AreaCommandCenter', label: 'South Command', badge: 'SOUTH' },
  { username: 'squad_golani', password: 'squad123', role: 'Squad', label: 'Golani Tactical Squad', badge: 'FIELD' },
  { username: 'squad_paratroopers', password: 'squad123', role: 'SapperSquad', label: 'Paratroopers EOD Sapper', badge: 'SAPPER' },
  { username: 'radar_post_1', password: 'radar123', role: 'Radar', label: 'Radar Monitoring Unit', badge: 'RADAR' },
]

export const LoginForm: React.FC = () => {
  const [username, setUsername] = useState('command_north')
  const [password, setPassword] = useState('command123')
  const { login, isLoading, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    await login(username, password)
  }

  const handleSelectDemo = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setUsername(acc.username)
    setPassword(acc.password)
    clearError()
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="relative w-full max-w-lg hud-panel rounded-xl p-8 border border-slate-700/80 shadow-2xl hud-glow-cyan overflow-hidden">
        {/* Subtle decorative grid header */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500"></div>

        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 rounded-lg bg-cyan-950/60 border border-cyan-500/50 text-cyan-400">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-wider text-white flex items-center gap-2">
              TACTICAL PULSE
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-400 border border-cyan-700/60 font-mono">
                MVP
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono tracking-tight">
              ISRAEL OPERATIONAL COMMAND & SITUATIONAL AWARENESS
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-950/50 border border-red-700/60 flex items-start space-x-2 text-red-200 text-sm">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-username"
              className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase"
            >
              Operator Call-sign / Username
            </label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                id="login-username"
                name="username"
                autoComplete="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. command_north"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase"
            >
              Authentication Key / Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                id="login-password"
                name="password"
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 mt-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-black font-semibold text-sm tracking-wider uppercase flex items-center justify-center space-x-2 transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-cyan-900/40"
          >
            {isLoading ? (
              <span className="flex items-center space-x-2 font-mono">
                <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                <span>AUTHENTICATING...</span>
              </span>
            ) : (
              <span className="flex items-center space-x-2">
                <span>ESTABLISH SECURE LINK</span>
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </button>
        </form>

        {/* Quick Demo Selector */}
        <div className="mt-6 pt-5 border-t border-slate-800">
          <div className="flex items-center space-x-2 text-xs font-mono text-slate-400 mb-3 uppercase tracking-wider">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>Quick-Switch Operational Demo Roles:</span>
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.username}
                type="button"
                onClick={() => handleSelectDemo(acc)}
                className={`text-left p-2 rounded-md border text-xs font-mono transition-colors flex items-center justify-between ${
                  username === acc.username
                    ? 'bg-cyan-950/70 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="truncate pr-1">
                  <span className="font-semibold block truncate">{acc.label}</span>
                  <span className="text-[10px] text-slate-500">@{acc.username}</span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono shrink-0">
                  {acc.badge}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
