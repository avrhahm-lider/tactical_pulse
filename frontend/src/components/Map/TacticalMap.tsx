import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMapStore } from '../../store/useMapStore'
import { useAuthStore } from '../../store/useAuthStore'
import type { Squad, Threat } from '../../types'

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

export const TacticalMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const threatsLayerRef = useRef<L.LayerGroup | null>(null)
  const zonesLayerRef = useRef<L.LayerGroup | null>(null)
  const pinMarkerRef = useRef<L.Marker | null>(null)

  const {
    squads,
    threats,
    dangerZoneAlerts,
    isPickingLocationOnMap,
    pickedLocation,
    setPickedLocation,
    setIsPickingLocationOnMap,
    setSelectedEntity,
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

    // Draw Operational Zone boundary lines
    // North: Lat >= 32.7000
    // Center: 31.9000 <= Lat < 32.7000
    // South: Lat < 31.9000
    const zonesLayer = zonesLayerRef.current

    // North dividing line at 32.7000
    L.polyline(
      [
        [32.7, 34.0],
        [32.7, 36.0],
      ],
      { color: '#00e5ff', weight: 2, dashArray: '6, 6', opacity: 0.7 }
    )
      .bindTooltip('NORTHERN SECTOR BOUNDARY (Lat ≥ 32.70)', {
        permanent: true,
        direction: 'top',
        className: 'tactical-tooltip',
      })
      .addTo(zonesLayer)

    // Center / South dividing line at 31.9000
    L.polyline(
      [
        [31.9, 34.0],
        [31.9, 36.0],
      ],
      { color: '#f59e0b', weight: 2, dashArray: '6, 6', opacity: 0.7 }
    )
      .bindTooltip('SOUTHERN SECTOR BOUNDARY (Lat < 31.90)', {
        permanent: true,
        direction: 'bottom',
        className: 'tactical-tooltip',
      })
      .addTo(zonesLayer)

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // Handle map click when picking location for Threat Creation ("Pin Drop" mode)
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (useMapStore.getState().isPickingLocationOnMap) {
        const { lat, lng } = e.latlng
        setPickedLocation({ lat, lon: lng })
        setIsPickingLocationOnMap(false)
      }
    }

    map.on('click', handleMapClick)
    return () => {
      map.off('click', handleMapClick)
    }
  }, [setPickedLocation, setIsPickingLocationOnMap])

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

  // Render Squads & Radars
  useEffect(() => {
    const markersLayer = markersLayerRef.current
    if (!markersLayer) return

    markersLayer.clearLayers()

    Object.values(squads).forEach((squad: Squad) => {
      const stale = isStale(squad.updated_at)
      const isSapper = squad.role === 'SapperSquad'
      const isRadar = squad.role === 'Radar'
      const isMe = user?.id === squad.id

      // Choose color
      let baseColor = '#10b981' // Green for Squad
      let roleLabel = 'SQUAD'
      if (isSapper) {
        baseColor = '#f59e0b' // Amber/Gold for Sapper
        roleLabel = 'SAPPER'
      } else if (isRadar) {
        baseColor = '#00e5ff' // Cyan for Radar
        roleLabel = 'RADAR'
      }

      if (stale) {
        baseColor = '#6b7280' // Grey for stale signal
        roleLabel += ' (STALE)'
      }

      const iconHtml = `
        <div style="position: relative; transform: translate(-50%, -50%); cursor: pointer; text-align: center;">
          <div style="
            width: 32px;
            height: 32px;
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
            </svg>
          </div>
          <div style="
            margin-top: 4px;
            background: rgba(10, 15, 29, 0.85);
            color: ${stale ? '#9ca3af' : '#ffffff'};
            font-size: 10px;
            font-family: ui-monospace, monospace;
            padding: 1px 4px;
            border-radius: 3px;
            border: 1px solid ${baseColor};
            white-space: nowrap;
          ">
            ${squad.name} [${roleLabel}]
          </div>
        </div>
      `

      const customIcon = L.divIcon({
        className: 'squad-marker-container',
        html: iconHtml,
        iconSize: [0, 0],
      })

      const marker = L.marker([squad.lat, squad.lon], { icon: customIcon })
      marker.on('click', () => {
        setSelectedEntity({ type: 'squad', id: squad.id })
      })

      marker.addTo(markersLayer)
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
      marker.on('click', () => {
        setSelectedEntity({ type: 'threat', id: threat.id })
      })

      marker.addTo(threatsLayer)
    })
  }, [threats, squads, dangerZoneAlerts, setSelectedEntity])

  return (
    <div className="relative w-full h-full">
      {/* Map Target Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Pin Drop Notice Bar when user is picking location */}
      {isPickingLocationOnMap && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] hud-panel px-6 py-2.5 rounded-lg border border-cyan-500/80 hud-glow-cyan flex items-center space-x-3 text-cyan-300 animate-pulse">
          <span className="w-3 h-3 rounded-full bg-cyan-400 animate-ping"></span>
          <span className="font-mono text-sm tracking-wide">
            CLICK ANYWHERE ON THE MAP TO SET THREAT COORDINATES
          </span>
          <button
            onClick={() => setIsPickingLocationOnMap(false)}
            className="ml-3 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-600"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
