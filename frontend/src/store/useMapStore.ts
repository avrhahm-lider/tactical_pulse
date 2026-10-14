import { create } from 'zustand'
import { api } from '../services/api'
import type { MapSnapshot, Squad, Threat, SquadMovedPayload, DangerZoneAlert } from '../types'

export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function processDangerZone(
  squad: Squad,
  threat: Threat,
  alerts: DangerZoneAlert[],
  dismissedIds: string[]
): { alerts: DangerZoneAlert[]; dismissedIds: string[] } {
  if (threat.status === 'inactive' || threat.engagement_status === 'resolved') {
    return { alerts, dismissedIds }
  }
  const dist = calculateDistanceMeters(squad.lat, squad.lon, threat.lat, threat.lon)
  const dangerRadius = threat.radius || 150.0
  const alertKey = `${squad.id}_${threat.id}`

  if (dist <= dangerRadius) {
    if (dismissedIds.includes(alertKey)) {
      return { alerts, dismissedIds }
    }
    const alertObj: DangerZoneAlert = {
      id: alertKey,
      threat_id: threat.id,
      threat_name: threat.name,
      threat_type: threat.threat_type,
      severity_level: threat.severity_level,
      squad_id: squad.id,
      squad_name: squad.name,
      distance_meters: Math.round(dist),
      danger_radius_meters: dangerRadius,
      message: `CRITICAL ALERT: ${squad.name} is INSIDE danger perimeter of ${threat.name} (${Math.round(dist)}m <= ${dangerRadius}m)!`,
      timestamp: Date.now(),
    }
    const idx = alerts.findIndex((a) => a.id === alertKey)
    const nextAlerts = [...alerts]
    if (idx >= 0) nextAlerts[idx] = alertObj
    else nextAlerts.push(alertObj)
    return { alerts: nextAlerts, dismissedIds }
  }

  return {
    alerts: alerts.filter((a) => a.id !== alertKey),
    dismissedIds: dismissedIds.filter((k) => k !== alertKey),
  }
}

export interface FocusTarget {
  lat: number
  lon: number
  zoom?: number
  id?: string
  type?: 'squad' | 'threat'
  timestamp: number
}

interface MapState {
  squads: Record<string, Squad>
  threats: Record<string, Threat>
  isLoading: boolean
  error: string | null
  selectedEntity: { type: 'squad' | 'threat'; id: string } | null
  focusTarget: FocusTarget | null
  isPickingLocationOnMap: boolean
  pickedLocation: { lat: number; lon: number } | null
  proximityAlerts: Threat[]
  dangerZoneAlerts: DangerZoneAlert[]
  dismissedDangerAlertIds: string[]
  isThreatModalOpen: boolean
  isUserRegistrationModalOpen: boolean
  registrationModalTab: 'soldier' | 'force' | 'user'
  selectedZoneFilter: 'Global' | 'North' | 'Center' | 'South'
  activeTileLayer: 'dark' | 'satellite' | 'osm'
  setActiveTileLayer: (layer: 'dark' | 'satellite' | 'osm') => void
  loadSnapshot: () => Promise<void>
  updateSquadPosition: (payload: SquadMovedPayload, currentUserId?: string) => void
  removeSquad: (squadId: string) => void
  addOrUpdateThreat: (threat: Threat, currentUserId?: string) => void
  removeThreat: (threatId: string) => void
  addDangerZoneAlert: (alert: DangerZoneAlert) => void
  dismissDangerZoneAlert: (alertId: string) => void
  setSelectedEntity: (entity: { type: 'squad' | 'threat'; id: string } | null) => void
  focusEntity: (type: 'squad' | 'threat', id: string, lat: number, lon: number, zoom?: number) => void
  setIsPickingLocationOnMap: (isPicking: boolean) => void
  setPickedLocation: (loc: { lat: number; lon: number } | null) => void
  setIsThreatModalOpen: (isOpen: boolean) => void
  setIsUserRegistrationModalOpen: (isOpen: boolean) => void
  setRegistrationModalTab: (tab: 'soldier' | 'force' | 'user') => void
  setSelectedZoneFilter: (zone: 'Global' | 'North' | 'Center' | 'South') => void
  openAlertAtLocation: (lat: number, lon: number) => void
  dismissAlert: (threatId: string) => void
  checkProximityAlerts: (userLat: number, userLon: number) => void
}

