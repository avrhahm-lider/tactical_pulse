import { emitLocationUpdate, emitDroneLocationUpdate } from './socket'
import { useMapStore } from '../store/useMapStore'
import type { Threat } from '../types'

export type SquadDirection = 'up' | 'down' | 'left' | 'right'
export type DroneDirection = 'north' | 'south' | 'west' | 'east'
export type TrajectoryType = 'figure8' | 'orbit' | 'slalom'

interface DroneSimState {
  t: number
  centerLat: number
  centerLon: number
  centerAlt: number
  trajectoryType: TrajectoryType
  timer: ReturnType<typeof setInterval> | null
}

interface SquadSimState {
  currentIndex: number
  waypoints: Array<[number, number]>
  timer: ReturnType<typeof setInterval> | null
}

// Closed patrol waypoints for key units
const GOLANI_WAYPOINTS: Array<[number, number]> = [
  [32.0853, 34.7818],
  [32.1100, 34.8000],
  [32.1400, 34.8300],
  [32.1700, 34.8500],
  [32.1500, 34.8100],
  [32.1000, 34.7700],
  [32.0853, 34.7818],
]

const PARATROOPERS_WAYPOINTS: Array<[number, number]> = [
  [31.8900, 34.8100],
  [31.9300, 34.8300],
  [31.9600, 34.8700],
  [32.0000, 34.8900],
  [32.0200, 34.8400],
  [31.9800, 34.8000],
  [31.9200, 34.7800],
  [31.8900, 34.8100],
]

function calculateHeading(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180)
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon)
  const brng = (Math.atan2(y, x) * 180) / Math.PI
  return Math.round((brng + 360) % 360)
}

