import { emitLocationUpdate, emitDroneLocationUpdate } from './socket'
import { useMapStore } from '../store/useMapStore'

export type SquadDirection = 'up' | 'down' | 'left' | 'right'
export type DroneDirection = 'north' | 'south' | 'west' | 'east'

class SimulationEngine {
  private listeners = new Set<() => void>()

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public notify(): void {
    this.listeners.forEach((l) => l())
  }

  // ==========================================
  // SQUAD OPERATIONS (MANUAL D-PAD)
  // ==========================================

  public stepSquad(
    squadId: string,
    direction: SquadDirection,
    delta: number = 0.0004
  ): void {
    const store = useMapStore.getState()
    const squad = store.squads[squadId]
    const curLat = squad ? squad.lat : 32.0853
    const curLon = squad ? squad.lon : 34.7818

    let dLat = 0
    let dLon = 0
    let heading = squad?.heading || 0

    switch (direction) {
      case 'up':
        dLat = delta
        heading = 0
        break
      case 'down':
        dLat = -delta
        heading = 180
        break
      case 'left':
        dLon = -delta
        heading = 270
        break
      case 'right':
        dLon = delta
        heading = 90
        break
    }

    const nextLat = curLat + dLat
    const nextLon = curLon + dLon

    emitLocationUpdate(nextLat, nextLon, heading, squadId)
    store.updateSquadPosition({
      id: squadId,
      lat: nextLat,
      lon: nextLon,
      heading,
      updated_at: new Date().toISOString(),
    })
    this.notify()
  }

  // ==========================================
  // DRONE OPERATIONS (MANUAL D-PAD)
  // ==========================================

  public stepDrone(
    droneId: string,
    direction: DroneDirection,
    altDelta: number = 0
  ): void {
    const store = useMapStore.getState()
    const drone = store.threats[droneId]
    if (!drone) return

    let dLat = 0
    let dLon = 0
    const stepDist = 0.0006 // ~60m

    switch (direction) {
      case 'north':
        dLat = stepDist
        break
      case 'south':
        dLat = -stepDist
        break
      case 'west':
        dLon = -stepDist
        break
      case 'east':
        dLon = stepDist
        break
    }

    const nextLat = drone.lat + dLat
    const nextLon = drone.lon + dLon
    const nextAlt = Math.max(50, (drone.altitude ?? 300) + altDelta)

    emitDroneLocationUpdate(droneId, nextLat, nextLon, nextAlt)
    store.addOrUpdateThreat({
      ...drone,
      lat: nextLat,
      lon: nextLon,
      altitude: nextAlt,
      updated_at: new Date().toISOString(),
    })
    this.notify()
  }
}

export const simulationEngine = new SimulationEngine()
