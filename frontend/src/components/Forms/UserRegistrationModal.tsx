import React, { useState, useEffect } from 'react'
import {
  X,
  UserPlus,
  Shield,
  Radio,
  Building2,
  Users,
  Key,
  CheckCircle,
  AlertCircle,
  Compass,
} from 'lucide-react'
import { api } from '../../services/api'
import { useMapStore } from '../../store/useMapStore'
import type { Soldier, Area } from '../../types'

export type RegistrationTab = 'soldier' | 'force' | 'user'
export type ForceTypeOption = 'Administrator' | 'Regional HQ' | 'Radar' | 'Field Force'
export type UserTypeOption = 'Field Team' | 'Radar' | 'Regional HQ' | 'Administrator'
export type SoldierRoleOption = 'EOD' | 'Support/Non-combat' | 'Combat'

interface UserRegistrationModalProps {
  isOpen: boolean
  onClose: () => void
}

export const UserRegistrationModal: React.FC<UserRegistrationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    loadSnapshot,
    registrationModalTab,
    setRegistrationModalTab,
  } = useMapStore()

  // Active Tab
  const [activeTab, setActiveTab] = useState<RegistrationTab>('soldier')

  // Status feedback
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // -------------------------------------------------------------
  // TAB 1: ADD SOLDIER (3 fields: Name, Role [EOD, Support/Non-combat, Combat])
  // -------------------------------------------------------------
  const [soldierName, setSoldierName] = useState('')
  const [soldierRole, setSoldierRole] = useState<SoldierRoleOption>('Combat')

  // -------------------------------------------------------------
  // TAB 2: ADD FORCE (4 options: Administrator, Regional HQ, Radar, Field Force)
  // Each requires: name, description. Regional HQ also requires: area/region.
  // -------------------------------------------------------------
  const [forceType, setForceType] = useState<ForceTypeOption>('Field Force')
  const [forceName, setForceName] = useState('')
  const [forceDescription, setForceDescription] = useState('')
  const [forceRegion, setForceRegion] = useState<Area>('Center')

  // -------------------------------------------------------------
  // TAB 3: ADD USER (Username, Password, User Type)
  // "Field Team" and "Radar" created without soldier link.
  // Others must be linked to a soldier from dropdown (unlinked only).
  // -------------------------------------------------------------
  const [userType, setUserType] = useState<UserTypeOption>('Field Team')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [selectedSoldierId, setSelectedSoldierId] = useState<string>('')
  const [userRegion, setUserRegion] = useState<Area>('Center')

  // Available (Unlinked) Soldiers for Tab 3
  const [unlinkedSoldiers, setUnlinkedSoldiers] = useState<Soldier[]>([])
  const [isLoadingSoldiers, setIsLoadingSoldiers] = useState(false)

  // Sync tab with store when modal opens
  useEffect(() => {
    if (isOpen) {
      if (registrationModalTab) {
        setActiveTab(registrationModalTab)
      }
      setErrorMessage(null)
      setSuccessMessage(null)
      fetchUnlinkedSoldiers()
    }
  }, [isOpen, registrationModalTab])

  // Fetch unlinked soldiers
  const fetchUnlinkedSoldiers = async () => {
    setIsLoadingSoldiers(true)
    try {
      const soldiers = await api.admin.getUnlinkedSoldiers()
      setUnlinkedSoldiers(soldiers || [])
      if (soldiers && soldiers.length > 0 && !selectedSoldierId) {
        setSelectedSoldierId(soldiers[0].id)
      }
    } catch (err) {
      console.error('Failed to load unlinked soldiers:', err)
    } finally {
      setIsLoadingSoldiers(false)
    }
  }

  if (!isOpen) return null

  // Switch tabs handler
  const handleTabChange = (tab: RegistrationTab) => {
    setActiveTab(tab)
    setRegistrationModalTab(tab)
    setErrorMessage(null)
    setSuccessMessage(null)
    if (tab === 'user') {
      fetchUnlinkedSoldiers()
    }
  }

  // -------------------------------------------------------------
  // SUBMIT HANDLERS
  // -------------------------------------------------------------

  // 1. Submit Add Soldier
  const handleSubmitSoldier = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!soldierName.trim()) {
      setErrorMessage('Soldier name is required.')
      return
    }

    setIsLoading(true)
    try {
      const newSoldier = await api.admin.createSoldier({
        name: soldierName.trim(),
        role: soldierRole,
      })

      setSuccessMessage(`Soldier ${newSoldier.name} (${newSoldier.role}) successfully registered!`)
      setSoldierName('')
      setSoldierRole('Combat')
      await loadSnapshot()
      await fetchUnlinkedSoldiers()

      setTimeout(() => {
        setSuccessMessage(null)
      }, 3000)
    } catch (err: unknown) {
      let msg = 'Failed to register soldier.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        msg = axiosErr.response?.data?.error?.message || msg
      }
      setErrorMessage(msg)
    } finally {
      setIsLoading(false)
    }
  }

  // 2. Submit Add Force
  const handleSubmitForce = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!forceName.trim()) {
      setErrorMessage('Force name is required.')
      return
    }
    if (!forceDescription.trim()) {
      setErrorMessage('Force description is required.')
      return
    }

    setIsLoading(true)
    try {
      // Slugify name for credentials
      const slug = forceName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/^_+|_+$/g, '')
      const uniqueSuffix = Math.floor(100 + Math.random() * 900)
      const generatedUsername = `${slug || 'force'}_${uniqueSuffix}`
      const generatedPassword = 'force' + uniqueSuffix

      let backendRole: 'MainCommandCenter' | 'AreaCommandCenter' | 'Radar' | 'Squad' = 'Squad'
      let backendArea: Area = 'Center'
      let defaultLat = 32.0853
      let defaultLon = 34.7818

      if (forceType === 'Administrator') {
        backendRole = 'MainCommandCenter'
        backendArea = 'Global'
        defaultLat = 32.0750
        defaultLon = 34.7920
      } else if (forceType === 'Regional HQ') {
        backendRole = 'AreaCommandCenter'
        backendArea = forceRegion
        if (forceRegion === 'North') {
          defaultLat = 33.0000
          defaultLon = 35.3000
        } else if (forceRegion === 'South') {
          defaultLat = 31.2000
          defaultLon = 34.7000
        } else {
          defaultLat = 32.1000
          defaultLon = 34.8000
        }
      } else if (forceType === 'Radar') {
        backendRole = 'Radar'
        backendArea = 'North'
        defaultLat = 33.1000
        defaultLon = 35.4000
      } else {
        // Field Force
        backendRole = 'Squad'
        backendArea = 'Center'
        defaultLat = 32.0853
        defaultLon = 34.7818
      }

      const payload: Record<string, unknown> = {
        name: forceName.trim(),
        description: forceDescription.trim(),
        username: generatedUsername,
        password: generatedPassword,
        role: backendRole,
        area: backendArea,
        lat: defaultLat,
        lon: defaultLon,
      }

      // If command center requires a soldier in the existing backend, attach first available or mock
      if (backendRole === 'MainCommandCenter' || backendRole === 'AreaCommandCenter') {
        if (unlinkedSoldiers.length > 0) {
          payload.soldier_id = unlinkedSoldiers[0].id
        }
      }

      await api.admin.createUser(payload)

      setSuccessMessage(`Force '${forceName}' (${forceType}) successfully added!`)
      setForceName('')
      setForceDescription('')
      await loadSnapshot()

      setTimeout(() => {
        setSuccessMessage(null)
      }, 3000)
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

  // 3. Submit Add User
  const handleSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!username.trim() || username.trim().length < 3) {
      setErrorMessage('Username must be at least 3 characters long.')
      return
    }
    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.')
      return
    }

    const requiresSoldier = userType !== 'Field Team' && userType !== 'Radar'

    if (requiresSoldier && !selectedSoldierId) {
      setErrorMessage('This user type must be linked to a soldier selected from the dropdown list.')
      return
    }

    setIsLoading(true)
    try {
      let backendRole: 'MainCommandCenter' | 'AreaCommandCenter' | 'Radar' | 'Squad' = 'Squad'
      let backendArea: Area = 'Center'
      let displayName = username.trim()
      let defaultLat = 32.0853
      let defaultLon = 34.7818

      const linkedSoldier = unlinkedSoldiers.find((s) => s.id === selectedSoldierId)

      if (userType === 'Administrator') {
        backendRole = 'MainCommandCenter'
        backendArea = 'Global'
        displayName = linkedSoldier ? `${linkedSoldier.name} (Admin)` : username.trim()
        defaultLat = 32.0750
        defaultLon = 34.7920
      } else if (userType === 'Regional HQ') {
        backendRole = 'AreaCommandCenter'
        backendArea = userRegion
        displayName = linkedSoldier ? `${linkedSoldier.name} (${userRegion} HQ)` : username.trim()
        if (userRegion === 'North') {
          defaultLat = 33.0000
          defaultLon = 35.3000
        } else if (userRegion === 'South') {
          defaultLat = 31.2000
          defaultLon = 34.7000
        } else {
          defaultLat = 32.1000
          defaultLon = 34.8000
        }
      } else if (userType === 'Radar') {
        backendRole = 'Radar'
        backendArea = 'North'
        displayName = `Radar Station - ${username.trim()}`
        defaultLat = 33.1000
        defaultLon = 35.4000
      } else {
        // Field Team
        backendRole = 'Squad'
        backendArea = 'Center'
        displayName = `Field Team - ${username.trim()}`
        defaultLat = 32.0853
        defaultLon = 34.7818
      }

      const payload: Record<string, unknown> = {
        username: username.trim(),
        password,
        role: backendRole,
        area: backendArea,
        name: displayName,
        description: `Operational account for ${userType}`,
        lat: defaultLat,
        lon: defaultLon,
      }

      // Only link soldier if not Field Team or Radar
      if (requiresSoldier && selectedSoldierId) {
        payload.soldier_id = selectedSoldierId
      }

      await api.admin.createUser(payload)

      setSuccessMessage(`User account '${username.trim()}' (${userType}) successfully created!`)
      setUsername('')
      setPassword('')
      setSelectedSoldierId('')
      await loadSnapshot()
      await fetchUnlinkedSoldiers()

      setTimeout(() => {
        setSuccessMessage(null)
      }, 3000)
    } catch (err: unknown) {
      let msg = 'Failed to create user.'
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
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl hud-panel rounded-xl border border-cyan-500/70 shadow-2xl p-6 overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-500/60 text-cyan-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono tracking-wider">
                REGISTRATION PANEL
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                MILITARY REGISTRY, FORCES & USER ACCESS
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

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 mt-3 shrink-0">
          <button
            type="button"
            onClick={() => handleTabChange('soldier')}
            className={`flex-1 py-2.5 text-xs font-mono font-bold flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'soldier'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/40'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>ADD SOLDIER</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('force')}
            className={`flex-1 py-2.5 text-xs font-mono font-bold flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'force'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/40'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>ADD FORCE</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('user')}
            className={`flex-1 py-2.5 text-xs font-mono font-bold flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'user'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/40'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>ADD USER</span>
          </button>
        </div>

        {/* Status Alerts */}
        {errorMessage && (
          <div className="mt-3 p-3 rounded-lg bg-red-950/80 border border-red-700 text-red-200 text-xs font-mono flex items-start gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-950/80 border border-emerald-600 text-emerald-200 text-xs font-mono flex items-center gap-2 shrink-0">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Tab Contents */}
        <div className="mt-4 overflow-y-auto pr-1 flex-1 font-mono">
          {/* ========================================================= */}
          {/* TAB 1: ADD SOLDIER (3 Fields: Name, Role [EOD, Support/Non-combat, Combat]) */}
          {/* ========================================================= */}
          {activeTab === 'soldier' && (
            <form onSubmit={handleSubmitSoldier} className="space-y-4">
              <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] text-slate-400">
                Register a new military personnel into the central defense registry.
              </div>

              {/* Field 1: Name */}
              <div>
                <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
                  1. Soldier Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. David Cohen"
                  value={soldierName}
                  onChange={(e) => setSoldierName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Field 2 & 3: Role (EOD, Support/Non-combat, Combat) */}
              <div>
                <label className="block text-xs text-slate-300 mb-2 tracking-wider uppercase font-semibold">
                  2. Operational Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['EOD', 'Support/Non-combat', 'Combat'] as SoldierRoleOption[]).map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => setSoldierRole(r)}
                      className={`py-3 px-2 rounded-lg text-xs font-mono font-bold text-center border transition-all cursor-pointer ${
                        soldierRole === r
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(0,229,255,0.25)]'
                          : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      <div className="text-[11px] leading-tight">{r}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-slate-400">
                  Selected Role: <span className="text-cyan-300 font-bold">{soldierRole}</span>
                </p>
              </div>

              <div className="pt-4 flex justify-end gap-2 border-t border-slate-800">
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
          )}

          {/* ========================================================= */}
          {/* TAB 2: ADD FORCE (4 options: Administrator, Regional HQ, Radar, Field Force) */}
          {/* Each requires: name, description. Regional HQ also requires: area/region. */}
          {/* ========================================================= */}
          {activeTab === 'force' && (
            <form onSubmit={handleSubmitForce} className="space-y-4">
              {/* Force Option Selector */}
              <div>
                <label className="block text-xs text-slate-300 mb-1.5 tracking-wider uppercase font-semibold">
                  Select Force Type (4 Options)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['Administrator', 'Regional HQ', 'Radar', 'Field Force'] as ForceTypeOption[]).map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => setForceType(t)}
                      className={`py-2 px-2 rounded-lg text-xs font-mono font-bold text-center border transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                        forceType === t
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(0,229,255,0.25)]'
                          : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {t === 'Administrator' && <Building2 className="w-4 h-4" />}
                      {t === 'Regional HQ' && <Compass className="w-4 h-4" />}
                      {t === 'Radar' && <Radio className="w-4 h-4" />}
                      {t === 'Field Force' && <Users className="w-4 h-4" />}
                      <span className="text-[11px] leading-tight">{t}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Force Name */}
              <div>
                <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
                  Force Name
                </label>
                <input
                  type="text"
                  required
                  placeholder={
                    forceType === 'Administrator'
                      ? 'e.g. Central Command Authority'
                      : forceType === 'Regional HQ'
                      ? 'e.g. Northern Regional Command'
                      : forceType === 'Radar'
                      ? 'e.g. Hermon Radar Post 01'
                      : 'e.g. Golani Bravo Patrol'
                  }
                  value={forceName}
                  onChange={(e) => setForceName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Force Description */}
              <div>
                <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
                  Force Description
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Operational responsibility, operational sector, and assigned capabilities"
                  value={forceDescription}
                  onChange={(e) => setForceDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none resize-none"
                />
              </div>

              {/* Regional HQ: Area/Region Requirement */}
              {forceType === 'Regional HQ' && (
                <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-700/70 space-y-2">
                  <label className="block text-xs text-indigo-300 tracking-wider uppercase font-semibold flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5" />
                    <span>Assigned Operational Area / Region (Required for Regional HQ)</span>
                  </label>
                  <select
                    value={forceRegion}
                    onChange={(e) => setForceRegion(e.target.value as Area)}
                    className="w-full px-3 py-2 bg-slate-900 border border-indigo-600 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
                  >
                    <option value="North">North (Lat ≥ 32.70 — Safed / Upper Galilee)</option>
                    <option value="Center">Center (31.90 ≤ Lat &lt; 32.70 — Tel Aviv / Kirya)</option>
                    <option value="South">South (Lat &lt; 31.90 — Beer Sheva / Negev)</option>
                  </select>
                </div>
              )}

              <div className="pt-4 flex justify-end gap-2 border-t border-slate-800">
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
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{isLoading ? 'CREATING...' : 'ADD FORCE'}</span>
                </button>
              </div>
            </form>
          )}

          {/* ========================================================= */}
          {/* TAB 3: ADD USER (Username, Password) */}
          {/* "Field Team" and "Radar": Created without linking to soldier. */}
          {/* Other types: Must be linked to a soldier from dropdown (unlinked only). */}
          {/* ========================================================= */}
          {activeTab === 'user' && (
            <form onSubmit={handleSubmitUser} className="space-y-4">
              {/* User Type */}
              <div>
                <label className="block text-xs text-slate-300 mb-1.5 tracking-wider uppercase font-semibold">
                  User Type / Role
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['Field Team', 'Radar', 'Regional HQ', 'Administrator'] as UserTypeOption[]).map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => setUserType(t)}
                      className={`py-2 px-2 rounded-lg text-xs font-mono font-bold text-center border transition-all cursor-pointer ${
                        userType === t
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-400 shadow-[0_0_10px_rgba(0,229,255,0.25)]'
                          : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      <div className="text-[11px] leading-tight">{t}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Username & Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. operator_alpha"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Regional HQ: Region Selector */}
              {userType === 'Regional HQ' && (
                <div>
                  <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
                    Operational Region
                  </label>
                  <select
                    value={userRegion}
                    onChange={(e) => setUserRegion(e.target.value as Area)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
                  >
                    <option value="North">North Sector</option>
                    <option value="Center">Center Sector</option>
                    <option value="South">South Sector</option>
                  </select>
                </div>
              )}

              {/* Soldier Linking Rule Section */}
              {userType === 'Field Team' || userType === 'Radar' ? (
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-700/60 text-emerald-300 text-xs flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Autonomous Force Account: </span>
                    "{userType}" users are created without being linked to a specific soldier.
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-700/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs text-indigo-300 tracking-wider uppercase font-semibold flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      <span>Link to Soldier (Mandatory for {userType})</span>
                    </label>
                    <span className="text-[10px] text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                      {unlinkedSoldiers.length} Unlinked Available
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Select an unlinked soldier from the registry. Already linked soldiers do not appear:
                  </p>

                  {isLoadingSoldiers ? (
                    <div className="p-2 text-xs text-slate-400 animate-pulse">Loading unlinked soldiers...</div>
                  ) : unlinkedSoldiers.length === 0 ? (
                    <div className="p-2.5 rounded bg-amber-950/40 border border-amber-700/70 text-amber-200 text-xs">
                      No unlinked soldiers are currently available. Please register a new soldier in the "Add Soldier" tab first.
                    </div>
                  ) : (
                    <select
                      required
                      value={selectedSoldierId}
                      onChange={(e) => setSelectedSoldierId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-indigo-500 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
                    >
                      <option value="">-- Choose unlinked soldier --</option>
                      {unlinkedSoldiers.map((soldier) => (
                        <option key={soldier.id} value={soldier.id}>
                          {soldier.name} [ID: {soldier.id}] — Role: {soldier.role}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="pt-4 flex justify-end gap-2 border-t border-slate-800">
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
                  <Key className="w-3.5 h-3.5" />
                  <span>{isLoading ? 'CREATING...' : 'ADD USER'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
