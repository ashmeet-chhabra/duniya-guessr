import borders from '@osm_borders/maritime_10m'

function pointInPolygon(point, vs) {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1]
    const xj = vs[j][0], yj = vs[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function polygonArea(ring) {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return Math.abs(area) / 2
}

function bbox(polygon) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const ring of polygon) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, maxX, minY, maxY }
}

function extractPolygons(feature) {
  const polys = []
  for (const geom of feature.geometry.geometries) {
    if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        polys.push(polygon)
      }
    } else if (geom.type === 'Polygon') {
      polys.push(geom.coordinates)
    }
  }
  return polys
}

export function randomPointInCountry(countryCode) {
  const feat = borders.features.find((f) => f.properties.isoA3 === countryCode)
  if (!feat) return null

  const polys = extractPolygons(feat)
  const withArea = polys.map((p) => ({ polygon: p, area: polygonArea(p[0]) }))
  const totalArea = withArea.reduce((s, p) => s + p.area, 0)

  // Weighted random polygon selection by area
  let r = Math.random() * totalArea
  let selected = withArea[withArea.length - 1].polygon
  for (const p of withArea) {
    if (r < p.area) { selected = p.polygon; break }
    r -= p.area
  }

  const box = bbox(selected)

  for (let tries = 0; tries < 500; tries++) {
    const lng = Math.random() * (box.maxX - box.minX) + box.minX
    const lat = Math.random() * (box.maxY - box.minY) + box.minY
    if (pointInPolygon([lng, lat], selected[0])) {
      // Check if point is inside any hole (ring with index > 0)
      let inHole = false
      for (let h = 1; h < selected.length; h++) {
        if (pointInPolygon([lng, lat], selected[h])) { inHole = true; break }
      }
      if (!inHole) return { lat, lng }
    }
  }

  return null
}

export async function findStreetViewLocation(lat, lng, radius = 1000) {
  const url = `https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch?pb=!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${lat}!4d${lng}!2d${radius}!3m18!2m2!1sen!2sUS!9m1!1e2!11m12!1m3!1e2!2b1!3e2!1m3!1e3!2b1!3e2!1m3!1e10!2b1!3e2!4m6!1e1!1e2!1e3!1e4!1e8!1e6&callback=_xdc_._2kz7bz`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Ubuntu Chromium/59.0.3071.109 Chrome/59.0.3071.109 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    let text = await res.text()

    text = text.substring(text.indexOf('( [['))
    text = text.substring(2, text.length - 2)
    if (text.includes('Search returned no images')) return null

    const parsed = JSON.parse(text)
    const description = parsed[1]?.[3]?.[2]?.[1]?.[0]
    if (!description) return null

    const parts = text.split(',').map(x => x.match(/-?\d+(\.\d+)?/g)).filter(Boolean).flat().map(x => parseFloat(x))
    const nearby = parts.filter(x => Math.abs(x - lat) < 1 || Math.abs(x - lng) < 1)
    for (let i = 0; i < nearby.length - 1; i++) {
      if (Math.abs(nearby[i] - lat) < 0.1 && Math.abs(nearby[i + 1] - lng) < 0.1) {
        return { lat: nearby[i], lng: nearby[i + 1] }
      }
    }
    return null
  } catch (err) {
    console.error('Street View check failed:', err)
    return null
  }
}

