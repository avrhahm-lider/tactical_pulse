import React, { useState, useEffect, useCallback } from 'react'
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
import { useAuthStore } from '../../store/useAuthStore'
import type { Soldier, Area, Squad } from '../../types'

export type RegistrationTab = 'soldier' | 'force' | 'user'
export type ForceTypeOption = 'Administrator' | 'Regional HQ' | 'Radar' | 'Field Force'
export type UserTypeOption = 'Field Team' | 'Radar' | 'Regional HQ' | 'Administrator'
export type SoldierRoleOption = 'EOD' | 'Support/Non-combat' | 'Combat'

interface UserRegistrationModalProps {
  isOpen: boolean
  onClose: () => void
}

interface CustomForce {
  id: string
  name: string
  description: string
  type: ForceTypeOption
  area: Area
  lat?: number
  lon?: number
}

const LOCAL_STORAGE_CUSTOM_FORCES_KEY = 'tactical_custom_forces'

export const UserRegistrationModal: React.FC<UserRegistrationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    squads,
    loadSnapshot,
    registrationModalTab,
    setRegistrationModalTab,
  } = useMapStore()
  const { user } = useAuthStore()

  // Active Tab
  const [activeTab, setActiveTab] = useState<RegistrationTab>('soldier')

  // Feedback states
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // -------------------------------------------------------------
  // TAB 1: ADD SOLDIER (7-digit ID, Name, Role [EOD, Support/Non-combat, Combat])
  // -------------------------------------------------------------
  const [soldierId, setSoldierId] = useState('')
  const [soldierName, setSoldierName] = useState('')
  const [soldierRole, setSoldierRole] = useState<SoldierRoleOption>('Combat')

  // -------------------------------------------------------------
  // TAB 2: ADD FORCE (Administrator, Regional HQ, Radar, Field Force)
  // Name, Description. Regional HQ also requires Area/Region.
  // -------------------------------------------------------------
  const [forceType, setForceType] = useState<ForceTypeOption>('Field Force')
  const [forceName, setForceName] = useState('')
  const [forceDescription, setForceDescription] = useState('')
  const [forceRegion, setForceRegion] = useState<Area>('Center')

  // -------------------------------------------------------------
  // TAB 3: ADD USER (Username, Password, User Type)
  // Field Team: select specific team from existing ones (cannot re-link assigned ones)
  // Regional HQ: select linked soldier AND assigned regional HQ (no region dropdown)
  // Radar: unlinked
  // Administrator: linked to soldier
  // -------------------------------------------------------------
  const [userType, setUserType] = useState<UserTypeOption>('Field Team')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [selectedSoldierId, setSelectedSoldierId] = useState<string>('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [selectedRegionalHQId, setSelectedRegionalHQId] = useState<string>('')

  // Registry data
  const [unlinkedSoldiers, setUnlinkedSoldiers] = useState<Soldier[]>([])
  const [existingUsers, setExistingUsers] = useState<any[]>([])
  const [isLoadingSoldiers, setIsLoadingSoldiers] = useState(false)
  const [customForces, setCustomForces] = useState<CustomForce[]>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_CUSTOM_FORCES_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  const [prevRegTab, setPrevRegTab] = useState(registrationModalTab)
  if (registrationModalTab !== prevRegTab) {
    setPrevRegTab(registrationModalTab)
    if (registrationModalTab) {
      setActiveTab(registrationModalTab)
    }
  }

  const fetchRegistryData = useCallback(async () => {
    await Promise.resolve()
    setIsLoadingSoldiers(true)
    try {
      const [soldiers, users] = await Promise.all([
        api.admin.getUnlinkedSoldiers().catch(() => []),
        api.admin.getUsers().catch(() => []),
      ])
      setUnlinkedSoldiers(soldiers || [])
      setExistingUsers(users || [])
      if (soldiers && soldiers.length > 0) {
        setSelectedSoldierId((prev) => prev || soldiers[0].id)
      }
    } catch (err) {
      console.error('Failed to load registry data:', err)
    } finally {
      setIsLoadingSoldiers(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      void fetchRegistryData()
    }
  }, [isOpen, fetchRegistryData])

  // Generate 7-digit ID helper
  const handleGenerateSoldierId = () => {
    const randomId = Math.floor(1000000 + Math.random() * 9000000).toString()
    setSoldierId(randomId)
  }

  // Switch tabs
  const handleTabChange = (tab: RegistrationTab) => {
    setActiveTab(tab)
    setRegistrationModalTab(tab)
    setErrorMessage(null)
    setSuccessMessage(null)
    if (tab === 'user') {
      fetchRegistryData()
    }
  }

  // -------------------------------------------------------------
  // COMPUTED LISTS FOR TAB 3
  // -------------------------------------------------------------

  // Memoized available teams without an assigned user account
  const availableTeams = React.useMemo(() => {
    const assignedTeamNames = new Set(
      existingUsers
        .filter((u) => u.role === 'Squad' || u.role === 'SapperSquad')
        .map((u) => u.name.trim().toLowerCase())
    )
    const assignedUserIds = new Set(
      existingUsers
        .filter((u) => u.role === 'Squad' || u.role === 'SapperSquad')
        .map((u) => u.id)
    )

    const standardFieldUnits = [
      { id: 'unit_golani', name: 'Golani Recon Squad', description: 'Elite forward reconnaissance patrol' },
      { id: 'unit_paratroopers', name: 'Paratroopers Sapper Squad', description: 'Combat engineering & EOD assault unit' },
      { id: 'unit_givati', name: 'Givati Infantry Patrol', description: 'Southern theater reconnaissance force' },
      { id: 'unit_maglan', name: 'Maglan Commando Team', description: 'Long-range special reconnaissance' },
      { id: 'unit_yahalom', name: 'Yahalom EOD Assault Unit', description: 'Special engineering and counter-explosives' },
      { id: 'unit_egoz', name: 'Egoz Special Recon', description: 'Northern sector counter-guerrilla force' },
      { id: 'unit_duvdevan', name: 'Duvdevan Tactical Team', description: 'Urban counter-terror tactical unit' },
      { id: 'unit_shaldag', name: 'Shaldag Forward Unit', description: 'Special operations forward air controller unit' },
      { id: 'unit_caracal', name: 'Caracal Border Patrol', description: 'Southern border reconnaissance battalion' },
      { id: 'unit_nahal', name: 'Nahal Infantry Squad', description: 'Quick reaction infantry detachment' },
    ]

    const teams: { id: string; name: string; description?: string }[] = []
    const seen = new Set<string>()

    standardFieldUnits.forEach((u) => {
      seen.add(u.name.toLowerCase())
      teams.push(u)
    })

    Object.values(squads).forEach((sq: Squad) => {
      if ((sq.role === 'Squad' || sq.role === 'SapperSquad') && !seen.has(sq.name.toLowerCase())) {
        seen.add(sq.name.toLowerCase())
        teams.push({ id: sq.id, name: sq.name, description: sq.description })
      }
    })

    customForces.forEach((cf) => {
      if (cf.type === 'Field Force' && !seen.has(cf.name.toLowerCase())) {
        seen.add(cf.name.toLowerCase())
        teams.push({ id: cf.id, name: cf.name, description: cf.description })
      }
    })

    return teams.filter(
      (t) => !assignedTeamNames.has(t.name.toLowerCase()) && !assignedUserIds.has(t.id)
    )
  }, [existingUsers, squads, customForces])

  // Memoized Regional Headquarters
  const allRegionalHQs = React.useMemo(() => {
    const list: { id: string; name: string; area: Area }[] = [
      { id: 'hq_north', name: 'Northern Command Center', area: 'North' },
      { id: 'hq_center', name: 'Central Command Center', area: 'Center' },
      { id: 'hq_south', name: 'Southern Command Center', area: 'South' },
    ]
    const seen = new Set(list.map((h) => h.name.toLowerCase()))

    customForces.forEach((cf) => {
      if (cf.type === 'Regional HQ' && !seen.has(cf.name.toLowerCase())) {
        seen.add(cf.name.toLowerCase())
        list.push({ id: cf.id, name: cf.name, area: cf.area })
      }
    })

    Object.values(squads).forEach((sq: Squad) => {
      if (sq.role === 'AreaCommandCenter' && !seen.has(sq.name.toLowerCase())) {
        seen.add(sq.name.toLowerCase())
        list.push({ id: sq.id, name: sq.name, area: sq.area })
      }
    })

    return list
  }, [customForces, squads])

  const effectiveTeamId =
    selectedTeamId && availableTeams.some((t) => t.id === selectedTeamId)
      ? selectedTeamId
      : availableTeams[0]?.id || ''

  const effectiveRegionalHQId = selectedRegionalHQId || allRegionalHQs[0]?.id || ''

  // -------------------------------------------------------------
  // SUBMISSION LOGIC
  // -------------------------------------------------------------

  // 1. Submit Add Soldier
  const handleSubmitSoldier = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!soldierId || soldierId.length !== 7 || !/^\d{7}$/.test(soldierId)) {
      setErrorMessage('Soldier ID must be exactly 7 digits.')
      return
    }

    if (!soldierName.trim()) {
      setErrorMessage('Soldier name is required.')
      return
    }

    setIsLoading(true)
    try {
      const newSoldier = await api.admin.createSoldier({
        id: soldierId.trim(),
        name: soldierName.trim(),
        role: soldierRole,
      })

      setSuccessMessage(`Soldier ${newSoldier.name} (ID: ${newSoldier.id}) successfully registered!`)
      setSoldierId('')
      setSoldierName('')
      setSoldierRole('Combat')
      await loadSnapshot()
      await fetchRegistryData()

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
        // Field Force (Squad) - coordinates will be provided when unit goes online
        backendRole = 'Squad'
        backendArea = 'Center'
      }

      const payload: Record<string, unknown> = {
        name: forceName.trim(),
        description: forceDescription.trim(),
        username: generatedUsername,
        password: generatedPassword,
        role: backendRole,
        area: backendArea,
      }

      if (backendRole !== 'Squad') {
        payload.lat = defaultLat
        payload.lon = defaultLon
      }

      // Attach unlinked soldier if needed by command center
      if (backendRole === 'MainCommandCenter' || backendRole === 'AreaCommandCenter') {
        if (unlinkedSoldiers.length > 0) {
          payload.soldier_id = unlinkedSoldiers[0].id
        }
      }

      const created = await api.admin.createUser(payload)

      // Store in custom forces registry
      const newCustomForce: CustomForce = {
        id: String(created.id),
        name: forceName.trim(),
        description: forceDescription.trim(),
        type: forceType,
        area: backendArea,
        lat: defaultLat,
        lon: defaultLon,
      }
      const updatedForces = [...customForces, newCustomForce]
      setCustomForces(updatedForces)
      localStorage.setItem(LOCAL_STORAGE_CUSTOM_FORCES_KEY, JSON.stringify(updatedForces))

      setSuccessMessage(`Force '${forceName}' (${forceType}) successfully registered!`)
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

    // Role-specific validation
    if (userType === 'Field Team') {
      if (!effectiveTeamId) {
        setErrorMessage('You must select a specific team from the available unassigned ones.')
        return
      }
      const selectedTeam = availableTeams.find((t) => t.id === effectiveTeamId)
      if (!selectedTeam) {
        setErrorMessage('This field team already has an assigned user account. Each field team can only have 1 account.')
        return
      }
    } else if (userType === 'Regional HQ') {
      if (!selectedSoldierId) {
        setErrorMessage('You must specify the soldier linked to the Regional HQ user account.')
        return
      }
      if (!effectiveRegionalHQId) {
        setErrorMessage('You must select the Regional Headquarters to which this user is assigned.')
        return
      }
    } else if (userType === 'Administrator') {
      if (!selectedSoldierId) {
        setErrorMessage('Administrator accounts must be linked to a soldier selected from the dropdown.')
        return
      }
    }

    setIsLoading(true)
    try {
      let backendRole: 'MainCommandCenter' | 'AreaCommandCenter' | 'Radar' | 'Squad' = 'Squad'
      let backendArea: Area = 'Center'
      let displayName = username.trim()
      let defaultLat = 32.0853
      let defaultLon = 34.7818
      let targetSoldierId: string | undefined = undefined

      const linkedSoldier = unlinkedSoldiers.find((s) => s.id === selectedSoldierId)

      if (userType === 'Field Team') {
        const selectedTeam = availableTeams.find((t) => t.id === effectiveTeamId)
        backendRole = 'Squad'
        backendArea = 'Center'
        displayName = selectedTeam ? selectedTeam.name : `Field Team - ${username.trim()}`
        defaultLat = 32.0853
        defaultLon = 34.7818
        // No soldier link for Field Team
      } else if (userType === 'Regional HQ') {
        const selectedHQ = allRegionalHQs.find((h) => h.id === effectiveRegionalHQId)
        backendRole = 'AreaCommandCenter'
        backendArea = selectedHQ ? selectedHQ.area : 'Center'
        displayName = linkedSoldier
          ? `${linkedSoldier.name} (${selectedHQ ? selectedHQ.name : 'Regional HQ'})`
          : username.trim()
        targetSoldierId = selectedSoldierId
        if (backendArea === 'North') {
          defaultLat = 33.0000
          defaultLon = 35.3000
        } else if (backendArea === 'South') {
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
        // No soldier link for Radar
      } else {
        // Administrator
        backendRole = 'MainCommandCenter'
        backendArea = 'Global'
        displayName = linkedSoldier ? `${linkedSoldier.name} (Supreme Admin)` : username.trim()
        targetSoldierId = selectedSoldierId
        defaultLat = 32.0750
        defaultLon = 34.7920
      }

      const payload: Record<string, unknown> = {
        username: username.trim(),
        password,
        role: backendRole,
        area: backendArea,
        name: displayName,
        description: `Operational account for ${userType}`,
      }

      if (backendRole !== 'Squad') {
        payload.lat = defaultLat
        payload.lon = defaultLon
      }

      if (targetSoldierId) {
        payload.soldier_id = targetSoldierId
      }

      await api.admin.createUser(payload)

      setSuccessMessage(`User account '${username.trim()}' (${userType}) successfully created!`)
      setUsername('')
      setPassword('')
      setSelectedSoldierId('')
      setSelectedTeamId('')
      await loadSnapshot()
      await fetchRegistryData()

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

  if (!isOpen || user?.role !== 'MainCommandCenter') return null

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
                MILITARY REGISTRY, FORCES &amp; USER ACCESS
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

        {/* Status Feedback */}
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
          {/* TAB 1: ADD SOLDIER (7-Digit ID, Name, Role [EOD, Support/Non-combat, Combat]) */}
          {/* ========================================================= */}
          {activeTab === 'soldier' && (
            <form onSubmit={handleSubmitSoldier} className="space-y-4">
              <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] text-slate-400">
                Register military personnel with verified 7-digit military ID into the registry.
              </div>

              {/* Field 1: 7-Digit Military ID */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-300 tracking-wider uppercase font-semibold">
                    1. 7-Digit Military ID Number
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateSoldierId}
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

              {/* Field 2: Soldier Name */}
              <div>
                <label className="block text-xs text-slate-300 mb-1 tracking-wider uppercase font-semibold">
                  2. Soldier Full Name
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
                      onClick={() => setRoleWrapper(r)}
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
          {/* TAB 2: ADD FORCE (Administrator, Regional HQ, Radar, Field Force) */}
          {/* Name & Description. Regional HQ also requires Area/Region. */}
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
          {/* TAB 3: ADD USER (Username, Password, User Type) */}
          {/* Field Team: select specific team from existing ones */}
          {/* Regional HQ: select soldier AND regional HQ (no region dropdown) */}
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

              {/* 1. Field Team: Select Team from Existing Ones */}
              {userType === 'Field Team' && (
                <div className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-700/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs text-emerald-300 tracking-wider uppercase font-semibold flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      <span>Select Target Field Team</span>
                    </label>
                    <span className="text-[10px] text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-700">
                      {availableTeams.length} Unassigned Teams
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Select a team from the existing ones. Teams already assigned a user account cannot be linked again.
                  </p>

                  {availableTeams.length === 0 ? (
                    <div className="p-2.5 rounded bg-amber-950/40 border border-amber-700/70 text-amber-200 text-xs">
                      All field teams currently have assigned user accounts. Please add a new Field Force in the "Add Force" tab first.
                    </div>
                  ) : (
                    <select
                      required
                      value={effectiveTeamId}
                      onChange={(e) => setSelectedTeamId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-emerald-600 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
                    >
                      <option value="">-- Choose specific team --</option>
                      {availableTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name} {team.description ? `(${team.description})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* 2. Regional HQ: Select Linked Soldier AND Assigned Regional Headquarters (No Region Selector) */}
              {userType === 'Regional HQ' && (
                <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-700/70 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Compass className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">
                      Regional Headquarters Account Assignment
                    </span>
                  </div>

                  {/* Assigned Regional Headquarters Dropdown */}
                  <div>
                    <label className="block text-xs text-indigo-300 mb-1 tracking-wider uppercase font-semibold">
                      Assigned Regional Headquarters
                    </label>
                    <select
                      required
                      value={effectiveRegionalHQId}
                      onChange={(e) => setSelectedRegionalHQId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-indigo-500 rounded-lg text-white text-xs focus:border-cyan-500 focus:outline-none cursor-pointer"
                    >
                      <option value="">-- Select Regional Headquarters --</option>
                      {allRegionalHQs.map((hq) => (
                        <option key={hq.id} value={hq.id}>
                          {hq.name} [Sector: {hq.area}]
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Linked Soldier Dropdown (Unlinked Soldiers Only) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs text-indigo-300 tracking-wider uppercase font-semibold">
                        Linked Soldier
                      </label>
                      <span className="text-[10px] text-cyan-300 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
                        {unlinkedSoldiers.length} Unlinked Available
                      </span>
                    </div>

                    {isLoadingSoldiers ? (
                      <div className="p-2 text-xs text-slate-400 animate-pulse">Loading unlinked soldiers...</div>
                    ) : unlinkedSoldiers.length === 0 ? (
                      <div className="p-2.5 rounded bg-amber-950/40 border border-amber-700/70 text-amber-200 text-xs">
                        No unlinked soldiers available. Please register a soldier first in the "Add Soldier" tab.
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
                </div>
              )}

              {/* 3. Administrator: Linked to Soldier (Unlinked Only) */}
              {userType === 'Administrator' && (
                <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-700/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs text-indigo-300 tracking-wider uppercase font-semibold flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      <span>Link to Soldier (Mandatory for Administrator)</span>
                    </label>
                    <span className="text-[10px] text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                      {unlinkedSoldiers.length} Unlinked Available
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Select an unlinked soldier from the registry:
                  </p>

                  {isLoadingSoldiers ? (
                    <div className="p-2 text-xs text-slate-400 animate-pulse">Loading unlinked soldiers...</div>
                  ) : unlinkedSoldiers.length === 0 ? (
                    <div className="p-2.5 rounded bg-amber-950/40 border border-amber-700/70 text-amber-200 text-xs">
                      No unlinked soldiers available. Please register a soldier first in the "Add Soldier" tab.
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

  function setRoleWrapper(r: SoldierRoleOption) {
    setSoldierRole(r)
  }
}
