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
import { UnitListDrawer } from './components/Dashboard/UnitListDrawer'
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

  const [isUnitDrawerOpen, setIsUnitDrawerOpen] = useState(false)
  const [drawerInitialTab, setDrawerInitialTab] = useState<'live' | 'roster' | 'alerts'>('roster')

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
          <div className="tracking-widest text-sm uppercase">INITIALIZING TACTICAL C2 INTERFACE...</div>
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
        onToggleUnitDrawer={() => setIsUnitDrawerOpen((prev) => !prev)}
        isUnitDrawerOpen={isUnitDrawerOpen}
        onOpenLiveUnitsList={() => {
          setDrawerInitialTab('live')
          setIsUnitDrawerOpen(true)
        }}
        onOpenRosterList={() => {
          setDrawerInitialTab('roster')
          setIsUnitDrawerOpen(true)
        }}
        onOpenAlertsList={() => {
          setDrawerInitialTab('alerts')
          setIsUnitDrawerOpen(true)
        }}
      />

      {/* Main Tactical Map View */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <TacticalMap />

        {/* Proximity Alerts Banner (<2 km) */}
        <ProximityAlertBanner />

        {/* Simulator D-Pad for Field Units */}
        <SimulatorControls />

        {/* Unit Roster Drawer */}
        <UnitListDrawer
          isOpen={isUnitDrawerOpen}
          onClose={() => setIsUnitDrawerOpen(false)}
          initialTab={drawerInitialTab}
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
