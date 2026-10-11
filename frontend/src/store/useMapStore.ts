import { create } from 'zustand'
import { api } from '../services/api'
import type { MapSnapshot, Squad, Threat, SquadMovedPayload, DangerZoneAlert } from '../types'

// Haversine distance in meters
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

interface MapState {
  squads: Record<string, Squad>
  threats: Record<string, Threat>
  isLoading: boolean
  error: string | null
  selectedEntity: { type: 'squad' | 'threat'; id: string } | null
  isPickingLocationOnMap: boolean
  pickedLocation: { lat: number; lon: number } | null
  proximityAlerts: Threat[]
  dangerZoneAlerts: DangerZoneAlert[]
  dismissedDangerAlertIds: string[]
  isThreatModalOpen: boolean
  selectedZoneFilter: 'Global' | 'North' | 'Center' | 'South'

  loadSnapshot: () => Promise<void>
  updateSquadPosition: (payload: SquadMovedPayload, currentUserId?: string) => void
  removeSquad: (squadId: string) => void
  addOrUpdateThreat: (threat: Threat, currentUserId?: string) => void
  removeThreat: (threatId: string) => void
  addDangerZoneAlert: (alert: DangerZoneAlert) => void
  dismissDangerZoneAlert: (alertId: string) => void
  setSelectedEntity: (entity: { type: 'squad' | 'threat'; id: string } | null) => void
  setIsPickingLocationOnMap: (isPicking: boolean) => void
  setPickedLocation: (loc: { lat: number; lon: number } | null) => void
  setIsThreatModalOpen: (isOpen: boolean) => void
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
  isPickingLocationOnMap: false,
  pickedLocation: null,
  proximityAlerts: [],
  dangerZoneAlerts: [],
  dismissedDangerAlertIds: [],
  isThreatModalOpen: false,
  selectedZoneFilter: 'Global',

