import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const blueIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const redCrosshair = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"28\" height=\"28\" viewBox=\"0 0 28 28\"><circle cx=\"14\" cy=\"14\" r=\"6\" fill=\"none\" stroke=\"%23ef4444\" stroke-width=\"2\"/><line x1=\"14\" y1=\"1\" x2=\"14\" y2=\"6\" stroke=\"%23ef4444\" stroke-width=\"2.5\"/><line x1=\"14\" y1=\"22\" x2=\"14\" y2=\"27\" stroke=\"%23ef4444\" stroke-width=\"2.5\"/><line x1=\"1\" y1=\"14\" x2=\"6\" y2=\"14\" stroke=\"%23ef4444\" stroke-width=\"2.5\"/><line x1=\"22\" y1=\"14\" x2=\"27\" y2=\"14\" stroke=\"%23ef4444\" stroke-width=\"2.5\"/><circle cx=\"14\" cy=\"14\" r=\"2\" fill=\"%23ef4444\"/></svg>') 14 14, crosshair"

function getGreatCirclePoints(start, end, numPoints = 50) {
  const toRad = (degree) => (degree * Math.PI) / 180
  const toDeg = (rad) => (rad * 180) / Math.PI

  const lat1 = toRad(start.lat)
  const lon1 = toRad(start.lng)
  const lat2 = toRad(end.lat)
  const lon2 = toRad(end.lng)

  const d = 2 * Math.asin(Math.sqrt(
    Math.pow(Math.sin((lat1 - lat2) / 2), 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lon1 - lon2) / 2), 2)
  ))

  if (d < 1e-6) return [[start.lat, start.lng], [end.lat, end.lng]]

  const points = []
  let prevLon = null
  let lonOffset = 0

  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    
    const lat = Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)))
    let lon = Math.atan2(y, x)

    let currentLon = toDeg(lon)
    
    if (prevLon !== null) {
      let diff = currentLon - prevLon
      if (diff > 180) lonOffset -= 360
      else if (diff < -180) lonOffset += 360
    }
    prevLon = currentLon
    
    points.push([toDeg(lat), currentLon + lonOffset])
  }
  return points
}

export default function MapView({ pinPosition, guessPosition, actualPosition, opponentGuesses, onMapClick, interactive = true, scrollZoom = true, currentPlayerIndex = 0 }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const pinMarkerRef = useRef(null)
  const guessMarkerRef = useRef(null)
  const actualMarkerRef = useRef(null)
  const opponentMarkersRef = useRef([])
  const lineRef = useRef(null)
  const clickHandlerRef = useRef(null)

  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: true,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1,
    })

    L.tileLayer('https://{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}', {
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      maxZoom: 20,
      attribution: 'Google Maps',
    }).addTo(map)

    // Fix for layout where container starts hidden — force recalc
    setTimeout(() => map.invalidateSize(), 100)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current)
      clickHandlerRef.current = null
    }

    if (interactive && onMapClick) {
      const handler = (e) => onMapClick(e.latlng)
      clickHandlerRef.current = handler
      map.on('click', handler)
    }

    if (scrollZoom) {
      map.dragging.enable()
      map.scrollWheelZoom.enable()
      map.doubleClickZoom.enable()
    } else {
      map.dragging.disable()
      map.scrollWheelZoom.disable()
      map.doubleClickZoom.disable()
    }
  }, [interactive, scrollZoom, onMapClick])

  useEffect(() => {
    if (pinMarkerRef.current) {
      mapRef.current?.removeLayer(pinMarkerRef.current)
      pinMarkerRef.current = null
    }
    if (!pinPosition || guessPosition) return
    const icon = currentPlayerIndex === 0 ? redIcon : blueIcon
    const marker = L.marker([pinPosition.lat, pinPosition.lng], { icon }).addTo(mapRef.current)
    marker.bindPopup('Pin')
    pinMarkerRef.current = marker
  }, [pinPosition, guessPosition, currentPlayerIndex])

  useEffect(() => {
    if (guessMarkerRef.current) {
      mapRef.current?.removeLayer(guessMarkerRef.current)
      guessMarkerRef.current = null
    }
    if (!guessPosition) return
    const icon = currentPlayerIndex === 0 ? redIcon : blueIcon
    const marker = L.marker([guessPosition.lat, guessPosition.lng], { icon }).addTo(mapRef.current)
    marker.bindPopup('Your guess')
    guessMarkerRef.current = marker
  }, [guessPosition, currentPlayerIndex])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    opponentMarkersRef.current.forEach(m => map.removeLayer(m))
    opponentMarkersRef.current = []

    if (opponentGuesses && opponentGuesses.length > 0) {
      opponentGuesses.forEach(opp => {
        if (!opp.guess) return
        const marker = L.marker([opp.guess.lat, opp.guess.lng], { 
          icon: currentPlayerIndex === 0 ? blueIcon : redIcon, 
          title: opp.username 
        }).addTo(map)
        marker.bindPopup(`${opp.username}'s guess`)
        opponentMarkersRef.current.push(marker)

        if (actualPosition) {
          const points = getGreatCirclePoints(opp.guess, actualPosition)
          const oppColor = currentPlayerIndex === 0 ? '#3b82f6' : '#ef4444'
          const line = L.polyline(points, { color: oppColor, weight: 2, dashArray: '6, 4' }).addTo(map)
          opponentMarkersRef.current.push(line)
        }
      })
    }
  }, [opponentGuesses, actualPosition, currentPlayerIndex])

  useEffect(() => {
    if (actualMarkerRef.current) {
      mapRef.current?.removeLayer(actualMarkerRef.current)
      actualMarkerRef.current = null
    }
    if (!actualPosition) return
    const marker = L.marker([actualPosition.lat, actualPosition.lng], { icon: greenIcon }).addTo(mapRef.current)
    marker.bindPopup('Actual location')
    actualMarkerRef.current = marker
  }, [actualPosition])

  useEffect(() => {
    if (lineRef.current) {
      mapRef.current?.removeLayer(lineRef.current)
      lineRef.current = null
    }
    if (!guessPosition || !actualPosition) return
    const points = getGreatCirclePoints(guessPosition, actualPosition)
    const playerColor = currentPlayerIndex === 0 ? '#ef4444' : '#3b82f6'
    const line = L.polyline(points, { color: playerColor, weight: 2, dashArray: '6, 4' }).addTo(mapRef.current)
    lineRef.current = line
  }, [guessPosition, actualPosition])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, cursor: interactive ? redCrosshair : 'default' }} />
      {!scrollZoom && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 9999, background: 'transparent' }} />
      )}
    </div>
  )
}
