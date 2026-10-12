import React, { useState } from 'react'
import { X, UserPlus, CheckCircle } from 'lucide-react'
import { api } from '../../services/api'
import { useMapStore } from '../../store/useMapStore'

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
  const { squads, loadSnapshot } = useMapStore()

  const [soldierId, setSoldierId] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'rifleman' | 'sapper' | 'medic' | 'recon' | 'commander'>('rifleman')
  const [targetSquadId, setTargetSquadId] = useState<string>(initialSquadId || '')
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
      setErrorMessage('Soldier ID must be exactly 7 digits.')
      setIsLoading(false)
      return
    }

    if (!name.trim()) {
      setErrorMessage('Soldier name is required.')
      setIsLoading(false)
      return
    }

    try {
      await api.admin.createSoldier({
        id: soldierId,
        name: name.trim(),
        role,
        squad_id: targetSquadId ? targetSquadId : null,
      })

      setSuccessMessage(`Soldier ${name} (ID: ${soldierId}) successfully added!`)
      await loadSnapshot()

      setTimeout(() => {
        setSuccessMessage(null)
        setSoldierId('')
        setName('')
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

  const availableSquads = Object.values(squads).filter(
    (s) => s.role === 'Squad' || s.role === 'SapperSquad'
  )

  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md hud-panel rounded-xl border border-cyan-800/80 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-700 text-cyan-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono tracking-wider">
                REGISTER SOLDIER
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                MILITARY REGISTRY & SQUAD ASSIGNMENT
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
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
          {/* Soldier 7-digit ID */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-300 tracking-wider">
                7-DIGIT MILITARY ID
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
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Soldier Name */}
          <div>
            <label className="block text-xs text-slate-300 mb-1 tracking-wider">
              FULL NAME
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Ronen Shani"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs text-slate-300 mb-1 tracking-wider">
              OPERATIONAL ROLE
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
            >
              <option value="rifleman">Rifleman</option>
              <option value="sapper">Sapper (EOD Specialist)</option>
              <option value="medic">Field Medic</option>
              <option value="recon">Recon Scout</option>
              <option value="commander">Squad Commander</option>
            </select>
          </div>

          {/* Squad Assignment */}
          <div>
            <label className="block text-xs text-slate-300 mb-1 tracking-wider">
              SQUAD ATTACHMENT (OPTIONAL)
            </label>
            <select
              value={targetSquadId}
              onChange={(e) => setTargetSquadId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
            >
              <option value="">General Registry (Unassigned)</option>
              {availableSquads.map((sq) => (
                <option key={sq.id} value={sq.id}>
                  {sq.name} [{sq.role}]
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-bold text-xs shadow-lg transition-all cursor-pointer"
            >
              {isLoading ? 'REGISTERING...' : 'REGISTER SOLDIER'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
