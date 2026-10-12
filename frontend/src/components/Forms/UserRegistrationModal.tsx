import React, { useState } from 'react'
import {
  X,
  UserPlus,
  Shield,
  MapPin,
  Users,
  Plus,
  Trash2,
  CheckCircle,
} from 'lucide-react'
import { api } from '../../services/api'
import { useMapStore } from '../../store/useMapStore'
import type { UserRole, Area } from '../../types'

interface SoldierInput {
  id: string
  name: string
  role: string
}

interface UserRegistrationModalProps {
  isOpen: boolean
  onClose: () => void
}

const REGIONAL_HQ_PRESETS = [
  {
    name: 'Northern Command Center',
    username: 'command_north',
    area: 'North' as Area,
    lat: '33.0000',
    lon: '35.3000',
    description: 'Regional HQ Northern Sector (Safed / Upper Galilee)',
  },
  {
    name: 'Central Command Center',
    username: 'command_center',
    area: 'Center' as Area,
    lat: '32.1000',
    lon: '34.8000',
    description: 'Regional HQ Central Sector (Tel Aviv / Kirya Command)',
  },
  {
    name: 'Southern Command Center',
    username: 'command_south',
    area: 'South' as Area,
    lat: '31.2000',
    lon: '34.7000',
    description: 'Regional HQ Southern Sector (Beer Sheva Command)',
  },
]

