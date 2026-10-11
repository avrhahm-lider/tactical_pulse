import { create } from 'zustand'
import { api } from '../services/api'
import type { MapSnapshot, Squad, Threat, SquadMovedPayload } from '../types'

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

  loadSnapshot: () => Promise<void>
  updateSquadPosition: (payload: SquadMovedPayload) => void
  removeSquad: (squadId: string) => void
  addOrUpdateThreat: (threat: Threat, currentUserId?: string) => void
  removeThreat: (threatId: string) => void
  setSelectedEntity: (entity: { type: 'squad' | 'threat'; id: string } | null) => void
  setIsPickingLocationOnMap: (isPicking: boolean) => void
  setPickedLocation: (loc: { lat: number; lon: number } | null) => void
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

  updateSquadPosition: (payload) => {
    set((state) => {
      const existing = state.squads[payload.id]
      if (!existing) return state
      return {
        squads: {
          ...state.squads,
          [payload.id]: {
            ...existing,
            lat: payload.lat,
            lon: payload.lon,
            heading: payload.heading,
            updated_at: payload.updated_at,
          },
        },
      }
    })
  },

  removeSquad: (squadId) => {
    set((state) => {
      const squads = { ...state.squads }
      delete squads[squadId]
      const selectedEntity =
        state.selectedEntity?.id === squadId ? null : state.selectedEntity
      return { squads, selectedEntity }
    })
  },

  addOrUpdateThreat: (threat, currentUserId) => {
    set((state) => {
      if (threat.status === 'inactive') {
        const threats = { ...state.threats }
        delete threats[threat.id]
        const proximityAlerts = state.proximityAlerts.filter((t) => t.id !== threat.id)
        return { threats, proximityAlerts }
      }

      const updatedThreats = { ...state.threats, [threat.id]: threat }
      let proximityAlerts = [...state.proximityAlerts]

      // Check proximity if current user is a squad on the map
      if (currentUserId && state.squads[currentUserId]) {
        const mySquad = state.squads[currentUserId]
        const dist = calculateDistanceMeters(mySquad.lat, mySquad.lon, threat.lat, threat.lon)
        if (dist <= 2000 && threat.engagement_status !== 'resolved') {
          if (!proximityAlerts.some((t) => t.id === threat.id)) {
            proximityAlerts.push(threat)
          }
        }
      }

      return { threats: updatedThreats, proximityAlerts }
    })
  },

  removeThreat: (threatId) => {
    set((state) => {
      const threats = { ...state.threats }
      delete threats[threatId]
      return {
        threats,
        proximityAlerts: state.proximityAlerts.filter((t) => t.id !== threatId),
      }
    })
  },

  setSelectedEntity: (selectedEntity) => set({ selectedEntity }),
  setIsPickingLocationOnMap: (isPickingLocationOnMap) => set({ isPickingLocationOnMap }),
  setPickedLocation: (pickedLocation) => set({ pickedLocation }),

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
