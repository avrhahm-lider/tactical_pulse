import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import L from 'leaflet'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import { api } from '../../services/api'
import type { Squad, Threat, User } from '../../types'
import { Crosshair, Maximize2 } from 'lucide-react'
import { getDroneSvgString, getOtherThreatSvgString } from '../Common/DroneIcon'

// Leaflet default icon fix
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Helper to check if marker is stale (>60s)
function isStale(updatedAt?: string): boolean {
  if (!updatedAt) return false
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  return diffMs > 60000
}

interface SectorConfig {
  name: string
  label: string
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
  color: string
  bounds: L.LatLngBoundsExpression
  center: [number, number]
}

const SECTOR_DEFS: Record<'North' | 'Center' | 'South', SectorConfig> = {
  North: {
    name: 'North',
    label: 'NORTHERN SECTOR (Lat ≥ 32.70)',
    minLat: 32.7,
    maxLat: 34.0,
    minLon: 34.0,
    maxLon: 36.2,
    color: '#00e5ff',
    bounds: [
      [32.7, 34.8],
      [33.35, 35.8],
    ],
    center: [33.0, 35.3],
  },
  Center: {
    name: 'Center',
    label: 'CENTRAL SECTOR (31.90 ≤ Lat < 32.70)',
    minLat: 31.9,
    maxLat: 32.7,
    minLon: 34.0,
    maxLon: 36.2,
    color: '#f59e0b',
    bounds: [
      [31.9, 34.5],
      [32.7, 35.4],
    ],
    center: [32.1, 34.8],
  },
  South: {
    name: 'South',
    label: 'SOUTHERN SECTOR (Lat < 31.90)',
    minLat: 29.0,
    maxLat: 31.9,
    minLon: 34.0,
    maxLon: 36.2,
    color: '#10b981',
    bounds: [
      [29.5, 34.5],
      [31.9, 35.4],
    ],
    center: [31.2, 34.7],
  },
}

// Check if an entity is a dynamic operational force (excluding static headquarters and radar)
function isDynamicForce(squad: Squad): boolean {
  return (
    squad.status !== 'inactive' &&
    squad.role !== 'AreaCommandCenter' &&
    squad.role !== 'MainCommandCenter' &&
    squad.role !== 'Radar'
  )
}

// Build tactical pop-up ("prop") HTML containing basic force details
function buildForcePopupHtml(squad: Squad, isStaleSignal: boolean): string {
  const isHQ = squad.role === 'AreaCommandCenter'
  const isRadar = squad.role === 'Radar'
  const isSapper = squad.role === 'SapperSquad'
  const isManager = squad.role === 'MainCommandCenter'

  const roleName = isHQ
    ? 'REGIONAL HQ'
    : isSapper
    ? 'SAPPER SQUAD'
    : isRadar
    ? 'RADAR SENSOR'
    : isManager
    ? 'SUPREME HQ'
    : 'TACTICAL SQUAD'

  const roleColor = isHQ
    ? '#c084fc'
    : isSapper
    ? '#f59e0b'
    : isRadar
    ? '#00e5ff'
    : isManager
    ? '#a855f7'
    : '#10b981'

  const soldiersCount = squad.soldiers ? squad.soldiers.length : 0

  return `
    <div class="tactical-prop-popup">
      <div class="prop-header">
        <span class="prop-dot" style="background: ${roleColor}; box-shadow: 0 0 8px ${roleColor};"></span>
        <span class="prop-title">${squad.name}</span>
        <span class="prop-badge" style="color: ${roleColor}; border-color: ${roleColor}60; background: ${roleColor}20;">${roleName}</span>
      </div>
      <div class="prop-body">
        <div class="prop-row">
          <span class="prop-label">SECTOR:</span>
          <span class="prop-val">${squad.area ? squad.area.toUpperCase() : 'UNKNOWN'}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">POSITION:</span>
          <span class="prop-val font-mono">${squad.lat.toFixed(5)}°, ${squad.lon.toFixed(5)}°</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">HEADING:</span>
          <span class="prop-val font-mono">${squad.heading || 0}°</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">TELEMETRY:</span>
          <span class="prop-val" style="color: ${isStaleSignal ? '#f59e0b' : '#10b981'}; font-weight: bold;">
            ${isStaleSignal ? 'SIGNAL STALE (>60s)' : 'ONLINE'}
          </span>
        </div>
        ${
          soldiersCount > 0
            ? `
        <div class="prop-row" style="margin-top: 3px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 3px;">
          <span class="prop-label">OPERATIVES:</span>
          <span class="prop-val">${soldiersCount} Soldiers</span>
        </div>
        <div style="font-size: 9px; color: #94a3b8; margin-top: 2px;">
          ${squad.soldiers.map((s) => `<div style="display: flex; justify-content: space-between;"><span>• ${s.name}</span><span style="color: #64748b;">${s.role}</span></div>`).join('')}
        </div>`
            : ''
        }
      </div>
      <div class="prop-footer">CLICK FORCE TO CLOSE</div>
    </div>
  `
}

