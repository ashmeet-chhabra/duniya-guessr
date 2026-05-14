export function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function calculateScore(actual, guess, maxDistance = 20000) {
  const distance = getDistanceKm(actual.lat, actual.lng, guess.lat, guess.lng)
  return {
    score: Math.max(0, Math.round(5000 * Math.E ** (-10 * (distance / maxDistance)))),
    distanceKm: Math.round(distance * 10) / 10,
  }
}
