import type { Squad, User } from '../types'

/**
 * Checks if a squad entity is a static Headquarters or Radar installation.
 */
export function isHQOrRadar(squad: Squad): boolean {
  return (
    squad.role === 'AreaCommandCenter' ||
    squad.role === 'MainCommandCenter' ||
    squad.role === 'Radar'
  )
}

/**
 * Checks if a squad is actively transmitting telemetry.
 */
export function isSquadTransmitting(
  squad: Squad,
  currentUser?: User | null,
  allSquads?: Squad[]
): boolean {
  if (isHQOrRadar(squad)) {
    return false
  }
  if (squad.status !== 'active') {
    return false
  }

  // Current logged in field squad is actively transmitting
  if (currentUser && currentUser.id === squad.id) {
    return true
  }

  // Telemetry received within last 60 seconds
  if (squad.updated_at) {
    const diffMs = Date.now() - new Date(squad.updated_at).getTime()
    if (diffMs < 60000) {
      return true
    }
  }

  // Fallback: If no socket movement in <60s yet, identify the single primary active transmitter
  if (allSquads) {
    const fieldUnits = allSquads.filter(
      (s) => s.status === 'active' && !isHQOrRadar(s)
    )
    if (fieldUnits.length > 0 && fieldUnits[0].id === squad.id) {
      const anyRecent = fieldUnits.some(
        (s) =>
          s.updated_at && Date.now() - new Date(s.updated_at).getTime() < 60000
      )
      if (!anyRecent) {
        return true
      }
    }
  }

  return false
}

/**
 * Counts the active transmitting field units (excluding static headquarters and radar).
 */
export function getActiveTransmittingCount(
  squads: Record<string, Squad> | Squad[],
  currentUser?: User | null
): number {
  const squadList = Array.isArray(squads) ? squads : Object.values(squads)
  const fieldUnits = squadList.filter(
    (s) => s.status === 'active' && !isHQOrRadar(s)
  )

  if (fieldUnits.length === 0) return 0

  const transmitting = fieldUnits.filter((s) =>
    isSquadTransmitting(s, currentUser, fieldUnits)
  )

  return transmitting.length > 0 ? transmitting.length : 1
}

/**
 * Counts all active online connections in the roster (everyone in the system).
 */
export function getOnlineRosterCount(
  squads: Record<string, Squad> | Squad[]
): number {
  const squadList = Array.isArray(squads) ? squads : Object.values(squads)
  return squadList.filter((s) => s.status === 'active').length
}