export const useMapStore = create<MapState>((set, get) => ({
  squads: {},
  threats: {},
  isLoading: false,
  error: null,
  selectedEntity: null,
  focusTarget: null,
  isPickingLocationOnMap: false,
  pickedLocation: null,
  proximityAlerts: [],
  dangerZoneAlerts: [],
  dismissedDangerAlertIds: [],
  isThreatModalOpen: false,
  isUserRegistrationModalOpen: false,
  registrationModalTab: 'soldier',
  selectedZoneFilter: 'Global',
  activeTileLayer: 'dark',
  setActiveTileLayer: (layer) => set({ activeTileLayer: layer }),
  focusEntity: (type, id, lat, lon, zoom = 15) => {
    set({
      focusTarget: { type, id, lat, lon, zoom, timestamp: Date.now() },
      selectedEntity: { type, id },
    })
  },

  loadSnapshot: async () => {
    set({ isLoading: true, error: null })
    try {
      const snapshot: MapSnapshot = await api.map.getSnapshot()
      const squadMap: Record<string, Squad> = {}
      snapshot.squads.forEach((sq) => { squadMap[sq.id] = sq })

      const threatMap: Record<string, Threat> = {}
      snapshot.threats.forEach((th) => {
        if (th.status !== 'inactive' && th.engagement_status !== 'resolved') {
          threatMap[th.id] = th
        }
      })
      set({ squads: squadMap, threats: threatMap, isLoading: false })
    } catch (err: unknown) {
      let message = 'Failed to load map snapshot.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        message = axiosErr.response?.data?.error?.message || message
      }
      set({ error: message, isLoading: false })
    }
  },

  updateSquadPosition: (payload, currentUserId) => {
    set((state) => {
      const existing = state.squads[payload.id]
      if (!existing) return state

      const updatedSquad: Squad = {
        ...existing,
        lat: payload.lat,
        lon: payload.lon,
        heading: payload.heading,
        updated_at: payload.updated_at,
      }
      let alerts = [...state.dangerZoneAlerts]
      let dismissed = [...state.dismissedDangerAlertIds]

      if (currentUserId && currentUserId === payload.id) {
        for (const threat of Object.values(state.threats)) {
          const res = processDangerZone(updatedSquad, threat, alerts, dismissed)
          alerts = res.alerts
          dismissed = res.dismissedIds
        }
      }

      return {
        squads: { ...state.squads, [payload.id]: updatedSquad },
        dangerZoneAlerts: alerts,
        dismissedDangerAlertIds: dismissed,
        proximityAlerts: [],
      }
    })
  },

  removeSquad: (squadId) => {
    set((state) => {
      const { [squadId]: _, ...remaining } = state.squads
      return {
        squads: remaining,
        selectedEntity: state.selectedEntity?.id === squadId ? null : state.selectedEntity,
        dangerZoneAlerts: state.dangerZoneAlerts.filter((a) => a.squad_id !== squadId),
      }
    })
  },

  addOrUpdateThreat: (threat, currentUserId) => {
    set((state) => {
      if (threat.status === 'inactive' || threat.engagement_status === 'resolved') {
        const { [threat.id]: _, ...remaining } = state.threats
        return {
          threats: remaining,
          proximityAlerts: state.proximityAlerts.filter((t) => t.id !== threat.id),
          dangerZoneAlerts: state.dangerZoneAlerts.filter((a) => a.threat_id !== threat.id),
        }
      }

      const updatedThreats = { ...state.threats, [threat.id]: threat }
      let alerts = [...state.dangerZoneAlerts]
      let dismissed = [...state.dismissedDangerAlertIds]

      if (currentUserId && state.squads[currentUserId]) {
        const res = processDangerZone(state.squads[currentUserId], threat, alerts, dismissed)
        alerts = res.alerts
        dismissed = res.dismissedIds
      }

      return {
        threats: updatedThreats,
        dangerZoneAlerts: alerts,
        dismissedDangerAlertIds: dismissed,
        proximityAlerts: [],
      }
    })
  },

  removeThreat: (threatId) => {
    set((state) => {
      const { [threatId]: _, ...remaining } = state.threats
      return {
        threats: remaining,
        proximityAlerts: state.proximityAlerts.filter((t) => t.id !== threatId),
        dangerZoneAlerts: state.dangerZoneAlerts.filter((a) => a.threat_id !== threatId),
        dismissedDangerAlertIds: state.dismissedDangerAlertIds.filter((id) => !id.endsWith(`_${threatId}`)),
      }
    })
  },

  addDangerZoneAlert: (alert) => {
    set((state) => {
      if (state.dismissedDangerAlertIds.includes(alert.id)) return state
      const idx = state.dangerZoneAlerts.findIndex((a) => a.id === alert.id)
      if (idx >= 0) {
        const next = [...state.dangerZoneAlerts]
        next[idx] = alert
        return { dangerZoneAlerts: next }
      }
      return { dangerZoneAlerts: [alert, ...state.dangerZoneAlerts] }
    })
  },

  dismissDangerZoneAlert: (alertId) => {
    set((state) => ({
      dangerZoneAlerts: state.dangerZoneAlerts.filter((a) => a.id !== alertId),
      dismissedDangerAlertIds: state.dismissedDangerAlertIds.includes(alertId)
        ? state.dismissedDangerAlertIds
        : [...state.dismissedDangerAlertIds, alertId],
    }))
  },

  setSelectedEntity: (selectedEntity) => set({ selectedEntity }),
  setIsPickingLocationOnMap: (isPickingLocationOnMap) => set({ isPickingLocationOnMap }),
  setPickedLocation: (pickedLocation) => set({ pickedLocation }),
  setIsThreatModalOpen: (isThreatModalOpen) => set({ isThreatModalOpen }),
  setIsUserRegistrationModalOpen: (isUserRegistrationModalOpen) => set({ isUserRegistrationModalOpen }),
  setRegistrationModalTab: (registrationModalTab) => set({ registrationModalTab }),
  setSelectedZoneFilter: (selectedZoneFilter) => set({ selectedZoneFilter }),

  openAlertAtLocation: (lat, lon) =>
    set({
      pickedLocation: { lat, lon },
      isPickingLocationOnMap: false,
      isThreatModalOpen: true,
    }),

  dismissAlert: (threatId) => {
    set((state) => ({
      proximityAlerts: state.proximityAlerts.filter((t) => t.id !== threatId),
    }))
  },

  checkProximityAlerts: (userLat, userLon) => {
    const alerts = Object.values(get().threats).filter((th) => {
      if (th.status === 'inactive' || th.engagement_status === 'resolved') return false
      return calculateDistanceMeters(userLat, userLon, th.lat, th.lon) <= 2000
    })
    set({ proximityAlerts: alerts })
  },
}))