class SimulationEngine {
  private squadSims = new Map<string, SquadSimState>()
  private droneSims = new Map<string, DroneSimState>()
  private masterActive = false
  private listeners = new Set<() => void>()

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    this.listeners.forEach((l) => l())
  }

  // ==========================================
  // SQUAD OPERATIONS
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
  }

  public startSquadLive(squadId: string, routeKey?: string): void {
    this.stopSquadLive(squadId)

    const store = useMapStore.getState()
    const squad = store.squads[squadId]
    let waypoints: Array<[number, number]>

    if (routeKey === 'golani' || (squad && squad.name.toLowerCase().includes('golani'))) {
      waypoints = GOLANI_WAYPOINTS
    } else if (
      routeKey === 'paratroopers' ||
      (squad && (squad.name.toLowerCase().includes('paratrooper') || squad.role === 'SapperSquad'))
    ) {
      waypoints = PARATROOPERS_WAYPOINTS
    } else {
      // Procedural fallback loop around current squad location
      const cLat = squad ? squad.lat : 32.0853
      const cLon = squad ? squad.lon : 34.7818
      const r = 0.004
      waypoints = [
        [cLat, cLon],
        [cLat + r, cLon],
        [cLat + r, cLon + r],
        [cLat, cLon + r],
        [cLat - r, cLon + r],
        [cLat - r, cLon],
        [cLat, cLon],
      ]
    }

    let currentIndex = 0
    const timer = setInterval(() => {
      const nextIndex = (currentIndex + 1) % waypoints.length
      const [curLat, curLon] = waypoints[currentIndex]
      const [targetLat, targetLon] = waypoints[nextIndex]

      const heading = calculateHeading(curLat, curLon, targetLat, targetLon)
      emitLocationUpdate(targetLat, targetLon, heading, squadId)

      store.updateSquadPosition({
        id: squadId,
        lat: targetLat,
        lon: targetLon,
        heading,
        updated_at: new Date().toISOString(),
      })

      currentIndex = nextIndex
    }, 2000)

    this.squadSims.set(squadId, {
      currentIndex,
      waypoints,
      timer,
    })

    this.notify()
  }

  public stopSquadLive(squadId: string): void {
    const sim = this.squadSims.get(squadId)
    if (sim?.timer) {
      clearInterval(sim.timer)
    }
    this.squadSims.delete(squadId)
    this.notify()
  }

  public isSquadLive(squadId: string): boolean {
    return this.squadSims.has(squadId)
  }

  // ==========================================
  // DRONE OPERATIONS
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
  }

  public startDroneLive(
    droneId: string,
    trajectoryType?: TrajectoryType
  ): void {
    this.stopDroneLive(droneId)

    const store = useMapStore.getState()
    const drone = store.threats[droneId]
    if (!drone) return

    const centerLat = drone.lat
    const centerLon = drone.lon
    const centerAlt = drone.altitude || 300

    let chosenType: TrajectoryType = trajectoryType || 'orbit'
    if (!trajectoryType) {
      const lower = drone.name.toLowerCase()
      if (lower.includes('alpha') || lower.includes('figure')) {
        chosenType = 'figure8'
      } else if (lower.includes('bravo') || lower.includes('orbit')) {
        chosenType = 'orbit'
      } else if (lower.includes('charlie') || lower.includes('slalom')) {
        chosenType = 'slalom'
      }
    }

    let t = 0
    // Tick interval 500ms (within 400ms-600ms requirement)
    const timer = setInterval(() => {
      t += 0.08
      let nextLat = centerLat
      let nextLon = centerLon
      let nextAlt = centerAlt

      switch (chosenType) {
        case 'figure8':
          // Lemniscate / Figure-8 pattern, altitude between 350m and 450m
          nextLat = centerLat + 0.008 * Math.sin(t)
          nextLon = centerLon + 0.012 * Math.sin(t) * Math.cos(t)
          nextAlt = Math.round(400 + 50 * Math.sin(2 * t))
          break

        case 'orbit':
          // Elliptical Orbital Sweep at altitude ~320m
          nextLat = centerLat + 0.010 * Math.cos(t)
          nextLon = centerLon + 0.010 * Math.sin(t)
          nextAlt = 320
          break

        case 'slalom':
          // Tactical Slalom / Intercept at altitude 180m–260m
          nextLat = centerLat + 0.006 * Math.cos(3 * t)
          nextLon = centerLon + 0.015 * Math.sin(t)
          nextAlt = Math.round(220 + 40 * Math.cos(t))
          break
      }

      emitDroneLocationUpdate(droneId, nextLat, nextLon, nextAlt)
      store.addOrUpdateThreat({
        ...drone,
        lat: nextLat,
        lon: nextLon,
        altitude: nextAlt,
        updated_at: new Date().toISOString(),
      })
    }, 500)

    this.droneSims.set(droneId, {
      t,
      centerLat,
      centerLon,
      centerAlt,
      trajectoryType: chosenType,
      timer,
    })

    this.notify()
  }

  public stopDroneLive(droneId: string): void {
    const sim = this.droneSims.get(droneId)
    if (sim?.timer) {
      clearInterval(sim.timer)
    }
    this.droneSims.delete(droneId)
    this.notify()
  }

  public isDroneLive(droneId: string): boolean {
    return this.droneSims.has(droneId)
  }

  public startAllDronesLive(drones: Threat[]): void {
    const droneList = drones.filter(
      (d) => d.threat_type === 'drone' && d.status === 'active'
    )
    droneList.forEach((drone, idx) => {
      const type: TrajectoryType =
        idx % 3 === 0 ? 'figure8' : idx % 3 === 1 ? 'orbit' : 'slalom'
      this.startDroneLive(drone.id, type)
    })
    this.notify()
  }

  public stopAllDronesLive(): void {
    this.droneSims.forEach((sim) => {
      if (sim.timer) clearInterval(sim.timer)
    })
    this.droneSims.clear()
    this.notify()
  }

  // ==========================================
  // MASTER SIMULATION (ADMIN)
  // ==========================================

  public startMasterSimulation(
    squads: Record<string, any>,
    drones: Threat[]
  ): void {
    this.stopMasterSimulation()
    this.masterActive = true

    // Launch all active combat squads
    Object.values(squads).forEach((sq) => {
      if (sq.status === 'active' && (sq.role === 'Squad' || sq.role === 'SapperSquad')) {
        this.startSquadLive(sq.id)
      }
    })

    // Launch all active drones
    this.startAllDronesLive(drones)
    this.notify()
  }

  public stopMasterSimulation(): void {
    this.masterActive = false

    this.squadSims.forEach((sim) => {
      if (sim.timer) clearInterval(sim.timer)
    })
    this.squadSims.clear()

    this.stopAllDronesLive()
    this.notify()
  }

  public isMasterLive(): boolean {
    return this.masterActive
  }
}

export const simulationEngine = new SimulationEngine()