// Build tactical pop-up panel HTML for threats (similar to team view, with relevant action buttons)
function buildThreatPopupHtml(
  threat: Threat,
  squads: Record<string, Squad>,
  user: User | null,
  isUnderIntrusion: boolean
): string {
  const isDrone = threat.threat_type === 'drone' || threat.name.toLowerCase().includes('drone')
  const assignedSquad = threat.assigned_to_id ? squads[threat.assigned_to_id] : null
  const radius = threat.radius || 150

  const isCommandCenter = user?.role === 'MainCommandCenter' || user?.role === 'AreaCommandCenter'
  const isSapper = user?.role === 'SapperSquad'
  const hasEODSpecialist =
    isSapper ||
    Boolean(user?.soldiers?.some((s) => s.role === 'sapper')) ||
    Boolean(user?.soldier?.role === 'sapper') ||
    isCommandCenter

  let statusLabel = 'UNASSIGNED HAZARD'
  let statusColor = '#ef4444'
  if (threat.engagement_status === 'in_progress') {
    statusLabel = 'ENGAGEMENT ACTIVE'
    statusColor = '#f59e0b'
  } else if (threat.engagement_status === 'resolved') {
    statusLabel = 'NEUTRALIZED'
    statusColor = '#10b981'
  }

  const badgeText = isDrone ? 'UAV DRONE' : 'THREAT HAZARD'

  // Action buttons inside panel
  let actionButtonsHtml = ''

  // 1. Take Responsibility (for EOD/sapper squads or units when unassigned)
  const canTakeResp = hasEODSpecialist && threat.engagement_status === 'unassigned' && user?.role !== 'Radar'
  if (canTakeResp) {
    actionButtonsHtml += `
      <button onclick="window.__tp_take_resp && window.__tp_take_resp('${threat.id}')"
        style="width: 100%; padding: 5px 8px; margin-top: 5px; background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; color: #fbbf24; border-radius: 4px; font-size: 10px; font-weight: bold; font-family: monospace; cursor: pointer; text-transform: uppercase;">
        ⚡ TAKE RESPONSIBILITY
      </button>
    `
  }

  // 2. Neutralize / Resolve (for EOD specialist when not resolved)
  const canNeutralize = hasEODSpecialist && threat.engagement_status !== 'resolved' && user?.role !== 'Radar'
  if (canNeutralize) {
    actionButtonsHtml += `
      <button onclick="window.__tp_resolve && window.__tp_resolve('${threat.id}')"
        style="width: 100%; padding: 5px 8px; margin-top: 4px; background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #34d399; border-radius: 4px; font-size: 10px; font-weight: bold; font-family: monospace; cursor: pointer; text-transform: uppercase;">
        ✓ NEUTRALIZE / RESOLVE
      </button>
    `
  }

  // 3. Remove / Archive Hazard (for Regional TOC or Main Command Center)
  const canArchive = isCommandCenter
  if (canArchive) {
    actionButtonsHtml += `
      <button onclick="window.__tp_archive && window.__tp_archive('${threat.id}')"
        style="width: 100%; padding: 5px 8px; margin-top: 4px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #f87171; border-radius: 4px; font-size: 10px; font-weight: bold; font-family: monospace; cursor: pointer; text-transform: uppercase;">
        ✕ REMOVE / ARCHIVE
      </button>
    `
  }

  // 4. View Full Details
  actionButtonsHtml += `
    <button onclick="window.__tp_details && window.__tp_details('${threat.id}')"
      style="width: 100%; padding: 4px 8px; margin-top: 4px; background: rgba(0, 229, 255, 0.15); border: 1px solid #00e5ff; color: #67e8f9; border-radius: 4px; font-size: 10px; font-weight: bold; font-family: monospace; cursor: pointer; text-transform: uppercase;">
      🔍 FULL INTEL REPORT
    </button>
  `

  return `
    <div class="tactical-prop-popup" style="min-width: 210px;">
      <div class="prop-header">
        <span class="prop-dot" style="background: ${statusColor}; box-shadow: 0 0 8px ${statusColor};"></span>
        <span class="prop-title">${threat.name}</span>
        <span class="prop-badge" style="color: ${statusColor}; border-color: ${statusColor}60; background: ${statusColor}20;">
          ${badgeText}
        </span>
      </div>
      <div class="prop-body">
        <div class="prop-row">
          <span class="prop-label">STATUS:</span>
          <span class="prop-val" style="color: ${statusColor}; font-weight: bold;">${statusLabel}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">CATEGORY:</span>
          <span class="prop-val">${threat.threat_type.toUpperCase()}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">POSITION:</span>
          <span class="prop-val font-mono">${threat.lat.toFixed(5)}°, ${threat.lon.toFixed(5)}°</span>
        </div>
        ${
          threat.altitude
            ? `
        <div class="prop-row">
          <span class="prop-label">ALTITUDE:</span>
          <span class="prop-val font-mono">${threat.altitude}m AGL</span>
        </div>`
            : ''
        }
        <div class="prop-row">
          <span class="prop-label">DANGER RADIUS:</span>
          <span class="prop-val font-mono">${radius}m (Subtle Boundary)</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">ASSIGNED UNIT:</span>
          <span class="prop-val" style="color: ${assignedSquad ? '#00e5ff' : '#94a3b8'};">
            ${assignedSquad ? assignedSquad.name : 'UNASSIGNED'}
          </span>
        </div>
        ${
          isUnderIntrusion
            ? `
        <div class="prop-row" style="color: #ff0033; font-weight: bold; font-size: 9px; margin-top: 2px;">
          <span>🚨 PERIMETER BREACH ACTIVE</span>
        </div>`
            : ''
        }
      </div>
      <div style="margin-top: 6px; padding-top: 5px; border-top: 1px solid rgba(255,255,255,0.1);">
        ${actionButtonsHtml}
      </div>
      <div class="prop-footer">CLICK ICON TO CLOSE</div>
    </div>
  `
}

