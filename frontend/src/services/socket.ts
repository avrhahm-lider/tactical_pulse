import { io, Socket } from 'socket.io-client'
import { useMapStore } from '../store/useMapStore'
import type { SquadMovedPayload, Threat, UnitStatusChangedPayload } from '../types'

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || 'https://tactical-pulse-1.onrender.com'

let socket: Socket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

export function connectSocket(token: string, currentUserId?: string): Socket {
  if (socket?.connected) {
    return socket
  }

  socket = io(SOCKET_URL, {
    auth: {
      token: `Bearer ${token}`,
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    transports: ['websocket', 'polling'],
  })

  socket.on('connect', () => {
    // Start heartbeat every 30s
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      if (socket?.connected) {
        socket.emit('heartbeat', {})
      }
    }, 30000)

    // Re-sync full map snapshot on connect / reconnect
    useMapStore.getState().loadSnapshot()
  })

  socket.on('disconnect', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  })

  // Listeners matching API_CONTRACT.md
  socket.on('squad_moved', (payload: SquadMovedPayload) => {
    useMapStore.getState().updateSquadPosition(payload, currentUserId)
  })

  socket.on('threat_created', (payload: Threat) => {
    useMapStore.getState().addOrUpdateThreat(payload, currentUserId)
  })

  socket.on('threat_updated', (payload: Threat) => {
    useMapStore.getState().addOrUpdateThreat(payload, currentUserId)
  })

  socket.on('threat_removed', (payload: { id: string }) => {
    useMapStore.getState().removeThreat(payload.id)
  })

  socket.on('danger_zone_alert', (payload: any) => {
    useMapStore.getState().addDangerZoneAlert(payload)
  })

  socket.on('danger_zone_cleared', (payload: { id: string }) => {
    useMapStore.getState().dismissDangerZoneAlert(payload.id)
  })

  socket.on('unit_status_changed', (payload: UnitStatusChangedPayload) => {
    if (payload.status === 'inactive' || payload.status === 'deleted') {
      useMapStore.getState().removeSquad(payload.id)
    } else if (payload.status === 'active' || payload.status === 'created') {
      useMapStore.getState().loadSnapshot()
    }
  })

  return socket
}

export function disconnectSocket(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

export function emitLocationUpdate(lat: number, lon: number, heading: number, squadId?: string): void {
  if (socket?.connected) {
    const payload: { lat: number; lon: number; heading: number; squad_id?: string } = { lat, lon, heading }
    if (squadId) {
      payload.squad_id = squadId
    }
    socket.emit('location_update', payload)
  }
}

export function emitDroneLocationUpdate(threatId: string, lat: number, lon: number, altitude: number): void {
  if (socket?.connected) {
    socket.emit('drone_location_update', {
      threat_id: threatId,
      lat,
      lon,
      altitude,
    })
  }
}
