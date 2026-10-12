import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import L from 'leaflet'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import type { Squad, Threat, User } from '../../types'
import { Crosshair, Maximize2 } from 'lucide-react'

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

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
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

  // Automatically adjust view signature: runs ONLY when auto-fit mode is ON and sector/objects change
  const relevantSignature = useMemo(() => {
    const points = getRelevantCoordinates(user, selectedZoneFilter, squads, threats)
    return `${user?.role}_${selectedZoneFilter}_${points.length}_${points
      .map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)
      .join(';')}`
  }, [user, selectedZoneFilter, squads, threats])

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

    const isManager = user?.role === 'MainCommandCenter'
    const authorizedArea = user?.area as 'North' | 'Center' | 'South' | 'Global'

    // 1. Draw Dividing Lines
    // North boundary at 32.7000
    L.polyline(
      [
        [32.7, 33.8],
        [32.7, 36.2],
      ],
      { color: '#00e5ff', weight: 2, dashArray: '6, 6', opacity: 0.8 }
    )
      .bindTooltip('NORTHERN SECTOR BOUNDARY (Lat 32.70)', {
        permanent: true,
        direction: 'top',
        className: 'tactical-tooltip',
      })
      .addTo(zonesLayer)

    // Center/South boundary at 31.9000
    L.polyline(
      [
        [31.9, 33.8],
        [31.9, 36.2],
      ],
      { color: '#f59e0b', weight: 2, dashArray: '6, 6', opacity: 0.8 }
    )
      .bindTooltip('SOUTHERN SECTOR BOUNDARY (Lat 31.90)', {
        permanent: true,
        direction: 'bottom',
        className: 'tactical-tooltip-amber',
      })
      .addTo(zonesLayer)

    // 2. Render Sector Boundary Polygons
    ;(Object.keys(SECTOR_DEFS) as Array<'North' | 'Center' | 'South'>).forEach((secKey) => {
      const sec = SECTOR_DEFS[secKey]
      const polygonCoords: [number, number][] = [
        [sec.minLat, sec.minLon],
        [sec.maxLat, sec.minLon],
        [sec.maxLat, sec.maxLon],
        [sec.minLat, sec.maxLon],
      ]

      const isFocused = isManager && selectedZoneFilter === secKey
      const isAuthorized = isManager || authorizedArea === secKey

      const poly = L.polygon(polygonCoords, {
        color: isAuthorized ? sec.color : '#334155',
        weight: isFocused ? 3 : isAuthorized ? 2 : 1.2,
        fillColor: isAuthorized ? sec.color : '#000000',
        fillOpacity: isFocused ? 0.16 : isAuthorized ? 0.08 : 0.28,
        dashArray: isAuthorized ? undefined : '5, 5',
        interactive: false,
      })

      poly.addTo(zonesLayer)
    })

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

  // Render Threats with Danger Radius buffer circle (150m)
  useEffect(() => {
    const threatsLayer = threatsLayerRef.current
    if (!threatsLayer) return

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

      // Draw danger buffer circle (default 150m)
      L.circle([threat.lat, threat.lon], {
        radius,
        color: isUnderIntrusion ? '#ff0033' : threatColor,
        fillColor: isUnderIntrusion ? '#ff0033' : threatColor,
        fillOpacity: isUnderIntrusion ? 0.38 : (threat.engagement_status === 'resolved' ? 0.08 : 0.22),
        weight: isUnderIntrusion ? 3 : 1.5,
        dashArray: isUnderIntrusion ? '4, 4' : (threat.engagement_status === 'in_progress' ? '5, 5' : undefined),
      }).addTo(threatsLayer)

      // If under active intrusion, draw dashed tactical alert line to the endangered squad
      if (isUnderIntrusion) {
        dangerZoneAlerts
          .filter((a) => a.threat_id === threat.id)
          .forEach((alert) => {
            const sq = squads[alert.squad_id]
            if (sq) {
              L.polyline([[threat.lat, threat.lon], [sq.lat, sq.lon]], {
                color: '#ff0033',
                weight: 2.5,
                dashArray: '6, 6',
                opacity: 0.9,
              }).addTo(threatsLayer)
            }
          })
      }

      // Threat marker icon
      const threatIconHtml = `
        <div style="position: relative; transform: translate(-50%, -50%); cursor: pointer; text-align: center;">
          <div style="
            width: ${isUnderIntrusion ? '34px' : '28px'};
            height: ${isUnderIntrusion ? '34px' : '28px'};
            background: ${isUnderIntrusion ? '#dc2626' : threatColor};
            border: 2px solid #ffffff;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 ${isUnderIntrusion ? '20px #ef4444' : '12px ' + threatColor};
            animation: ${isUnderIntrusion ? 'threat-pulse 0.8s infinite' : (threat.engagement_status === 'unassigned' ? 'threat-pulse 1.8s infinite' : 'none')};
          ">
            <span style="color: white; font-weight: 900; font-size: 14px;">!</span>
          </div>
          <div style="
            margin-top: 3px;
            background: rgba(15, 23, 42, 0.9);
            color: #ffffff;
            font-size: 10px;
            padding: 1px 4px;
            border-radius: 3px;
            border: 1px solid ${isUnderIntrusion ? '#ff0033' : threatColor};
            white-space: nowrap;
            font-weight: ${isUnderIntrusion ? 'bold' : 'normal'};
          ">
            ${isUnderIntrusion ? '🚨 ' : ''}${threat.name}
          </div>
        </div>
      `

      const threatIcon = L.divIcon({
        className: 'threat-marker-container',
        html: threatIconHtml,
        iconSize: [0, 0],
      })

      const marker = L.marker([threat.lat, threat.lon], { icon: threatIcon })
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        setSelectedEntity({ type: 'threat', id: threat.id })
        focusRadius10km(threat.lat, threat.lon)
      })

      marker.addTo(threatsLayer)
    })
  }, [threats, squads, dangerZoneAlerts, setSelectedEntity, focusRadius10km])

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

      {/* Floating Map Zone View Switcher */}
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