// Calculate a safe Leaflet LatLngBounds representing a given radius around a point (in meters)
function getRadiusBounds(lat: number, lon: number, radiusMeters = 10000): L.LatLngBounds {
  const latDelta = radiusMeters / 111320
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const lonDelta = radiusMeters / (111320 * (cosLat === 0 ? 1 : Math.abs(cosLat)))
  return L.latLngBounds([
    [lat - latDelta, lon - lonDelta],
    [lat + latDelta, lon + lonDelta],
  ])
}

// Extract coordinates of all relevant active dynamic objects (ignoring static headquarters)
function getRelevantCoordinates(
  _user: User | null,
  zoneFilter: 'Global' | 'North' | 'Center' | 'South',
  squads: Record<string, Squad>,
  threats: Record<string, Threat>
): [number, number][] {
  const targetSector: 'Global' | 'North' | 'Center' | 'South' = zoneFilter || 'Global'

  const isSectorMatch = (lat: number) => {
    if (targetSector === 'Global') return true
    if (targetSector === 'North') return lat >= 32.70
    if (targetSector === 'Center') return lat >= 31.90 && lat < 32.70
    if (targetSector === 'South') return lat < 31.90
    return false
  }

  const points: [number, number][] = []

  // Add ONLY active dynamic forces (static objects like headquarters are completely ignored for zoom)
  Object.values(squads).forEach((sq) => {
    if (!isDynamicForce(sq)) return
    if (isSectorMatch(sq.lat)) {
      points.push([sq.lat, sq.lon])
    }
  })

  // Add active alerts / threats
  Object.values(threats).forEach((th) => {
    if (th.status === 'inactive') return
    if (isSectorMatch(th.lat)) {
      points.push([th.lat, th.lon])
    }
  })

  return points
}

