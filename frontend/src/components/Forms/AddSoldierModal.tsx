import React, { useState } from 'react'
import { X, UserPlus, CheckCircle, Shield } from 'lucide-react'
import { api } from '../../services/api'
import { useMapStore } from '../../store/useMapStore'

export type SoldierRoleOption = 'EOD' | 'Support/Non-combat' | 'Combat'

interface AddSoldierModalProps {
  isOpen: boolean
  onClose: () => void
  initialSquadId?: string | null
}

export const AddSoldierModal: React.FC<AddSoldierModalProps> = ({
  isOpen,
  onClose,
  initialSquadId = null,
}) => {
  const { loadSnapshot } = useMapStore()

  const [soldierId, setSoldierId] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<SoldierRoleOption>('Combat')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const handleGenerateId = () => {
    const randomId = Math.floor(1000000 + Math.random() * 9000000).toString()
    setSoldierId(randomId)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsLoading(true)

    if (!soldierId || soldierId.length !== 7 || !/^\d{7}$/.test(soldierId)) {
      setErrorMessage('Soldier military ID must be exactly 7 digits.')
      setIsLoading(false)
      return
    }

    if (!name.trim()) {
      setErrorMessage('Soldier name is required.')
      setIsLoading(false)
      return
    }

    try {
      const created = await api.admin.createSoldier({
        id: soldierId.trim(),
        name: name.trim(),
        role,
        squad_id: initialSquadId || null,
      })

      setSuccessMessage(`Soldier ${created.name} (ID: ${created.id}) successfully registered!`)
      await loadSnapshot()

      setTimeout(() => {
        setSuccessMessage(null)
        setSoldierId('')
        setName('')
        setRole('Combat')
        onClose()
      }, 1200)
    } catch (err: unknown) {
      let msg = 'Failed to create soldier.'
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
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md hud-panel rounded-xl border border-cyan-500/70 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-500/60 text-cyan-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono tracking-wider">
                ADD SOLDIER
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                MILITARY REGISTRATION (7-DIGIT ID REQUIRED)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/80 border border-red-700 text-red-200 text-xs font-mono">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-950/80 border border-emerald-600 text-emerald-300 text-xs font-mono flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 font-mono">
          {/* Field 1: 7-Digit Military ID */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-300 tracking-wider uppercase font-semibold">
                1. 7-Digit Military ID
              </label>
              <button
                type="button"
                onClick={handleGenerateId}
                className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
              >
                + GENERATE ID
              </button>
            </div>
            <input
              type="text"
              required
              maxLength={7}
              placeholder="e.g. 5000001"
              value={soldierId}
              onChange={(e) => setSoldierId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-cyan-300 text-xs focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Field 2: Name */}
          <div>
            <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
              2. Soldier Full Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. David Cohen"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Field 3: Role (EOD, Support/Non-combat, Combat) */}
          <div>
            <label className="block text-xs text-slate-300 mb-2 tracking-wider uppercase font-semibold">
              3. Operational Role
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['EOD', 'Support/Non-combat', 'Combat'] as SoldierRoleOption[]).map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRole(r)}
                  className={`py-2.5 px-2 rounded-lg text-xs font-mono font-bold text-center border transition-all cursor-pointer ${
                    role === r
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(0,229,255,0.25)]'
                      : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <div className="text-[11px] leading-tight">{r}</div>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">
              Selected role: <span className="text-cyan-300 font-bold">{role}</span>
            </p>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-xs shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>{isLoading ? 'REGISTERING...' : 'ADD SOLDIER'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