export const UserRegistrationModal: React.FC<UserRegistrationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { loadSnapshot } = useMapStore()

  const [role, setRole] = useState<UserRole>('AreaCommandCenter')
  const [name, setName] = useState('Northern Command Center')
  const [username, setUsername] = useState('command_north')
  const [password, setPassword] = useState('command123')
  const [area, setArea] = useState<Area>('North')
  const [lat, setLat] = useState('33.0000')
  const [lon, setLon] = useState('35.3000')
  const [description, setDescription] = useState('Regional HQ Northern Sector')
  const [soldiers, setSoldiers] = useState<SoldierInput[]>([])
  const [commanderSoldierId, setCommanderSoldierId] = useState('2000002')
  const [commanderSoldierName, setCommanderSoldierName] = useState('Maj. Dan Alon')
  const [commanderSoldierRole, setCommanderSoldierRole] = useState('commander')

  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Reactively update username when name/HQ changes
  const handleNameChange = (newName: string) => {
    setName(newName)

    if (role === 'AreaCommandCenter') {
      const lower = newName.toLowerCase()
      if (lower.includes('north') || lower.includes('צפון')) {
        setUsername('command_north')
        setArea('North')
        setLat('33.0000')
        setLon('35.3000')
        setCommanderSoldierId('2000002')
        setCommanderSoldierName('Maj. Dan Alon')
      } else if (lower.includes('center') || lower.includes('central') || lower.includes('מרכז')) {
        setUsername('command_center')
        setArea('Center')
        setLat('32.1000')
        setLon('34.8000')
        setCommanderSoldierId('2000003')
        setCommanderSoldierName('Col. Ronen Bar')
      } else if (lower.includes('south') || lower.includes('דרום')) {
        setUsername('command_south')
        setArea('South')
        setLat('31.2000')
        setLon('34.7000')
        setCommanderSoldierId('2000004')
        setCommanderSoldierName('Lt. Col. Avi Cohen')
      } else {
        const slug = newName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '_')
          .replace(/^_+|_+$/g, '')
        setUsername(`command_${slug || 'regional'}`)
      }
    } else {
      const slug = newName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/^_+|_+$/g, '')
      if (role === 'Squad' || role === 'SapperSquad') {
        setUsername(`squad_${slug || 'unit'}`)
      } else if (role === 'Radar') {
        setUsername(`radar_${slug || 'post'}`)
      }
    }
  }

  // Handle preset HQ selection
  const handleSelectHQPreset = (preset: (typeof REGIONAL_HQ_PRESETS)[number]) => {
    setName(preset.name)
    setUsername(preset.username)
    setArea(preset.area)
    setLat(preset.lat)
    setLon(preset.lon)
    setDescription(preset.description)
    if (preset.area === 'North') {
      setCommanderSoldierId('2000002')
      setCommanderSoldierName('Maj. Dan Alon')
    } else if (preset.area === 'Center') {
      setCommanderSoldierId('2000003')
      setCommanderSoldierName('Col. Ronen Bar')
    } else if (preset.area === 'South') {
      setCommanderSoldierId('2000004')
      setCommanderSoldierName('Lt. Col. Avi Cohen')
    }
  }

  // Role changes
  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole)
    if (newRole === 'AreaCommandCenter') {
      handleSelectHQPreset(REGIONAL_HQ_PRESETS[0])
    } else if (newRole === 'Squad') {
      setName('Golani Bravo Patrol')
      setUsername('squad_golani_bravo')
      setPassword('squad123')
      setLat('32.0850')
      setLon('34.7820')
      setDescription('Tactical assault reconnaissance team')
      setSoldiers([
        { id: '3000001', name: 'Itamar Ron', role: 'rifleman' },
        { id: '3000002', name: 'Ori Golan', role: 'medic' },
      ])
    } else if (newRole === 'SapperSquad') {
      setName('Combat Engineering EOD Unit')
      setUsername('squad_eod_special')
      setPassword('squad123')
      setLat('32.0910')
      setLon('34.7880')
      setDescription('Explosive ordnance neutralization squad')
      setSoldiers([
        { id: '3000003', name: 'Gil Shavit', role: 'sapper' },
        { id: '3000004', name: 'Erez Tal', role: 'sapper' },
      ])
    } else if (newRole === 'Radar') {
      setName('Galilee Surveillance Radar 2')
      setUsername('radar_galilee_2')
      setPassword('radar123')
      setLat('33.1000')
      setLon('35.4000')
      setDescription('Northern airspace and UAV monitoring radar post')
      setSoldiers([])
    } else if (newRole === 'MainCommandCenter') {
      setName('General Staff Command Center')
      setUsername('hq_supreme_2')
      setPassword('admin123')
      setArea('Global')
      setLat('32.0750')
      setLon('34.7920')
      setDescription('Supreme Tactical Operations Headquarters')
      setSoldiers([])
      setCommanderSoldierId('1000002')
      setCommanderSoldierName('Brig. Gen. Yair Golan')
      setCommanderSoldierRole('commander')
    }
  }

  const handleAddSoldier = () => {
    const nextId = (Math.floor(1000000 + Math.random() * 9000000)).toString()
    setSoldiers([...soldiers, { id: nextId, name: '', role: 'rifleman' }])
  }

  const handleRemoveSoldier = (index: number) => {
    setSoldiers(soldiers.filter((_, idx) => idx !== index))
  }

  const handleUpdateSoldier = (index: number, field: keyof SoldierInput, val: string) => {
    const updated = [...soldiers]
    updated[index] = { ...updated[index], [field]: val }
    setSoldiers(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsLoading(true)

    try {
      const parsedLat = parseFloat(lat)
      const parsedLon = parseFloat(lon)

      if (isNaN(parsedLat) || isNaN(parsedLon)) {
        setErrorMessage('Coordinates must be valid numbers.')
        setIsLoading(false)
        return
      }

      // 1. Manager / Regional HQ requires assigning a soldier
      let assignedSoldierId: string | undefined = undefined
      if (role === 'MainCommandCenter' || role === 'AreaCommandCenter') {
        if (!commanderSoldierId || !/^\d{7}$/.test(commanderSoldierId)) {
          setErrorMessage('Assigning a soldier with a valid 7-digit military ID is required for command headquarters.')
          setIsLoading(false)
          return
        }
        if (!commanderSoldierName.trim()) {
          setErrorMessage('Officer / soldier name is required.')
          setIsLoading(false)
          return
        }

        // Ensure soldier is registered in soldiers table first
        try {
          await api.admin.createSoldier({
            id: commanderSoldierId,
            name: commanderSoldierName.trim(),
            role: commanderSoldierRole || 'commander',
          })
        } catch (soldierErr: unknown) {
          // If 409 conflict, soldier is already in registry which is fine
          const axiosErr = soldierErr as { response?: { status?: number } }
          if (axiosErr.response?.status !== 409) {
            throw soldierErr
          }
        }
        assignedSoldierId = commanderSoldierId
      }

      // 2. Creating a team requires adding multiple soldiers (>= 2)
      if (role === 'Squad' || role === 'SapperSquad') {
        if (soldiers.length < 2) {
          setErrorMessage('Creating a tactical team requires adding multiple soldiers (minimum 2 soldiers).')
          setIsLoading(false)
          return
        }
        for (const s of soldiers) {
          if (!s.name.trim() || s.id.length !== 7 || !/^\d{7}$/.test(s.id)) {
            setErrorMessage(`Soldier '${s.name || 'unnamed'}' requires a name and exactly 7-digit ID.`)
            setIsLoading(false)
            return
          }
        }
      }

      const payload: Record<string, unknown> = {
        username,
        password,
        role,
        area: role === 'MainCommandCenter' ? 'Global' : area,
        name,
        description,
        lat: parsedLat,
        lon: parsedLon,
        soldiers: soldiers.map((s) => ({ id: s.id, name: s.name, role: s.role })),
      }

      if (assignedSoldierId) {
        payload.soldier_id = assignedSoldierId
      }

      await api.admin.createUser(payload)

      setSuccessMessage(`Force '${name}' (${username}) successfully registered!`)
      await loadSnapshot()

      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err: unknown) {
      let msg = 'Failed to register force.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        msg = axiosErr.response?.data?.error?.message || msg
      }
      setErrorMessage(msg)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl hud-panel rounded-xl border border-cyan-500/60 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-cyan-950 border border-cyan-500/60 text-cyan-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono tracking-wider flex items-center gap-2">
                FORCE &amp; HEADQUARTERS REGISTRATION
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                REGISTER REGIONAL COMMAND HEADQUARTERS OR TACTICAL FORCES
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="mt-3 p-3 rounded-lg bg-red-950/80 border border-red-700 text-red-200 text-xs font-mono shrink-0">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-950/80 border border-emerald-600 text-emerald-200 text-xs font-mono flex items-center gap-2 shrink-0">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 overflow-y-auto pr-1 flex-1">
          {/* Role / Force Type Selection */}
          <div>
            <label className="block text-xs font-mono text-cyan-400 mb-1.5 font-bold uppercase tracking-wider">
              Force Type / Operational Role
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { r: 'AreaCommandCenter' as UserRole, label: 'Regional HQ', color: 'border-purple-500' },
                { r: 'Squad' as UserRole, label: 'Tactical Squad', color: 'border-emerald-500' },
                { r: 'SapperSquad' as UserRole, label: 'EOD Sapper Squad', color: 'border-amber-500' },
                { r: 'Radar' as UserRole, label: 'Radar Post', color: 'border-cyan-500' },
                { r: 'MainCommandCenter' as UserRole, label: 'Supreme Command', color: 'border-indigo-500' },
              ].map(({ r, label }) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => handleRoleChange(r)}
                  className={`py-2 px-3 rounded-lg text-xs font-mono font-semibold text-center border transition-all cursor-pointer ${
                    role === r
                      ? 'bg-cyan-950/90 text-white border-cyan-400 shadow-[0_0_10px_rgba(0,229,255,0.3)]'
                      : 'bg-slate-900/60 hover:bg-slate-850 text-slate-300 border-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Regional HQ Quick Preset Selector */}
          {role === 'AreaCommandCenter' && (
            <div className="p-3 rounded-lg bg-purple-950/40 border border-purple-800/80 space-y-2">
              <span className="text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                REGIONAL COMMAND HEADQUARTERS PRESET:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {REGIONAL_HQ_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.username}
                    onClick={() => handleSelectHQPreset(p)}
                    className={`p-2 rounded border text-left text-[11px] font-mono transition-all cursor-pointer ${
                      username === p.username
                        ? 'bg-purple-900/90 border-purple-400 text-white font-bold'
                        : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="text-white font-semibold">{p.name}</div>
                    <div className="text-[10px] text-purple-300">Call-sign: {p.username}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Force Name & Auto-updating Username */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase">
                Specific Force / HQ Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Northern Command Center"
                className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase">
                Call-sign / Username (Auto-Updated)
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. command_north"
                className="w-full px-3 py-2 bg-slate-950/80 border border-slate-700 rounded-lg text-cyan-300 font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Password & Sector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase">
                Access Key / Password
              </label>
              <input
                type="text"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase">
                Operational Sector
              </label>
              <select
                value={area}
                onChange={(e) => setArea(e.target.value as Area)}
                className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="North">North (Lat ≥ 32.70)</option>
                <option value="Center">Center (31.90 ≤ Lat &lt; 32.70)</option>
                <option value="South">South (Lat &lt; 31.90)</option>
                {role === 'MainCommandCenter' && <option value="Global">Global (All Sectors)</option>}
              </select>
            </div>
          </div>

          {/* Coordinates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                Latitude
              </label>
              <input
                type="text"
                required
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="32.0853"
                className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                Longitude
              </label>
              <input
                type="text"
                required
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                placeholder="34.7818"
                className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-mono text-slate-300 mb-1 tracking-wider uppercase">
              Operational Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Operational sector assignment and unit capability"
              className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Appointed Commanding Officer (Soldier Assignment - Required for HQ / Manager) */}
          {(role === 'MainCommandCenter' || role === 'AreaCommandCenter') && (
            <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-mono font-bold text-white tracking-wider">
                    APPOINTED COMMANDING OFFICER (SOLDIER ASSIGNMENT - REQUIRED)
                  </span>
                </div>
                <span className="text-[10px] text-indigo-300 font-mono font-semibold px-2 py-0.5 rounded bg-indigo-900/60 border border-indigo-600">
                  MANDATORY
                </span>
              </div>
              <p className="text-[11px] text-slate-300 font-mono">
                Command headquarters must be commanded by an appointed soldier with a verified 7-digit military ID.
              </p>
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <label className="block text-[10px] font-mono text-indigo-300 mb-1 uppercase">
                    Soldier Military ID (7 Digits)
                  </label>
                  <input
                    type="text"
                    required
                    value={commanderSoldierId}
                    onChange={(e) => setCommanderSoldierId(e.target.value)}
                    placeholder="7-digit ID"
                    maxLength={7}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-indigo-800 rounded text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="col-span-5">
                  <label className="block text-[10px] font-mono text-indigo-300 mb-1 uppercase">
                    Officer Full Name &amp; Rank
                  </label>
                  <input
                    type="text"
                    required
                    value={commanderSoldierName}
                    onChange={(e) => setCommanderSoldierName(e.target.value)}
                    placeholder="e.g. Maj. Dan Alon"
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-indigo-800 rounded text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-[10px] font-mono text-indigo-300 mb-1 uppercase">
                    Designation Role
                  </label>
                  <select
                    value={commanderSoldierRole}
                    onChange={(e) => setCommanderSoldierRole(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-indigo-800 rounded text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-400 cursor-pointer"
                  >
                    <option value="commander">Commander</option>
                    <option value="rifleman">Rifleman</option>
                    <option value="sapper">Sapper</option>
                    <option value="medic">Medic</option>
                    <option value="recon">Recon</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Soldier Roster Builder for Field Combat Squads */}
          {(role === 'Squad' || role === 'SapperSquad') && (
            <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-white tracking-wider">
                    ATTACHED SOLDIER ROSTER ({soldiers.length})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleAddSoldier}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>ADD SOLDIER</span>
                </button>
              </div>

              {soldiers.map((s, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3">
                    <input
                      type="text"
                      required
                      value={s.id}
                      onChange={(e) => handleUpdateSoldier(idx, 'id', e.target.value)}
                      placeholder="7-digit ID"
                      maxLength={7}
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="col-span-5">
                    <input
                      type="text"
                      required
                      value={s.name}
                      onChange={(e) => handleUpdateSoldier(idx, 'name', e.target.value)}
                      placeholder="Soldier Name"
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="col-span-3">
                    <select
                      value={s.role}
                      onChange={(e) => handleUpdateSoldier(idx, 'role', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500 cursor-pointer"
                    >
                      <option value="rifleman">Rifleman</option>
                      <option value="sapper">Sapper</option>
                      <option value="medic">Medic</option>
                      <option value="recon">Recon</option>
                    </select>
                  </div>
                  <div className="col-span-1 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveSoldier(idx)}
                      className="p-1 text-slate-500 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Submit Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold tracking-wider shadow-lg shadow-cyan-900/40 border border-cyan-400/50 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? 'REGISTERING...' : 'REGISTER FORCE'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