  loadSnapshot: async () => {
    set({ isLoading: true, error: null })
    try {
      const snapshot: MapSnapshot = await api.map.getSnapshot()
      const squadMap: Record<string, Squad> = {}
      snapshot.squads.forEach((sq) => {
        squadMap[sq.id] = sq
      })

      const threatMap: Record<string, Threat> = {}
      snapshot.threats.forEach((th) => {
        threatMap[th.id] = th
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

      const updatedSquads = {
        ...state.squads,
        [payload.id]: updatedSquad,
      }

      let updatedDangerAlerts = [...state.dangerZoneAlerts]
      let updatedDismissedIds = [...state.dismissedDangerAlertIds]

      // Only check danger & proximity alerts for the CURRENT squad unit
      if (currentUserId && currentUserId === payload.id) {
        Object.values(state.threats).forEach((threat) => {
          if (threat.status === 'inactive' || threat.engagement_status === 'resolved') {
            return
          }

          const dist = calculateDistanceMeters(payload.lat, payload.lon, threat.lat, threat.lon)
          const dangerRadius = threat.radius || 150.0
          const alertKey = `${payload.id}_${threat.id}`

          if (dist <= dangerRadius) {
            // Only add if not dismissed by user during this intrusion
            if (!updatedDismissedIds.includes(alertKey)) {
              const existingAlertIndex = updatedDangerAlerts.findIndex((a) => a.id === alertKey)
              const alertObj: DangerZoneAlert = {
                id: alertKey,
                threat_id: threat.id,
                threat_name: threat.name,
                threat_type: threat.threat_type,
                severity_level: threat.severity_level,
                squad_id: payload.id,
                squad_name: updatedSquad.name,
                distance_meters: Math.round(dist),
                danger_radius_meters: dangerRadius,
                message: `CRITICAL ALERT: ${updatedSquad.name} is INSIDE danger perimeter of ${threat.name} (${Math.round(dist)}m <= ${dangerRadius}m)!`,
                timestamp: Date.now(),
              }

              if (existingAlertIndex >= 0) {
                updatedDangerAlerts[existingAlertIndex] = alertObj
              } else {
                updatedDangerAlerts.push(alertObj)
              }
            }
          } else {
            // Left danger zone: remove alert and reset dismissal
            updatedDangerAlerts = updatedDangerAlerts.filter((a) => a.id !== alertKey)
            updatedDismissedIds = updatedDismissedIds.filter((k) => k !== alertKey)
          }
        })
      }

      return {
        squads: updatedSquads,
        dangerZoneAlerts: updatedDangerAlerts,
        proximityAlerts: [],
        dismissedDangerAlertIds: updatedDismissedIds,
      }
    })
  },

  removeSquad: (squadId) => {
    set((state) => {
      const squads = { ...state.squads }
      delete squads[squadId]
      const selectedEntity =
        state.selectedEntity?.id === squadId ? null : state.selectedEntity
      return {
        squads,
        selectedEntity,
        dangerZoneAlerts: state.dangerZoneAlerts.filter((a) => a.squad_id !== squadId),
      }
    })
  },

  addOrUpdateThreat: (threat, currentUserId) => {
    set((state) => {
      if (threat.status === 'inactive') {
        const threats = { ...state.threats }
        delete threats[threat.id]
        return {
          threats,
          proximityAlerts: state.proximityAlerts.filter((t) => t.id !== threat.id),
          dangerZoneAlerts: state.dangerZoneAlerts.filter((a) => a.threat_id !== threat.id),
        }
      }

      const updatedThreats = { ...state.threats, [threat.id]: threat }
      let updatedDangerAlerts = [...state.dangerZoneAlerts]
      let updatedDismissedIds = [...state.dismissedDangerAlertIds]

      // Only check danger & proximity alerts for the CURRENT squad unit
      if (currentUserId && state.squads[currentUserId]) {
        const squad = state.squads[currentUserId]
        const dist = calculateDistanceMeters(squad.lat, squad.lon, threat.lat, threat.lon)
        const dangerRadius = threat.radius || 150.0
        const alertKey = `${squad.id}_${threat.id}`

        if (dist <= dangerRadius && threat.engagement_status !== 'resolved') {
          if (!updatedDismissedIds.includes(alertKey)) {
            const existingAlertIndex = updatedDangerAlerts.findIndex((a) => a.id === alertKey)
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

            if (existingAlertIndex >= 0) {
              updatedDangerAlerts[existingAlertIndex] = alertObj
            } else {
              updatedDangerAlerts.push(alertObj)
            }
          }
        } else {
          updatedDangerAlerts = updatedDangerAlerts.filter((a) => a.id !== alertKey)
          updatedDismissedIds = updatedDismissedIds.filter((k) => k !== alertKey)
        }
      }

      return {
        threats: updatedThreats,
        dangerZoneAlerts: updatedDangerAlerts,
        proximityAlerts: [],
        dismissedDangerAlertIds: updatedDismissedIds,
      }
    })
  },

  removeThreat: (threatId) => {
    set((state) => {
      const threats = { ...state.threats }
      delete threats[threatId]
      return {
        threats,
        proximityAlerts: state.proximityAlerts.filter((t) => t.id !== threatId),
        dangerZoneAlerts: state.dangerZoneAlerts.filter((a) => a.threat_id !== threatId),
        dismissedDangerAlertIds: state.dismissedDangerAlertIds.filter((id) => !id.endsWith(`_${threatId}`)),
      }
    })
  },

  addDangerZoneAlert: (alert) => {
    set((state) => {
      if (state.dismissedDangerAlertIds.includes(alert.id)) {
        return state
      }
      const existingIdx = state.dangerZoneAlerts.findIndex((a) => a.id === alert.id)
      if (existingIdx >= 0) {
        const next = [...state.dangerZoneAlerts]
        next[existingIdx] = alert
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
    const threats = Object.values(get().threats)
    const alerts = threats.filter((th) => {
      if (th.status === 'inactive' || th.engagement_status === 'resolved') return false
      const dist = calculateDistanceMeters(userLat, userLon, th.lat, th.lon)
      return dist <= 2000
    })
    set({ proximityAlerts: alerts })
  },
}))
