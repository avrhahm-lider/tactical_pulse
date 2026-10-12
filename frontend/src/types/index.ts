// Tactical Pulse — TypeScript Domain & API Types

export type UserRole =
  | 'MainCommandCenter'
  | 'AreaCommandCenter'
  | 'Squad'
  | 'SapperSquad'
  | 'Radar'

export type Area = 'North' | 'Center' | 'South' | 'Global'

export type UserStatus = 'active' | 'inactive'

export interface User {
  id: string
  username: string
  role: UserRole
  area: Area
  name: string
  description?: string
  status: UserStatus
  soldier_id?: string | null
  soldier?: { id: string; name: string; role: string; squad_id?: string | null; user_id?: string | null } | null
  is_logged_in?: boolean
  last_activity_at?: string
  lat?: number | null
  lon?: number | null
  soldiers?: Soldier[]
  created_at?: string
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface Soldier {
  id: string // exactly 7 digits
  name: string
  role: 'rifleman' | 'sapper' | 'medic' | 'recon' | 'commander' | string
  squad_id?: string | null
  user_id?: string | null
}

export interface Squad {
  id: string
  name: string
  description?: string
  role: UserRole
  area: Area
  lat: number
  lon: number
  heading: number
  status: UserStatus
  updated_at?: string
  soldiers: Soldier[]
}

export type ThreatType = 'immovable' | 'movable'

export type ThreatCategory = 'explosive' | 'vehicle' | 'drone' | 'personnel'

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical'

export type EngagementStatus = 'unassigned' | 'in_progress' | 'resolved'

export interface Threat {
  id: string
  type: ThreatType
  name: string
  description?: string
  threat_type: ThreatCategory
  severity_level: SeverityLevel
  engagement_status: EngagementStatus
  assigned_to_id: string | null
  radius: number
  lat: number
  lon: number
  altitude: number | null
  status: 'active' | 'inactive'
  created_by_id?: string
  created_by_soldier_id?: string | null
  created_by_soldier_name?: string | null
  created_by_unit_name?: string | null
  created_at?: string
  updated_at?: string
}

export interface MapSnapshot {
  squads: Squad[]
  threats: Threat[]
}

export interface LocationUpdatePayload {
  lat: number
  lon: number
  heading: number
}

export interface SquadMovedPayload {
  id: string
  lat: number
  lon: number
  heading: number
  updated_at: string
}

export interface UnitStatusChangedPayload {
  id: string
  status: UserStatus
}

export interface DangerZoneAlert {
  id: string
  threat_id: string
  threat_name: string
  threat_type: string
  severity_level: string
  squad_id: string
  squad_name: string
  distance_meters: number
  danger_radius_meters: number
  message: string
  timestamp?: number
}

export interface ApiError {
  error: {
    code: string
    message: string
    status: number
    details: Record<string, unknown>
  }
}

