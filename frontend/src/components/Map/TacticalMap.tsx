import React, { useEffect, useRef, useMemo, useCallback } from 'react'
import L from 'leaflet'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import type { Squad, Threat, User } from '../../types'
import { Compass, Crosshair, Maximize2 } from 'lucide-react'

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

// Check if an entity is a dynamic operational force (excluding static headquarters)
function isDynamicForce(squad: Squad): boolean {
  return (
    squad.status !== 'inactive' &&
    squad.role !== 'AreaCommandCenter' &&
    squad.role !== 'MainCommandCenter'
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

// Extract coordinates of all relevant active dynamic objects (ignoring static headquarters)
function getRelevantCoordinates(
  user: User | null,
  zoneFilter: 'Global' | 'North' | 'Center' | 'South',
  squads: Record<string, Squad>,
  threats: Record<string, Threat>
): [number, number][] {
  let targetSector: 'Global' | 'North' | 'Center' | 'South' = 'Global'
  if (user?.role === 'AreaCommandCenter') {
    targetSector = (user.area as 'North' | 'Center' | 'South') || 'Center'
  } else if (user?.role === 'MainCommandCenter') {
    targetSector = zoneFilter
  } else if (user?.area && user.area !== 'Global') {
    targetSector = user.area as 'North' | 'Center' | 'South'
  } else if (user?.id && squads[user.id]) {
    const my = squads[user.id]
    if (my.area && my.area !== 'Global') {
      targetSector = my.area as 'North' | 'Center' | 'South'
    } else if (my.lat >= 32.70) {
      targetSector = 'North'
    } else if (my.lat >= 31.90) {
      targetSector = 'Center'
    } else {
      targetSector = 'South'
    }
  }

  const isSectorMatch = (lat: number, area?: string) => {
    if (targetSector === 'Global') return true
    if (area && area === targetSector) return true
    if (targetSector === 'North') return lat >= 32.70
    if (targetSector === 'Center') return lat >= 31.90 && lat < 32.70
    if (targetSector === 'South') return lat < 31.90
    return false
  }

  const points: [number, number][] = []

  // Add ONLY active dynamic forces (static objects like headquarters are completely ignored for zoom)
  Object.values(squads).forEach((sq) => {
    if (!isDynamicForce(sq)) return
    if (isSectorMatch(sq.lat, sq.area)) {
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
      center: [31.6, 34.9],
      zoom: 8,
      minZoom: 7,
      maxZoom: 17,
      preferCanvas: true,
      zoomControl: false,
    })

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
  const autoAdjustView = useCallback((animate = true) => {
    const map = mapInstanceRef.current
    if (!map) return

    const points = getRelevantCoordinates(user, selectedZoneFilter, squads, threats)

    if (points.length >= 2) {
      // Bounding box automatically spans from the first incident/unit to the last, ignoring empty zones
      const bounds = L.latLngBounds(points)
      if (animate) {
        map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 15, duration: 1.0 })
      } else {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
      }
    } else if (points.length === 1) {
      if (animate) {
        map.flyTo(points[0], 13, { duration: 1.0 })
      } else {
        map.setView(points[0], 13)
      }
    } else {
      // Sector fallback if zero units or alerts currently exist
      const targetSector =
        user?.role === 'AreaCommandCenter'
          ? (user.area as 'North' | 'Center' | 'South')
          : user?.role === 'MainCommandCenter'
          ? selectedZoneFilter
          : (user?.area as 'North' | 'Center' | 'South')

      if (targetSector && targetSector !== 'Global' && SECTOR_DEFS[targetSector]) {
        if (animate) {
          map.flyToBounds(SECTOR_DEFS[targetSector].bounds, { padding: [40, 40], maxZoom: 10, duration: 1.0 })
        } else {
          map.fitBounds(SECTOR_DEFS[targetSector].bounds, { padding: [40, 40], maxZoom: 10 })
        }
      } else {
        if (animate) {
          map.flyToBounds([[29.5, 34.2], [33.4, 35.8]], { padding: [30, 30], duration: 1.0 })
        } else {
          map.fitBounds([[29.5, 34.2], [33.4, 35.8]], { padding: [30, 30] })
        }
      }
    }
  }, [user, selectedZoneFilter, squads, threats])

  // Automatically adjust view signature: runs when sector changes or relevant objects are updated
  const relevantSignature = useMemo(() => {
    const points = getRelevantCoordinates(user, selectedZoneFilter, squads, threats)
    return `${user?.role}_${selectedZoneFilter}_${points.length}_${points
      .map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)
      .join(';')}`
  }, [user, selectedZoneFilter, squads, threats])

  const prevSignatureRef = useRef<string>('')

  useEffect(() => {
    if (relevantSignature !== prevSignatureRef.current) {
      prevSignatureRef.current = relevantSignature
      autoAdjustView(true)
    }
  }, [relevantSignature, autoAdjustView])

  // Render Operational Zones & Authorized Sector Visualizations
  useEffect(() => {
    const zonesLayer = zonesLayerRef.current
    if (!zonesLayer) return

    zonesLayer.clearLayers()

    const isManager = user?.role === 'MainCommandCenter'
    const isRegionalHQ = user?.role === 'AreaCommandCenter'
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

    // 2. Render Sector Polygons
    ;(Object.keys(SECTOR_DEFS) as Array<'North' | 'Center' | 'South'>).forEach((secKey) => {
      const sec = SECTOR_DEFS[secKey]
      const polygonCoords: [number, number][] = [
        [sec.minLat, sec.minLon],
        [sec.maxLat, sec.minLon],
        [sec.maxLat, sec.maxLon],
        [sec.minLat, sec.maxLon],
      ]

      let isAuthorized = false

      if (isRegionalHQ) {
        isAuthorized = authorizedArea === secKey
      } else if (isManager) {
        isAuthorized = true
      } else {
        // Field Squad
        isAuthorized = authorizedArea === secKey
      }

      if (isRegionalHQ) {
        if (isAuthorized) {
          // Highlight user's Authorized Zone
          L.polygon(polygonCoords, {
            color: sec.color,
            weight: 2.5,
            fillColor: sec.color,
            fillOpacity: 0.12,
            dashArray: undefined,
          })
            .bindTooltip(`AUTHORIZED OPERATIONAL ZONE — ${secKey.toUpperCase()} COMMAND (HQ)`, {
              permanent: true,
              direction: 'center',
              className:
                secKey === 'North'
                  ? 'tactical-tooltip'
                  : secKey === 'Center'
                  ? 'tactical-tooltip-amber'
                  : 'tactical-tooltip-green',
            })
            .addTo(zonesLayer)
        } else {
          // Muted out-of-sector area
          L.polygon(polygonCoords, {
            color: '#334155',
            weight: 1,
            fillColor: '#000000',
            fillOpacity: 0.35,
            dashArray: '4, 4',
          })
            .bindTooltip(`RESTRICTED SECTOR (${secKey.toUpperCase()}) — OUTSIDE JURISDICTION`, {
              permanent: false,
              direction: 'center',
              className: 'tactical-tooltip',
            })
            .addTo(zonesLayer)
        }
      } else if (isManager) {
        // Manager Supreme Operational View
        const isFocused = selectedZoneFilter === secKey
        L.polygon(polygonCoords, {
          color: isFocused ? sec.color : '#475569',
          weight: isFocused ? 3 : 1.5,
          fillColor: isFocused ? sec.color : '#000000',
          fillOpacity: isFocused ? 0.15 : selectedZoneFilter === 'Global' ? 0.06 : 0.35,
          dashArray: isFocused ? undefined : '5, 5',
        })
          .bindTooltip(
            isFocused
              ? `ACTIVE COMMAND SECTOR: ${secKey.toUpperCase()}`
              : `${sec.name.toUpperCase()} (OPERATIONAL SECTOR)`,
            {
              permanent: isFocused || selectedZoneFilter === 'Global',
              direction: 'center',
              className:
                secKey === 'North'
                  ? 'tactical-tooltip'
                  : secKey === 'Center'
                  ? 'tactical-tooltip-amber'
                  : 'tactical-tooltip-green',
            }
          )
          .addTo(zonesLayer)
      } else {
        // Regular Field Units
        L.polygon(polygonCoords, {
          color: sec.color,
          weight: 1.5,
          fillColor: sec.color,
          fillOpacity: 0.05,
          dashArray: '4, 4',
        }).addTo(zonesLayer)
      }
    })

    // 3. For field squads, render 20 km tactical awareness radius circle around user
    if (user?.id && squads[user.id] && user.role !== 'MainCommandCenter' && user.role !== 'AreaCommandCenter') {
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
      const isHQ = squad.role === 'AreaCommandCenter'
      const isSapper = squad.role === 'SapperSquad'
      const isRadar = squad.role === 'Radar'
      const isMe = user?.id === squad.id
      const stale = isStale(squad.updated_at)

      // Styling based on role
      let baseColor = '#10b981' // Green for Squad
      let roleLabel = 'SQUAD'

      if (isHQ) {
        baseColor = '#a855f7' // Purple for Regional Headquarters
        roleLabel = 'REGIONAL HQ'
      } else if (isSapper) {
        baseColor = '#f59e0b' // Amber/Gold for Sapper
        roleLabel = 'SAPPER'
      } else if (isRadar) {
        baseColor = '#00e5ff' // Cyan for Radar
        roleLabel = 'RADAR'
      }

      if (stale && !isHQ) {
        baseColor = '#6b7280' // Grey for stale signal
        roleLabel += ' (STALE)'
      }

      // Icon HTML
      const iconWidth = isHQ ? 42 : 36
      const iconHeight = isHQ ? 42 : 36

      const iconHtml = isHQ
        ? `
          <div style="position: relative; width: 42px; height: 42px; cursor: pointer; pointer-events: auto;">
            <div style="
              width: 42px;
              height: 42px;
              background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
              border: 2px solid ${isMe ? '#ffffff' : '#c084fc'};
              border-radius: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 0 ${isMe ? '18px #c084fc' : '12px rgba(168, 85, 247, 0.6)'};
              transition: transform 0.2s ease;
            ">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#ffffff" stroke="#000000" stroke-width="1.2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </div>
            <div style="
              position: absolute;
              top: 46px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(15, 10, 30, 0.95);
              color: #ffffff;
              font-size: 10px;
              font-weight: 700;
              font-family: ui-monospace, monospace;
              padding: 2px 6px;
              border-radius: 4px;
              border: 1px solid #a855f7;
              white-space: nowrap;
              box-shadow: 0 2px 8px rgba(0,0,0,0.8);
              pointer-events: none;
            ">
              ★ ${squad.name} [${squad.area} HQ]
            </div>
          </div>
        `
        : `
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

      const popupHtml = buildForcePopupHtml(squad, stale && !isHQ)

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
          offset: [0, isHQ ? -24 : -18],
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
        })

        newMarker.addTo(markersLayer)
        squadMarkersRef.current.set(squad.id, newMarker)
      }
    })
  }, [squads, user, setSelectedEntity])

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
      })

      marker.addTo(threatsLayer)
    })
  }, [threats, squads, dangerZoneAlerts, setSelectedEntity])

  return (
    <div className={`relative w-full h-full ${isPickingLocationOnMap ? 'cursor-crosshair' : ''}`}>
      {/* Map Target Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Auto-Fit Range HUD Button (Spans from first to last incident/force, ignoring empty area) */}
      <div className="absolute top-4 left-4 z-[999] hud-panel px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl flex items-center space-x-2 font-mono text-xs">
        <button
          onClick={() => autoAdjustView(true)}
          title="Auto-adjust zoom to span between all relevant objects in active sector (empty areas ignored)"
          className="flex items-center space-x-1.5 px-2 py-1 rounded bg-slate-900/80 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-500 text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer text-[11px] font-bold"
        >
          <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
          <span>AUTO-FIT VIEW</span>
        </button>
      </div>

      {/* Floating Manager Sector Switcher on Map */}
      {user?.role === 'MainCommandCenter' && (
        <div className="absolute top-4 right-4 z-[999] hud-panel px-3 py-2 rounded-lg border border-slate-700 shadow-xl flex items-center space-x-1 font-mono text-xs">
          <span className="text-[10px] text-slate-400 font-bold px-1 flex items-center gap-1">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            ZONE:
          </span>
          {(['Global', 'North', 'Center', 'South'] as const).map((z) => {
            const active = selectedZoneFilter === z
            return (
              <button
                key={z}
                onClick={() => setSelectedZoneFilter(z)}
                className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider transition-all cursor-pointer border ${
                  active
                    ? z === 'North'
                      ? 'bg-cyan-950 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(0,229,255,0.4)]'
                      : z === 'Center'
                      ? 'bg-amber-950 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                      : z === 'South'
                      ? 'bg-emerald-950 border-emerald-400 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                      : 'bg-purple-950 border-purple-400 text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                    : 'bg-slate-900/60 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {z === 'Global' ? 'GLOBAL' : z.toUpperCase()}
              </button>
            )
          })}
        </div>
      )}

      {/* Authorized Zone HUD Badge for Regional Command Centers */}
      {user?.role === 'AreaCommandCenter' && (
        <div className="absolute top-4 right-4 z-[999] hud-panel px-3 py-2 rounded-lg border border-purple-500/60 shadow-xl flex items-center space-x-2 font-mono text-xs">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
          <span className="text-purple-300 font-bold tracking-wide">
            AUTHORIZED SECTOR: {user.area.toUpperCase()}
          </span>
          <button
            onClick={() => autoAdjustView(true)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/80 hover:bg-purple-900 border border-purple-600 text-purple-200 ml-1 cursor-pointer"
          >
            FOCUS
          </button>
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
