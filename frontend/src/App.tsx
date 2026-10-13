import React, { useEffect, useState } from 'react'
import { useAuthStore } from './store/useAuthStore'
import { useMapStore } from './store/useMapStore'
import { connectSocket, disconnectSocket } from './services/socket'
import { LoginForm } from './components/Auth/LoginForm'
import { Header } from './components/Dashboard/Header'
import { TacticalMap } from './components/Map/TacticalMap'
import { ThreatModal } from './components/Forms/ThreatModal'
import { UserRegistrationModal } from './components/Forms/UserRegistrationModal'
import { ThreatDetailModal } from './components/Dashboard/ThreatDetailModal'
import { OperationsDrawer } from './components/Dashboard/OperationsDrawer'
import { ManagementDrawer } from './components/Dashboard/ManagementDrawer'
import { ProximityAlertBanner } from './components/Dashboard/ProximityAlertBanner'
import { SimulatorControls } from './components/Dashboard/SimulatorControls'

export const App: React.FC = () => {
  const { user, isAuthenticated, isLoading, initAuth } = useAuthStore()
  const {
    threats,
    selectedEntity,
    setSelectedEntity,
    loadSnapshot,
    isThreatModalOpen,
    setIsThreatModalOpen,
    isUserRegistrationModalOpen,
    setIsUserRegistrationModalOpen,
  } = useMapStore()

  // Left Drawer (Operations: Live & Alerts)
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false)
  const [leftDrawerTab, setLeftDrawerTab] = useState<'live' | 'alerts'>('live')

  // Right Drawer (Management: Users, Forces, Soldiers)
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false)
  const [rightDrawerTab, setRightDrawerTab] = useState<'users' | 'forces' | 'soldiers'>('users')

  // Session rehydration on mount
  useEffect(() => {
    initAuth()
  }, [initAuth])

  // Connect Socket.IO when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const token = localStorage.getItem('access_token') || ''
      connectSocket(token, user?.id)
      loadSnapshot()
    } else {
      disconnectSocket()
    }

    return () => {
      disconnectSocket()
    }
  }, [isAuthenticated, user, loadSnapshot])

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-[#070a12] flex items-center justify-center font-mono text-cyan-400">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="tracking-widest text-sm uppercase">INITIALIZING TACTICAL COMMAND INTERFACE...</div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginForm />
  }

  const selectedThreat =
    selectedEntity?.type === 'threat' ? threats[selectedEntity.id] : null

  return (
    <div className="h-screen w-screen flex flex-col bg-[#070a12] overflow-hidden text-slate-100">
      {/* Top Tactical Command Header */}
      <Header
        onOpenCreateThreat={() => setIsThreatModalOpen(true)}
        onOpenLiveList={() => {
          setLeftDrawerTab('live')
          setIsLeftDrawerOpen(true)
        }}
        onOpenAlertsList={() => {
          setLeftDrawerTab('alerts')
          setIsLeftDrawerOpen(true)
        }}
        onToggleManagementDrawer={() => {
          if (!isRightDrawerOpen) {
            setRightDrawerTab(user?.role === 'MainCommandCenter' ? 'users' : 'forces')
          }
          setIsRightDrawerOpen((prev) => !prev)
        }}
        isManagementDrawerOpen={isRightDrawerOpen}
      />

      {/* Main Tactical Map View */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <TacticalMap />

        {/* Proximity Alerts Banner (<2 km) */}
        <ProximityAlertBanner />

        {/* Simulator D-Pad for Field Units */}
        <SimulatorControls />

        {/* Operations Drawer (Left: Live Units & Alerts) */}
        <OperationsDrawer
          isOpen={isLeftDrawerOpen}
          onClose={() => setIsLeftDrawerOpen(false)}
          initialTab={leftDrawerTab}
        />

        {/* Operational Management Drawer (Right: Users, Forces, Soldiers) */}
        <ManagementDrawer
          isOpen={isRightDrawerOpen}
          onClose={() => setIsRightDrawerOpen(false)}
          initialTab={rightDrawerTab}
        />

        {/* Threat Creation Modal */}
        <ThreatModal
          isOpen={isThreatModalOpen}
          onClose={() => setIsThreatModalOpen(false)}
        />

        {/* Force & Regional HQ Registration Modal */}
        <UserRegistrationModal
          isOpen={isUserRegistrationModalOpen}
          onClose={() => setIsUserRegistrationModalOpen(false)}
        />

        {/* Threat Action / Details Modal */}
        {selectedThreat && (
          <ThreatDetailModal
            threat={selectedThreat}
            onClose={() => setSelectedEntity(null)}
          />
        )}
      </main>
    </div>
  )
}

export default App
