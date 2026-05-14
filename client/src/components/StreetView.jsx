import { useState, useEffect } from 'react'

export default function StreetView({ location }) {
  if (!location) return null

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  const { lat, lng } = location
  const [loadError, setLoadError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)
    setLoadError(false)
    const t = setTimeout(() => setIsLoading(false), 1500)
    return () => clearTimeout(t)
  }, [lat, lng])

  if (loadError) {
    return (
      <div className="street-view-container" style={{ width: '100%', height: '100%', position: 'relative', flex: 1, background: '#000' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>
          Street View unavailable
        </div>
      </div>
    )
  }

  return (
    <div className="street-view-container" style={{ width: '100%', height: '100%', position: 'relative', flex: 1, background: '#000', overflow: 'hidden' }}>
      {isLoading && (
        <div className="street-view-loader">
          Loading Street View...
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0 }}>
        <iframe
          src={`https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${lat},${lng}&heading=0&pitch=0&fov=80`}
          referrerPolicy="no-referrer-when-downgrade"
          allow="autoplay; encrypted-media"
          title="Street View"
          style={{ width: '100%', height: 'calc(100% + 72px)', transform: 'translateY(-72px)', border: 0 }}
          onError={() => setLoadError(true)}
        />
      </div>
    </div>
  )
}