export const TacticalMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const threatsLayerRef = useRef<L.LayerGroup | null>(null)
  const zonesLayerRef = useRef<L.LayerGroup | null>(null)
  const pinMarkerRef = useRef<L.Marker | null>(null)
  const squadMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const threatMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const svgRendererRef = useRef<L.SVG | null>(null)

  // Auto-fit mode toggle & programmatic movement guard
  const [isAutoFitMode, setIsAutoFitMode] = useState<boolean>(false)
  const isAutoFitModeRef = useRef<boolean>(false)
  const isProgrammaticMoveRef = useRef<boolean>(false)

  const {
    squads,
    threats,
    dangerZoneAlerts,
    isPickingLocationOnMap,
    pickedLocation,
    setIsPickingLocationOnMap,
    setSelectedEntity,
    openAlertAtLocation,
    selectedZoneFilter,
    setSelectedZoneFilter,
    addOrUpdateThreat,
    removeThreat,
  } = useMapStore()

  const { user } = useAuthStore()

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return

    // Center of Israel with Canvas renderer for max performance
    const map = L.map(mapContainerRef.current, {
      center: [31.5, 34.8],
      zoom: 8,
      minZoom: 6,
      maxZoom: 18,
      preferCanvas: true,
      zoomControl: false,
    })

    // Default view covers the entire map (all of Israel theater)
    map.fitBounds(
      [
        [29.5, 34.2],
        [33.4, 35.8],
      ],
      { padding: [30, 30] }
    )

    // Tactical dark base tiles (Esri Dark Gray - 100% Free, No API Key, No Watermark)
    const darkTiles = L.tileLayer(
      'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri &mdash; Tactical C2',
        maxZoom: 16,
      }
    )

    // Real satellite imagery layer (Esri World Imagery - Free, No API Key)
    const satelliteTiles = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri, Maxar &mdash; Satellite',
        maxZoom: 18,
      }
    )

    darkTiles.addTo(map)

    L.control
      .layers(
        {
          'Tactical Dark': darkTiles,
          'Satellite View': satelliteTiles,
        },
        undefined,
        { position: 'bottomleft' }
      )
      .addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    // Layers
    zonesLayerRef.current = L.layerGroup().addTo(map)
    threatsLayerRef.current = L.layerGroup().addTo(map)
    markersLayerRef.current = L.layerGroup().addTo(map)

    svgRendererRef.current = L.svg()

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
      svgRendererRef.current = null
      squadMarkersRef.current.clear()
    }
  }, [])

  // Handle Map Click: A threat is NOT added simply by clicking the map;
  // instead, one must first select "Open Alert" and choose the "Select from Map" option.
  // Clicking anywhere registers the coordinates directly without requiring an additional button press.
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (useMapStore.getState().isPickingLocationOnMap) {
        const { lat, lng } = e.latlng
        openAlertAtLocation(lat, lng)
      }
    }

    map.on('click', handleMapClick)
    return () => {
      map.off('click', handleMapClick)
    }
  }, [openAlertAtLocation])

  // Auto-adjust view to encompass the range between relevant objects in active sector (empty areas ignored)
  const autoAdjustView = useCallback(
    (animate = true, zoneOverride?: 'Global' | 'North' | 'Center' | 'South') => {
      const map = mapInstanceRef.current
      if (!map) return

      isProgrammaticMoveRef.current = true

      const activeZone = zoneOverride || selectedZoneFilter
      const points = getRelevantCoordinates(user, activeZone, squads, threats)

      if (points.length >= 2) {
        // Bounding box automatically spans from the first incident/unit to the last, ignoring empty zones
        const bounds = L.latLngBounds(points)
        if (animate) {
          map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 15, duration: 1.0 })
        } else {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
        }
      } else if (points.length === 1) {
        // Single object: focus on 10km radius around it using safe LatLngBounds
        const bounds = getRadiusBounds(points[0][0], points[0][1], 10000)
        if (animate) {
          map.flyToBounds(bounds, { padding: [20, 20], maxZoom: 13, duration: 1.0 })
        } else {
          map.fitBounds(bounds, { padding: [20, 20] })
        }
      } else {
        // Sector fallback if zero units or alerts currently exist in the active zone
        const targetSector =
          activeZone !== 'Global'
            ? activeZone
            : user?.role === 'AreaCommandCenter'
            ? (user.area as 'North' | 'Center' | 'South')
            : 'Global'

        if (targetSector && targetSector !== 'Global' && SECTOR_DEFS[targetSector]) {
          if (animate) {
            map.flyToBounds(SECTOR_DEFS[targetSector].bounds, {
              padding: [40, 40],
              maxZoom: 10,
              duration: 1.0,
            })
          } else {
            map.fitBounds(SECTOR_DEFS[targetSector].bounds, { padding: [40, 40], maxZoom: 10 })
          }
        } else {
          if (animate) {
            map.flyToBounds(
              [
                [29.5, 34.2],
                [33.4, 35.8],
              ],
              { padding: [30, 30], duration: 1.0 }
            )
          } else {
            map.fitBounds(
              [
                [29.5, 34.2],
                [33.4, 35.8],
              ],
              { padding: [30, 30] }
            )
          }
        }
      }
    },
    [user, selectedZoneFilter, squads, threats]
  )

  // Focus view on a 10km radius around a specific location (Force or Threat)
  const focusRadius10km = useCallback((lat: number, lon: number) => {
    const map = mapInstanceRef.current
    if (!map) return
    isProgrammaticMoveRef.current = true
    const bounds = getRadiusBounds(lat, lon, 10000)
    map.flyToBounds(bounds, { padding: [20, 20], maxZoom: 13, duration: 1.0 })
  }, [])

  // Toggle Auto-Fit view mode: When ON, focuses on sector/objects. When OFF, allows independent free navigation.
  const toggleAutoFit = useCallback(() => {
    setIsAutoFitMode((prev) => {
      const next = !prev
      isAutoFitModeRef.current = next
      if (next) {
        autoAdjustView(true)
      }
      return next
    })
  }, [autoAdjustView])

  // Handle Zone Selection: Updates zone filter and navigates to the zone
  const handleZoneSelect = useCallback(
    (zone: 'Global' | 'North' | 'Center' | 'South') => {
      setSelectedZoneFilter(zone)
      const map = mapInstanceRef.current
      if (!map) return

      isProgrammaticMoveRef.current = true

      if (isAutoFitModeRef.current) {
        autoAdjustView(true, zone)
      } else {
        if (zone === 'Global') {
          map.flyToBounds(
            [
              [29.5, 34.2],
              [33.4, 35.8],
            ],
            { padding: [30, 30], duration: 1.0 }
          )
        } else {
          const secDef = SECTOR_DEFS[zone]
          if (secDef) {
            map.flyToBounds(secDef.bounds, { padding: [40, 40], maxZoom: 10, duration: 1.0 })
          }
        }
      }
    },
    [setSelectedZoneFilter, autoAdjustView]
  )

  // Zoom Revert Listener: In "auto-fit view" mode, zooming in or out reverts view to auto-fit default
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    let revertTimer: ReturnType<typeof setTimeout> | null = null

    const handleZoomEnd = () => {
      if (isProgrammaticMoveRef.current) {
        return
      }
      if (isAutoFitModeRef.current) {
        if (revertTimer) clearTimeout(revertTimer)
        revertTimer = setTimeout(() => {
          autoAdjustView(true)
        }, 200)
      }
    }

    const handleMoveEnd = () => {
      if (isProgrammaticMoveRef.current) {
        setTimeout(() => {
          isProgrammaticMoveRef.current = false
        }, 150)
      }
    }

    map.on('zoomend', handleZoomEnd)
    map.on('moveend', handleMoveEnd)

    return () => {
      if (revertTimer) clearTimeout(revertTimer)
      map.off('zoomend', handleZoomEnd)
      map.off('moveend', handleMoveEnd)
    }
  }, [autoAdjustView])

  // Automatically adjust view signature: runs ONLY when auto-fit mode is ON and sector/squads change
  const relevantSignature = useMemo(() => {
    // Exclude threats so clicking, neutralizing, or closing a threat never alters map size or view bounds
    const points = getRelevantCoordinates(user, selectedZoneFilter, squads, {})
    return `${user?.role}_${selectedZoneFilter}_${points.length}_${points
      .map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)
      .join(';')}`
  }, [user, selectedZoneFilter, squads])

  const prevSignatureRef = useRef<string>('')

  useEffect(() => {
    if (isAutoFitMode && relevantSignature !== prevSignatureRef.current) {
      prevSignatureRef.current = relevantSignature
      autoAdjustView(true)
    }
  }, [isAutoFitMode, relevantSignature, autoAdjustView])

  // Render Operational Zones & Authorized Sector Visualizations
  useEffect(() => {
    const zonesLayer = zonesLayerRef.current
    if (!zonesLayer) return

    zonesLayer.clearLayers()

    const isFieldTeam = user?.role === 'Squad' || user?.role === 'SapperSquad'

    // Operational sector dividing lines drawn for command centers. Field teams see only their immediate range.
    if (!isFieldTeam) {
      // Draw Dividing Border Lines only (No colored frames / polygons)
      L.polyline(
        [
          [32.7, 33.5],
          [32.7, 36.5],
        ],
        { color: '#00e5ff', weight: 1.5, dashArray: '6, 6', opacity: 0.65 }
      ).addTo(zonesLayer)

      L.polyline(
        [
          [31.9, 33.5],
          [31.9, 36.5],
        ],
        { color: '#f59e0b', weight: 1.5, dashArray: '6, 6', opacity: 0.65 }
      ).addTo(zonesLayer)
    }

    if (
      user?.id &&
      squads[user.id] &&
      user.role !== 'MainCommandCenter' &&
      user.role !== 'AreaCommandCenter' &&
      user.role !== 'Radar'
    ) {
      const mySquad = squads[user.id]
      L.circle([mySquad.lat, mySquad.lon], {
        radius: 20000,
        color: '#00e5ff',
        fillColor: '#00e5ff',
        fillOpacity: 0.03,
        weight: 1.5,
        dashArray: '4, 6',
      })
        .bindTooltip('20 KM TACTICAL SENSOR HORIZON', {
          permanent: false,
          direction: 'top',
          className: 'tactical-tooltip',
        })
        .addTo(zonesLayer)
    }
  }, [user, selectedZoneFilter, squads])

  // Render Temporary Pin Placement Marker
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    if (pickedLocation) {
      if (pinMarkerRef.current) {
        pinMarkerRef.current.setLatLng([pickedLocation.lat, pickedLocation.lon])
      } else {
        const pinIcon = L.divIcon({
          className: 'custom-pin-marker',
          html: `
            <div style="transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;">
              <div style="background: #ef4444; color: white; padding: 2px 6px; font-size: 11px; font-weight: bold; border-radius: 4px; border: 1px solid white; box-shadow: 0 0 10px #ef4444;">
                SELECTED PIN
              </div>
              <div style="width: 14px; height: 14px; background: #ef4444; border-radius: 50%; border: 2px solid white; margin-top: 2px;"></div>
            </div>
          `,
          iconSize: [0, 0],
        })
        pinMarkerRef.current = L.marker([pickedLocation.lat, pickedLocation.lon], { icon: pinIcon }).addTo(map)
      }
    } else if (pinMarkerRef.current) {
      pinMarkerRef.current.remove()
      pinMarkerRef.current = null
    }
  }, [pickedLocation])

  // Render Squads, Radars & Regional Command Headquarters
  // Basic details about the force are displayed in a prop popup that moves with the object.
  // Clicking the object toggles the popup open/closed.
  useEffect(() => {
    const markersLayer = markersLayerRef.current
    if (!markersLayer) return

    const currentSquadIds = new Set(Object.keys(squads))

    // Remove any markers whose squad was removed
    for (const [id, marker] of squadMarkersRef.current.entries()) {
      if (!currentSquadIds.has(id)) {
        marker.remove()
        squadMarkersRef.current.delete(id)
      }
    }

    Object.values(squads).forEach((squad: Squad) => {
      // Do not display headquarters or radar on the map
      if (
        squad.role === 'AreaCommandCenter' ||
        squad.role === 'MainCommandCenter' ||
        squad.role === 'Radar'
      ) {
        if (squadMarkersRef.current.has(squad.id)) {
          squadMarkersRef.current.get(squad.id)?.remove()
          squadMarkersRef.current.delete(squad.id)
        }
        return
      }

      const isSapper = squad.role === 'SapperSquad'
      const isMe = user?.id === squad.id
      const stale = isStale(squad.updated_at)

      // Styling based on role
      let baseColor = isSapper ? '#f59e0b' : '#10b981'
      let roleLabel = isSapper ? 'SAPPER' : 'SQUAD'

      if (stale) {
        baseColor = '#6b7280' // Grey for stale signal
        roleLabel += ' (STALE)'
      }

      // Icon HTML
      const iconWidth = 36
      const iconHeight = 36

      const iconHtml = `
        <div style="position: relative; width: 36px; height: 36px; cursor: pointer; pointer-events: auto;">
          <div style="
            width: 36px;
            height: 36px;
            background: ${baseColor};
            border: 2px solid ${isMe ? '#ffffff' : 'rgba(255,255,255,0.7)'};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 ${isMe ? '16px #00e5ff' : '8px ' + baseColor};
            transform: rotate(${squad.heading || 0}deg);
            transition: transform 0.3s ease;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
            </svg>
          </div>
          <div style="
            position: absolute;
            top: 40px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(10, 15, 29, 0.9);
            color: ${stale ? '#9ca3af' : '#ffffff'};
            font-size: 10px;
            font-family: ui-monospace, monospace;
            padding: 1px 5px;
            border-radius: 3px;
            border: 1px solid ${baseColor};
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 2px 6px rgba(0,0,0,0.6);
          ">
            ${squad.name} [${roleLabel}]
          </div>
        </div>
      `

      const customIcon = L.divIcon({
        className: 'squad-marker-container',
        html: iconHtml,
        iconSize: [iconWidth, iconHeight],
        iconAnchor: [iconWidth / 2, iconHeight / 2],
      })

      const popupHtml = buildForcePopupHtml(squad, stale)

      let marker = squadMarkersRef.current.get(squad.id)

      if (marker) {
        // Smoothly updates marker location (Leaflet natively shifts the open popup with the marker)
        marker.setLatLng([squad.lat, squad.lon])
        marker.setIcon(customIcon)
        marker.setPopupContent(popupHtml)
      } else {
        const newMarker = L.marker([squad.lat, squad.lon], { icon: customIcon })
        newMarker.bindPopup(popupHtml, {
          className: 'tactical-force-popup',
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          offset: [0, -18],
        })

        // Unregister Leaflet's internal auto-open click handler so it doesn't conflict with our toggle
        newMarker.off(
          'click',
          (newMarker as unknown as { _openPopup: (e: L.LeafletMouseEvent) => void })._openPopup,
          newMarker
        )

        // Custom toggle on click: clicking the object opens pop-up; clicking it again closes it
        newMarker.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          newMarker.togglePopup()
          setSelectedEntity({ type: 'squad', id: squad.id })
          focusRadius10km(squad.lat, squad.lon)
        })

        newMarker.addTo(markersLayer)
        squadMarkersRef.current.set(squad.id, newMarker)
      }
    })
  }, [squads, user, setSelectedEntity, focusRadius10km])

  // Register global window handlers for actions triggered inside threat pop-up panels
  useEffect(() => {
    ;(window as unknown as { __tp_take_resp?: (threatId: string) => Promise<void> }).__tp_take_resp = async (
      threatId: string
    ) => {
      if (!user) return
      try {
        const updated = await api.threats.update(threatId, {
          engagement_status: 'in_progress',
          assigned_to_id: user.id,
        })
        addOrUpdateThreat(updated, user.id)
      } catch (err) {
        console.error('Failed to take responsibility for threat:', err)
      }
    }

    ;(window as unknown as { __tp_resolve?: (threatId: string) => Promise<void> }).__tp_resolve = async (
      threatId: string
    ) => {
      if (!user) return
      try {
        const updated = await api.threats.update(threatId, {
          engagement_status: 'resolved',
        })
        addOrUpdateThreat(updated, user.id)
      } catch (err) {
        console.error('Failed to resolve threat:', err)
      }
    }

    ;(window as unknown as { __tp_archive?: (threatId: string) => Promise<void> }).__tp_archive = async (
      threatId: string
    ) => {
      if (!user) return
      try {
        const updated = await api.threats.update(threatId, {
          status: 'inactive',
        })
        addOrUpdateThreat(updated, user.id)
        removeThreat(threatId)
      } catch (err) {
        console.error('Failed to archive threat:', err)
      }
    }

    ;(window as unknown as { __tp_details?: (threatId: string) => void }).__tp_details = (
      threatId: string
    ) => {
      setSelectedEntity({ type: 'threat', id: threatId })
    }

    return () => {
      delete (window as unknown as { __tp_take_resp?: unknown }).__tp_take_resp
      delete (window as unknown as { __tp_resolve?: unknown }).__tp_resolve
      delete (window as unknown as { __tp_archive?: unknown }).__tp_archive
      delete (window as unknown as { __tp_details?: unknown }).__tp_details
    }
  }, [user, addOrUpdateThreat, removeThreat, setSelectedEntity])

  // Render Threats: Icon-only markers, subtle unobtrusive border line (no area coloring), and toggleable action panels
  useEffect(() => {
    const threatsLayer = threatsLayerRef.current
    if (!threatsLayer) return

    // Clean up markers of threats that are no longer active
    const activeThreatIds = new Set(
      Object.values(threats)
        .filter((t) => t.status !== 'inactive')
        .map((t) => t.id)
    )

    for (const [id, marker] of threatMarkersRef.current.entries()) {
      if (!activeThreatIds.has(id)) {
        marker.remove()
        threatMarkersRef.current.delete(id)
      }
    }

    // Clear auxiliary dynamic vector layers (danger circles and breach lines)
    threatsLayer.clearLayers()

    Object.values(threats).forEach((threat: Threat) => {
      if (threat.status === 'inactive') return

      let threatColor = '#ef4444' // Red for unassigned
      if (threat.engagement_status === 'in_progress') {
        threatColor = '#f59e0b' // Yellow for in_progress
      } else if (threat.engagement_status === 'resolved') {
        threatColor = '#10b981' // Green for resolved
      }

      const isUnderIntrusion = dangerZoneAlerts.some((a) => a.threat_id === threat.id)
      const radius = threat.radius || 150
      const isDrone = threat.threat_type === 'drone' || threat.name.toLowerCase().includes('drone')
      const isRedZone = isUnderIntrusion || threat.engagement_status === 'unassigned' || threatColor === '#ef4444'

      // Subtle, unobtrusive border line for threat danger zone: NO area-based coloring (fill: false)
      L.circle([threat.lat, threat.lon], {
        radius,
        renderer: svgRendererRef.current || undefined,
        color: isUnderIntrusion ? '#ff0033' : threatColor,
        fill: false,
        fillOpacity: 0,
        weight: isUnderIntrusion ? 1.8 : 1.2,
        opacity: isUnderIntrusion ? 0.9 : 0.65,
        dashArray: isUnderIntrusion ? '4, 4' : '5, 5',
        interactive: false,
      }).addTo(threatsLayer)

      // If under active intrusion, draw dashed alert line to the endangered squad
      if (isUnderIntrusion) {
        dangerZoneAlerts
          .filter((a) => a.threat_id === threat.id)
          .forEach((alert) => {
            const sq = squads[alert.squad_id]
            if (sq) {
              L.polyline([[threat.lat, threat.lon], [sq.lat, sq.lon]], {
                color: '#ff0033',
                weight: 2,
                dashArray: '5, 5',
                opacity: 0.85,
              }).addTo(threatsLayer)
            }
          })
      }

      // Icon-only tactical marker: marked strictly by one of two icons (drone or other threats), NO text label
      const iconSize = 36
      const threatIconHtml = `
        <div style="
          position: relative;
          width: ${iconSize}px;
          height: ${iconSize}px;
          cursor: pointer;
          pointer-events: auto;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          ${
            isRedZone
              ? `
            <div style="
              position: absolute;
              left: 50%;
              top: 50%;
              transform: translate(-50%, -50%);
              width: 44px;
              height: 44px;
              border-radius: 50%;
              border: 1.5px solid ${isUnderIntrusion ? '#ff0033' : '#ef4444'};
              pointer-events: none;
              animation: danger-sonar-ring ${isUnderIntrusion ? '0.9s' : '2.2s'} cubic-bezier(0, 0.2, 0.8, 1) infinite;
            "></div>
          `
              : ''
          }
          <div style="
            position: relative;
            z-index: 2;
            width: 34px;
            height: 34px;
            background: rgba(10, 15, 29, 0.95);
            border: 2px solid ${isUnderIntrusion ? '#ff0033' : threatColor};
            border-radius: ${isDrone ? '50%' : '8px'};
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 ${isUnderIntrusion ? '16px #ef4444' : '8px ' + threatColor}80, 0 3px 8px rgba(0,0,0,0.8);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
          ">
            ${isDrone ? getDroneSvgString(20, '#ffffff') : getOtherThreatSvgString(20, '#ffffff')}
          </div>
        </div>
      `

      const threatIcon = L.divIcon({
        className: 'threat-marker-container',
        html: threatIconHtml,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconSize / 2, iconSize / 2],
      })

      const popupHtml = buildThreatPopupHtml(threat, squads, user, isUnderIntrusion)

      let marker = threatMarkersRef.current.get(threat.id)
      if (marker) {
        marker.setLatLng([threat.lat, threat.lon])
        marker.setIcon(threatIcon)
        marker.setPopupContent(popupHtml)
        if (!threatsLayer.hasLayer(marker)) {
          marker.addTo(threatsLayer)
        }
      } else {
        const newMarker = L.marker([threat.lat, threat.lon], { icon: threatIcon })
        newMarker.bindPopup(popupHtml, {
          className: 'tactical-force-popup',
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          offset: [0, -18],
        })

        // Unregister Leaflet's internal auto-open click handler so our custom toggle controls it
        newMarker.off(
          'click',
          (newMarker as unknown as { _openPopup: (e: L.LeafletMouseEvent) => void })._openPopup,
          newMarker
        )

        // Custom toggle on click: clicking the icon toggles the pop-up panel (without changing map size or zoom)
        newMarker.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          newMarker.togglePopup()
        })

        newMarker.addTo(threatsLayer)
        threatMarkersRef.current.set(threat.id, newMarker)
      }
    })
  }, [threats, squads, dangerZoneAlerts, user])

  return (
    <div className={`relative w-full h-full ${isPickingLocationOnMap ? 'cursor-crosshair' : ''}`}>
      {/* Map Target Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Auto-Fit Range HUD Button */}
      <div className="absolute top-4 left-4 z-[999] hud-panel px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl flex items-center space-x-2 font-mono text-xs">
        <button
          onClick={toggleAutoFit}
          title={
            isAutoFitMode
              ? 'Auto-Fit mode is ON (zooming in/out reverts to auto-fit default). Click to turn OFF for independent navigation.'
              : 'Auto-Fit mode is OFF (independent navigation enabled). Click to activate Auto-Fit view mode.'
          }
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded transition-all cursor-pointer text-[11px] font-bold border ${
            isAutoFitMode
              ? 'bg-cyan-950 border-cyan-500 text-cyan-300 shadow-md shadow-cyan-950/60'
              : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-300'
          }`}
        >
          <Maximize2 className={`w-3.5 h-3.5 ${isAutoFitMode ? 'text-cyan-400' : 'text-slate-400'}`} />
          <span>AUTO-FIT VIEW: {isAutoFitMode ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* Floating Map Zone View Switcher (Only visible to Command Centers) */}
      {(user?.role === 'MainCommandCenter' || user?.role === 'AreaCommandCenter') && (
        <div className="absolute top-4 right-4 z-[999] hud-panel px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl flex items-center space-x-1.5 font-mono text-xs">
          <span className="text-slate-400 font-bold mr-1 text-[11px]">ZONE:</span>
          {(['Global', 'North', 'Center', 'South'] as const).map((zone) => (
            <button
              key={zone}
              onClick={() => handleZoneSelect(zone)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer border ${
                selectedZoneFilter === zone
                  ? 'bg-cyan-950 border-cyan-500 text-cyan-300 shadow-md shadow-cyan-950/60'
                  : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border-slate-800'
              }`}
            >
              {zone.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Pin Drop Notice Bar when user is picking location */}
      {isPickingLocationOnMap && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] hud-panel px-6 py-2.5 rounded-lg border border-cyan-500/80 hud-glow-cyan flex items-center space-x-3 text-cyan-300 animate-pulse">
          <Crosshair className="w-4 h-4 text-cyan-400 animate-spin" />
          <span className="font-mono text-sm tracking-wide">
            CLICK ANYWHERE ON THE MAP TO SET THREAT/ALERT COORDINATES
          </span>
          <button
            onClick={() => setIsPickingLocationOnMap(false)}
            className="ml-3 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-600 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
