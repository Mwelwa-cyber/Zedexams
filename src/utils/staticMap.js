// Helpers for building Google Maps Static API image URLs.
//
// Docs: https://developers.google.com/maps/documentation/maps-static/start
//
// The API key is restricted by HTTP referrer + locked to the Maps Static API
// in GCP, so it's safe to expose via VITE_*. Without that hardening the key
// must NOT ship to the browser.

const STATIC_MAP_BASE = 'https://maps.googleapis.com/maps/api/staticmap'

function getApiKey() {
  const key = import.meta.env?.VITE_GOOGLE_MAPS_STATIC_KEY
  if (!key) {
    throw new Error(
      'VITE_GOOGLE_MAPS_STATIC_KEY is missing. Add it to .env (see .env.example).',
    )
  }
  return key
}

/**
 * Build a Google Maps Static API image URL.
 *
 * @param {object} opts
 * @param {number} opts.lat        Latitude of the map center.
 * @param {number} opts.lng        Longitude of the map center.
 * @param {number} [opts.zoom=14]  Zoom level (0–21).
 * @param {[number, number]} [opts.size=[600, 400]]  Image size [width, height] in px.
 * @param {number} [opts.scale=2]  1 or 2. Use 2 for retina displays.
 * @param {'roadmap'|'satellite'|'terrain'|'hybrid'} [opts.mapType='roadmap']
 * @param {Array<{lat:number,lng:number,color?:string,label?:string}>} [opts.markers=[]]
 *        Markers to drop on the map. `label` must be a single A–Z or 0–9 char.
 * @returns {string} A fully-formed `https://maps.googleapis.com/maps/api/staticmap?...` URL.
 */
export function buildStaticMapUrl({
  lat,
  lng,
  zoom = 14,
  size = [600, 400],
  scale = 2,
  mapType = 'roadmap',
  markers = [],
}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('buildStaticMapUrl: lat/lng must be finite numbers')
  }
  const [w, h] = size
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${w}x${h}`,
    scale: String(scale),
    maptype: mapType,
    key: getApiKey(),
  })
  for (const m of markers) {
    const parts = []
    if (m.color) parts.push(`color:${m.color}`)
    if (m.label) parts.push(`label:${m.label}`)
    parts.push(`${m.lat},${m.lng}`)
    params.append('markers', parts.join('|'))
  }
  return `${STATIC_MAP_BASE}?${params.toString()}`
}
