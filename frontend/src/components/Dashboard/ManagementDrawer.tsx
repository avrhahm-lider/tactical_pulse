import React, { useState, useEffect, useMemo } from 'react'
import {
  X,
  Users,
  Shield,
  UserCheck,
  UserPlus,
  Building2,
  Trash2,
  RotateCcw,
  Edit2,
  Search,
  Key,
  AlertCircle,
  PlusCircle,
  Power,
  UserMinus,
  Loader2,
} from 'lucide-react'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import { api } from '../../services/api'
import type { User, Soldier, UserRole, Area } from '../../types'

interface ManagementDrawerProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'users' | 'forces' | 'soldiers'
}

export const ManagementDrawer: React.FC<ManagementDrawerProps> = ({
  isOpen,
  onClose,
  initialTab = 'users',
}) => {
  const {
    squads,
    loadSnapshot,
    removeSquad,
    setIsUserRegistrationModalOpen,
    setRegistrationModalTab,
  } = useMapStore()
  const { user: currentAdmin } = useAuthStore()

  const [activeTab, setActiveTab] = useState<'users' | 'forces' | 'soldiers'>(initialTab)

  // Remote data states
  const [usersList, setUsersList] = useState<User[]>([])
  const [soldiersList, setSoldiersList] = useState<Soldier[]>([])
  const [unlinkedSoldiers, setUnlinkedSoldiers] = useState<Soldier[]>([])
  const [unassignedSoldiers, setUnassignedSoldiers] = useState<Soldier[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('ALL')

  // Edit User Modal State
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('Squad')
  const [editArea, setEditArea] = useState<Area>('Center')
  const [editSoldierId, setEditSoldierId] = useState<string>('')
  const [editPassword, setEditPassword] = useState('')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Edit Soldier Modal State
  const [editingSoldier, setEditingSoldier] = useState<Soldier | null>(null)
  const [editSoldierName, setEditSoldierName] = useState('')
  const [editSoldierRole, setEditSoldierRole] = useState('')

  // Assign Soldier to Force state
  const [assigningToSquadId, setAssigningToSquadId] = useState<string | null>(null)
  const [selectedSoldierToAssign, setSelectedSoldierToAssign] = useState<string>('')

  // Sync tab when initialTab changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab, isOpen])

  // Fetch data on open or tab change
  const refreshData = React.useCallback(async () => {
    if (!isOpen) return
    setIsLoading(true)
    try {
      const [users, soldiers, unlinked, unassigned] = await Promise.all([
        api.admin.getUsers().catch(() => []),
        api.admin.getSoldiers().catch(() => []),
        api.admin.getUnlinkedSoldiers().catch(() => []),
        api.admin.getUnassignedSoldiers().catch(() => []),
      ])
      setUsersList(users)
      setSoldiersList(soldiers)
      setUnlinkedSoldiers(unlinked)
      setUnassignedSoldiers(unassigned)
    } catch (err) {
      console.error('Failed to fetch management data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [isOpen])

  useEffect(() => {
    refreshData()
  }, [isOpen, activeTab, refreshData])

  // Open Edit User modal
  const handleStartEditUser = (u: User) => {
    setEditingUser(u)
    setEditName(u.name || '')
    setEditDescription(u.description || '')
    setEditRole(u.role)
    setEditArea(u.area)
    setEditSoldierId(u.soldier_id || '')
    setEditPassword('')
    setEditError(null)
  }

  // Save Edit User
  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    setIsSubmittingEdit(true)
    setEditError(null)

    try {
      const payload: Record<string, unknown> = {
        name: editName.trim(),
        description: editDescription.trim(),
        role: editRole,
        area: editArea,
        soldier_id: editSoldierId ? editSoldierId : null,
      }
      if (editPassword.trim()) {
        payload.password = editPassword.trim()
      }

      await api.admin.updateUser(editingUser.id, payload)
      setEditingUser(null)
      await refreshData()
      await loadSnapshot()
    } catch (err: unknown) {
      let msg = 'Failed to update user.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axErr = err as { response?: { data?: { error?: { message?: string } } } }
        msg = axErr.response?.data?.error?.message || msg
      }
      setEditError(msg)
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  // Toggle user status
  const handleToggleStatus = async (targetUser: User) => {
    const nextStatus = targetUser.status === 'active' ? 'inactive' : 'active'
    try {
      await api.admin.updateStatus(targetUser.id, nextStatus)
      await refreshData()
      await loadSnapshot()
    } catch (err) {
      console.error(err)
      alert('Failed to update user status.')
    }
  }

  // Reset user session
  const handleResetSession = async (targetUser: User) => {
    try {
      await api.admin.resetUserSession(targetUser.id)
      alert(`Session for ${targetUser.username} has been reset.`)
      await refreshData()
    } catch (err) {
      console.error(err)
      alert('Failed to reset user session.')
    }
  }

  // Delete user account
  const handleDeleteUser = async (targetUser: User) => {
    if (
      !window.confirm(
        `Are you sure you want to permanently delete user account '${targetUser.username}' (${targetUser.name})? All assigned assets will be unlinked. This cannot be undone.`
      )
    ) {
      return
    }

    try {
      await api.admin.deleteUser(targetUser.id)
      removeSquad(targetUser.id)
      await refreshData()
      await loadSnapshot()
    } catch (err: unknown) {
      let msg = 'Failed to delete user.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axErr = err as { response?: { data?: { error?: { message?: string } } } }
        msg = axErr.response?.data?.error?.message || msg
      }
      alert(msg)
    }
  }

  // Reset all user sessions
  const handleResetAllSessions = async () => {
    if (!window.confirm('Are you sure you want to terminate all active user sessions?')) return
    try {
      await api.admin.resetAllSessions()
      alert('All active sessions have been terminated.')
      await refreshData()
    } catch (err) {
      console.error(err)
      alert('Failed to reset sessions.')
    }
  }

  // Delete soldier
  const handleDeleteSoldier = async (s: Soldier) => {
    if (!window.confirm(`Delete soldier '${s.name}' (ID: ${s.id}) from military registry?`)) return
    try {
      await api.admin.deleteSoldier(s.id)
      await refreshData()
      await loadSnapshot()
    } catch (err) {
      console.error(err)
      alert('Failed to delete soldier.')
    }
  }

  // Edit Soldier
  const handleSaveEditSoldier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingSoldier) return
    try {
      await api.admin.updateSoldier(editingSoldier.id, {
        name: editSoldierName.trim(),
        role: editSoldierRole.trim(),
      })
      setEditingSoldier(null)
      await refreshData()
      await loadSnapshot()
    } catch (err) {
      console.error(err)
      alert('Failed to update soldier.')
    }
  }

  // Assign soldier to squad
  const handleAssignSoldierToSquad = async (squadId: string) => {
    if (!selectedSoldierToAssign) return
    try {
      await api.admin.updateSoldier(selectedSoldierToAssign, { squad_id: squadId })
      setAssigningToSquadId(null)
      setSelectedSoldierToAssign('')
      await refreshData()
      await loadSnapshot()
    } catch (err) {
      console.error(err)
      alert('Failed to assign soldier to squad.')
    }
  }

  // Remove soldier from squad
  const handleRemoveSoldierFromSquad = async (soldierId: string) => {
    try {
      await api.admin.updateSoldier(soldierId, { squad_id: null })
      await refreshData()
      await loadSnapshot()
    } catch (err) {
      console.error(err)
      alert('Failed to unassign soldier.')
    }
  }

  // Filtered lists
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      const matchSearch =
        u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.soldier?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.soldier_id || '').includes(searchQuery)
      const matchRole = roleFilter === 'ALL' || u.role === roleFilter
      return matchSearch && matchRole
    })
  }, [usersList, searchQuery, roleFilter])

  const filteredSoldiers = useMemo(() => {
    return soldiersList.filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.id.includes(searchQuery)
      const matchRole = roleFilter === 'ALL' || s.role.toLowerCase() === roleFilter.toLowerCase()
      return matchSearch && matchRole
    })
  }, [soldiersList, searchQuery, roleFilter])

  const allSquadsList = Object.values(squads)

  // Badge helpers
  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'MainCommandCenter':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-purple-950/70 text-purple-300 border-purple-700">
            MAIN HQ
          </span>
        )
      case 'AreaCommandCenter':
        return (
          <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold bg-indigo-950/70 text-indigo-300 border-indigo-700">
            REGIONAL HQ
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
            FIELD SQUAD
          </span>
        )
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 right-0 z-[1200] w-[540px] hud-panel border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-5 h-5 text-cyan-400" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-sm font-bold text-white tracking-wider">
                OPERATIONAL MANAGEMENT
              </h2>
              {isLoading && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
            </div>
            <div className="text-[10px] font-mono text-slate-400">ADMINISTRATIVE COMMAND & CONTROL</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Tabs: USERS vs FORCES vs SOLDIERS */}
      <div className="grid grid-cols-3 p-2 gap-1.5 border-b border-slate-800/80 bg-slate-950/60 font-mono text-xs">
        <button
          onClick={() => {
            setActiveTab('users')
            setSearchQuery('')
            setRoleFilter('ALL')
          }}
          className={`py-2 px-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all cursor-pointer border ${
            activeTab === 'users'
              ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300 font-bold shadow-sm shadow-cyan-950/40'
              : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 text-slate-400'
          }`}
        >
          <Users className="w-4 h-4 text-cyan-400" />
          <span>USERS ({usersList.length})</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('forces')
            setSearchQuery('')
            setRoleFilter('ALL')
          }}
          className={`py-2 px-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all cursor-pointer border ${
            activeTab === 'forces'
              ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold shadow-sm shadow-emerald-950/40'
              : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 text-slate-400'
          }`}
        >
          <Building2 className="w-4 h-4 text-emerald-400" />
          <span>FORCES ({allSquadsList.length})</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('soldiers')
            setSearchQuery('')
            setRoleFilter('ALL')
          }}
          className={`py-2 px-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all cursor-pointer border ${
            activeTab === 'soldiers'
              ? 'bg-purple-950/80 border-purple-600 text-purple-300 font-bold shadow-sm shadow-purple-950/40'
              : 'bg-slate-900/50 hover:bg-slate-800 border-slate-800 text-slate-400'
          }`}
        >
          <UserCheck className="w-4 h-4 text-purple-400" />
          <span>SOLDIERS ({soldiersList.length})</span>
        </button>
      </div>

      {/* Sub-header Action Bar */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder={
              activeTab === 'users'
                ? 'Search users, display name, soldier...'
                : activeTab === 'forces'
                ? 'Search operational units...'
                : 'Search soldiers by name or 7-digit ID...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Action Button depending on Tab */}
        {activeTab === 'users' && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setRegistrationModalTab('user')
                setIsUserRegistrationModalOpen(true)
              }}
              className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-md shadow-cyan-950 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ NEW USER</span>
            </button>
            <button
              onClick={handleResetAllSessions}
              title="Reset all active sessions"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950 hover:border-red-700 border border-slate-700 text-slate-300 hover:text-red-300 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {activeTab === 'forces' && (
          <button
            onClick={() => {
              setRegistrationModalTab('force')
              setIsUserRegistrationModalOpen(true)
            }}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-950 cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>+ NEW FORCE</span>
          </button>
        )}

        {activeTab === 'soldiers' && (
          <button
            onClick={() => {
              setRegistrationModalTab('soldier')
              setIsUserRegistrationModalOpen(true)
            }}
            className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-md shadow-purple-950 cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>+ NEW SOLDIER</span>
          </button>
        )}
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {/* ========================================================= */}
        {/* TAB 1: USERS MANAGEMENT */}
        {/* ========================================================= */}
        {activeTab === 'users' && (
          filteredUsers.length === 0 ? (
            <div className="text-center py-16 text-slate-500 font-mono text-xs">
              <Users className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
              <div>NO USERS MATCH SEARCH CRITERIA</div>
            </div>
          ) : (
            filteredUsers.map((u) => {
              const isCurrent = u.id === currentAdmin?.id
              return (
                <div
                  key={u.id}
                  className={`p-3.5 rounded-xl border text-xs font-mono transition-all ${
                    u.status === 'active'
                      ? 'bg-slate-900/70 border-slate-800'
                      : 'bg-slate-950/40 border-slate-900 opacity-60'
                  }`}
                >
                  {/* Top line: display name & role & status */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            u.is_logged_in
                              ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                              : 'bg-slate-600'
                          }`}
                        ></span>
                        <span className="font-bold text-white text-sm">{u.name}</span>
                        <span className="text-[11px] text-slate-400 font-mono">@{u.username}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {getRoleBadge(u.role)}
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-800 bg-slate-950 text-slate-400 font-semibold">
                          {u.area}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
                            u.status === 'active'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60'
                              : 'bg-red-950/80 text-red-300 border border-red-700/60'
                          }`}
                        >
                          {u.status}
                        </span>
                        {u.is_logged_in ? (
                          <span className="text-[9px] text-emerald-400 font-semibold">ONLINE</span>
                        ) : (
                          <span className="text-[9px] text-slate-500">OFFLINE</span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      {/* Edit Button */}
                      <button
                        onClick={() => handleStartEditUser(u)}
                        title="Edit / Redefine User"
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-600 text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Reset Session */}
                      <button
                        onClick={() => handleResetSession(u)}
                        title="Reset Active Session"
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-950 border border-slate-700 hover:border-amber-600 text-slate-300 hover:text-amber-300 transition-colors cursor-pointer"
                      >
                        <Key className="w-3.5 h-3.5" />
                      </button>

                      {/* Toggle Status */}
                      {!isCurrent && (
                        <button
                          onClick={() => handleToggleStatus(u)}
                          title={u.status === 'active' ? 'Deactivate User' : 'Activate User'}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                            u.status === 'active'
                              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                              : 'bg-emerald-950 hover:bg-emerald-900 border-emerald-700 text-emerald-300'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete User */}
                      {!isCurrent && (
                        <button
                          onClick={() => handleDeleteUser(u)}
                          title="Delete User Account"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950 border border-slate-700 hover:border-red-600 text-slate-300 hover:text-red-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Middle row: Linked soldier information */}
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center space-x-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                      <span>
                        {u.soldier ? (
                          <>
                            Linked Soldier:{' '}
                            <span className="text-white font-semibold">{u.soldier.name}</span>{' '}
                            <span className="text-cyan-400">#{u.soldier.id}</span>{' '}
                            <span className="text-slate-500">[{u.soldier.role}]</span>
                          </>
                        ) : (
                          <span className="text-slate-500 italic">No Soldier Linked (Unlinked Unit)</span>
                        )}
                      </span>
                    </div>

                    {u.description && (
                      <span className="text-slate-500 text-[10px] truncate max-w-[180px]">
                        {u.description}
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )
        )}

        {/* ========================================================= */}
        {/* TAB 2: FORCES / SQUADS MANAGEMENT */}
        {/* ========================================================= */}
        {activeTab === 'forces' && (
          allSquadsList.length === 0 ? (
            <div className="text-center py-16 text-slate-500 font-mono text-xs">
              <Building2 className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
              <div>NO OPERATIONAL FORCES FOUND</div>
            </div>
          ) : (
            allSquadsList.map((sq) => {
              const matchingUser = usersList.find((u) => u.id === sq.id || u.name === sq.name)
              const isAssigning = assigningToSquadId === sq.id

              return (
                <div
                  key={sq.id}
                  className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 font-mono text-xs transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        <span className="font-bold text-white text-sm">{sq.name}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {getRoleBadge(sq.role)}
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-800 bg-slate-950 text-slate-400 font-semibold">
                          {sq.area}
                        </span>
                        {matchingUser ? (
                          <span className="text-[10px] text-emerald-400 font-mono">
                            Account: @{matchingUser.username}
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400 font-mono">
                            No User Account Assigned
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setAssigningToSquadId(isAssigning ? null : sq.id)}
                      className="px-2 py-1 rounded bg-cyan-950 hover:bg-cyan-900 border border-cyan-600 text-cyan-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>{isAssigning ? 'CANCEL' : '+ ASSIGN SOLDIER'}</span>
                    </button>
                  </div>

                  {/* Assign Soldier Inline Form */}
                  {isAssigning && (
                    <div className="mt-2.5 p-2.5 rounded-lg bg-slate-950 border border-cyan-800/60 flex items-center gap-2">
                      <select
                        value={selectedSoldierToAssign}
                        onChange={(e) => setSelectedSoldierToAssign(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      >
                        <option value="">-- Select Unassigned Soldier --</option>
                        {unassignedSoldiers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} (#{s.id}) - {s.role}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAssignSoldierToSquad(sq.id)}
                        disabled={!selectedSoldierToAssign}
                        className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold text-xs cursor-pointer"
                      >
                        CONFIRM
                      </button>
                    </div>
                  )}

                  {/* Unit Roster Soldiers List */}
                  <div className="mt-3 pt-2 border-t border-slate-800/80">
                    <div className="text-[10px] text-slate-400 font-bold mb-1.5 flex items-center justify-between">
                      <span>UNIT PERSONNEL ROSTER ({sq.soldiers?.length || 0})</span>
                    </div>

                    {sq.soldiers && sq.soldiers.length > 0 ? (
                      <div className="space-y-1">
                        {sq.soldiers.map((s) => (
                          <div
                            key={s.id}
                            className="px-2.5 py-1 rounded bg-slate-950/70 border border-slate-800 text-[11px] flex items-center justify-between"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="text-white font-medium">{s.name}</span>
                              <span className="text-cyan-400 font-mono text-[10px]">#{s.id}</span>
                              <span className="text-slate-500 text-[10px]">[{s.role}]</span>
                            </div>
                            <button
                              onClick={() => handleRemoveSoldierFromSquad(s.id)}
                              title="Remove from unit roster"
                              className="text-slate-500 hover:text-red-400 transition-colors p-0.5"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 italic">
                        No soldiers currently assigned to unit roster.
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )
        )}

        {/* ========================================================= */}
        {/* TAB 3: SOLDIERS REGISTRY */}
        {/* ========================================================= */}
        {activeTab === 'soldiers' && (
          filteredSoldiers.length === 0 ? (
            <div className="text-center py-16 text-slate-500 font-mono text-xs">
              <UserCheck className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
              <div>NO SOLDIERS MATCH SEARCH CRITERIA</div>
            </div>
          ) : (
            filteredSoldiers.map((s) => {
              const assignedSquad = allSquadsList.find((sq) => sq.id === s.squad_id)
              const linkedUser = usersList.find((u) => u.soldier_id === s.id)

              return (
                <div
                  key={s.id}
                  className="p-3 rounded-xl border border-slate-800 bg-slate-900/60 font-mono text-xs flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm">{s.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-mono font-bold">
                        #{s.id}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase">
                        {s.role}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-400">
                      <span>
                        Unit:{' '}
                        {assignedSquad ? (
                          <span className="text-emerald-400 font-semibold">{assignedSquad.name}</span>
                        ) : (
                          <span className="text-slate-500 italic">Unassigned</span>
                        )}
                      </span>
                      <span>
                        Account:{' '}
                        {linkedUser ? (
                          <span className="text-purple-400 font-semibold">@{linkedUser.username}</span>
                        ) : (
                          <span className="text-slate-500 italic">No User Account</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setEditingSoldier(s)
                        setEditSoldierName(s.name)
                        setEditSoldierRole(s.role)
                      }}
                      title="Edit soldier"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-cyan-950 border border-slate-700 text-slate-300 hover:text-cyan-300 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteSoldier(s)}
                      title="Delete soldier"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950 border border-slate-700 text-slate-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )
        )}
      </div>

      {/* ========================================================= */}
      {/* EDIT USER MODAL (REDEFINE USER SETTINGS) */}
      {/* ========================================================= */}
      {editingUser && (
        <div className="fixed inset-0 z-[1300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/60 rounded-xl w-full max-w-md p-5 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Edit2 className="w-4 h-4 text-cyan-400" />
                <h3 className="font-bold text-white text-sm">
                  EDIT USER: @{editingUser.username}
                </h3>
              </div>
              <button
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="mt-3 p-2.5 rounded bg-red-950/80 border border-red-700 text-red-200 text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditUser} className="mt-3 space-y-3">
              <div>
                <label className="text-slate-400 block mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Description</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Operational Role</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as UserRole)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="MainCommandCenter">MainCommandCenter</option>
                    <option value="AreaCommandCenter">AreaCommandCenter</option>
                    <option value="Radar">Radar</option>
                    <option value="Squad">Squad</option>
                    <option value="SapperSquad">SapperSquad</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Operational Area</label>
                  <select
                    value={editArea}
                    onChange={(e) => setEditArea(e.target.value as Area)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Center">Center</option>
                    <option value="North">North</option>
                    <option value="South">South</option>
                    <option value="Global">Global</option>
                  </select>
                </div>
              </div>

              {/* Linked Soldier dropdown (Unlinked soldiers + current) */}
              <div>
                <label className="text-slate-400 block mb-1">
                  Linked Soldier (1 Account Per Soldier Max)
                </label>
                <select
                  value={editSoldierId}
                  onChange={(e) => setEditSoldierId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">[None - Unlink Soldier]</option>
                  {editingUser.soldier && (
                    <option value={editingUser.soldier.id}>
                      {editingUser.soldier.name} (#{editingUser.soldier.id}) [Current]
                    </option>
                  )}
                  {unlinkedSoldiers
                    .filter((s) => s.id !== editingUser.soldier?.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (#{s.id}) - {s.role}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">
                  New Password (Optional, leave blank to keep unchanged)
                </label>
                <input
                  type="password"
                  placeholder="Leave blank to preserve current password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold cursor-pointer"
                >
                  {isSubmittingEdit ? 'SAVING...' : 'SAVE CHANGES'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* EDIT SOLDIER MODAL */}
      {/* ========================================================= */}
      {editingSoldier && (
        <div className="fixed inset-0 z-[1300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-500/60 rounded-xl w-full max-w-sm p-5 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-sm">
                EDIT SOLDIER #{editingSoldier.id}
              </h3>
              <button
                onClick={() => setEditingSoldier(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditSoldier} className="mt-3 space-y-3">
              <div>
                <label className="text-slate-400 block mb-1">Soldier Full Name</label>
                <input
                  type="text"
                  required
                  value={editSoldierName}
                  onChange={(e) => setEditSoldierName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Military Role</label>
                <input
                  type="text"
                  required
                  value={editSoldierRole}
                  onChange={(e) => setEditSoldierRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSoldier(null)}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 font-semibold cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold cursor-pointer"
                >
                  SAVE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
