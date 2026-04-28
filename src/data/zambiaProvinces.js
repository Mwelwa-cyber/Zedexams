/**
 * Static reference data for Zambia's 10 provinces.
 *
 * Used by the "Zambia Province Shapes" game to render each province as a
 * polygon silhouette via the Maps Static API. Polygons are hand-simplified
 * (~10-15 vertices each) — accurate enough to be recognizable to a Grade 5
 * learner, small enough to keep the URL short.
 *
 * Coordinates are [lat, lng] in degrees. Polygons are listed clockwise.
 */

export const ZAMBIA_PROVINCES = {
  central: {
    slug: 'central',
    name: 'Central',
    center: { lat: -14.5, lng: 28.0 },
    zoom: 7,
    neighbours: ['copperbelt', 'lusaka', 'eastern', 'southern', 'northern'],
    polygon: [
      { lat: -13.0, lng: 26.5 },
      { lat: -13.0, lng: 28.5 },
      { lat: -13.5, lng: 29.5 },
      { lat: -14.0, lng: 30.0 },
      { lat: -15.0, lng: 30.0 },
      { lat: -15.5, lng: 29.0 },
      { lat: -15.3, lng: 27.8 },
      { lat: -14.5, lng: 26.8 },
      { lat: -13.8, lng: 26.3 },
    ],
  },

  copperbelt: {
    slug: 'copperbelt',
    name: 'Copperbelt',
    center: { lat: -12.7, lng: 27.7 },
    zoom: 8,
    neighbours: ['north-western', 'central', 'luapula'],
    polygon: [
      { lat: -12.2, lng: 27.0 },
      { lat: -12.2, lng: 28.4 },
      { lat: -12.7, lng: 28.6 },
      { lat: -13.2, lng: 28.4 },
      { lat: -13.3, lng: 27.5 },
      { lat: -13.0, lng: 27.0 },
      { lat: -12.5, lng: 26.8 },
    ],
  },

  eastern: {
    slug: 'eastern',
    name: 'Eastern',
    center: { lat: -13.5, lng: 32.0 },
    zoom: 7,
    neighbours: ['muchinga', 'central', 'lusaka'],
    polygon: [
      { lat: -11.8, lng: 32.5 },
      { lat: -12.2, lng: 33.4 },
      { lat: -13.5, lng: 33.4 },
      { lat: -14.5, lng: 33.0 },
      { lat: -15.0, lng: 32.0 },
      { lat: -14.5, lng: 31.0 },
      { lat: -13.5, lng: 30.7 },
      { lat: -12.5, lng: 31.0 },
      { lat: -12.0, lng: 31.8 },
    ],
  },

  luapula: {
    slug: 'luapula',
    name: 'Luapula',
    center: { lat: -10.8, lng: 28.8 },
    zoom: 7,
    neighbours: ['northern', 'copperbelt', 'muchinga'],
    polygon: [
      { lat: -8.7, lng: 28.4 },
      { lat: -9.2, lng: 29.2 },
      { lat: -10.0, lng: 29.5 },
      { lat: -11.0, lng: 29.4 },
      { lat: -12.0, lng: 29.2 },
      { lat: -12.4, lng: 28.7 },
      { lat: -11.8, lng: 28.3 },
      { lat: -10.8, lng: 28.0 },
      { lat: -9.5, lng: 28.0 },
    ],
  },

  lusaka: {
    slug: 'lusaka',
    name: 'Lusaka',
    center: { lat: -15.3, lng: 29.0 },
    zoom: 8,
    neighbours: ['central', 'eastern', 'southern'],
    polygon: [
      { lat: -14.7, lng: 28.4 },
      { lat: -14.8, lng: 29.5 },
      { lat: -15.3, lng: 30.0 },
      { lat: -15.9, lng: 29.4 },
      { lat: -15.8, lng: 28.5 },
      { lat: -15.2, lng: 28.2 },
    ],
  },

  muchinga: {
    slug: 'muchinga',
    name: 'Muchinga',
    center: { lat: -11.5, lng: 31.5 },
    zoom: 7,
    neighbours: ['northern', 'luapula', 'eastern'],
    polygon: [
      { lat: -9.5, lng: 31.0 },
      { lat: -10.0, lng: 32.5 },
      { lat: -11.0, lng: 33.0 },
      { lat: -12.0, lng: 33.0 },
      { lat: -12.5, lng: 32.0 },
      { lat: -12.8, lng: 30.8 },
      { lat: -12.0, lng: 30.2 },
      { lat: -11.0, lng: 30.0 },
      { lat: -10.0, lng: 30.4 },
    ],
  },

  northern: {
    slug: 'northern',
    name: 'Northern',
    center: { lat: -9.8, lng: 30.5 },
    zoom: 7,
    neighbours: ['luapula', 'muchinga'],
    polygon: [
      { lat: -8.3, lng: 29.5 },
      { lat: -8.3, lng: 31.5 },
      { lat: -9.0, lng: 32.5 },
      { lat: -10.0, lng: 32.0 },
      { lat: -11.0, lng: 31.0 },
      { lat: -11.2, lng: 30.0 },
      { lat: -10.5, lng: 29.5 },
      { lat: -9.5, lng: 29.0 },
    ],
  },

  'north-western': {
    slug: 'north-western',
    name: 'North-Western',
    center: { lat: -12.5, lng: 25.0 },
    zoom: 7,
    neighbours: ['copperbelt', 'central', 'western'],
    polygon: [
      { lat: -10.5, lng: 23.5 },
      { lat: -10.8, lng: 24.5 },
      { lat: -11.5, lng: 25.5 },
      { lat: -12.0, lng: 26.5 },
      { lat: -12.5, lng: 27.0 },
      { lat: -13.5, lng: 26.5 },
      { lat: -13.8, lng: 25.5 },
      { lat: -13.5, lng: 24.0 },
      { lat: -12.5, lng: 23.0 },
      { lat: -11.5, lng: 23.0 },
    ],
  },

  southern: {
    slug: 'southern',
    name: 'Southern',
    center: { lat: -16.7, lng: 27.0 },
    zoom: 7,
    neighbours: ['western', 'central', 'lusaka'],
    polygon: [
      { lat: -15.5, lng: 25.5 },
      { lat: -15.8, lng: 26.8 },
      { lat: -15.8, lng: 28.0 },
      { lat: -16.2, lng: 28.8 },
      { lat: -16.5, lng: 29.2 },
      { lat: -17.5, lng: 28.5 },
      { lat: -18.0, lng: 27.5 },
      { lat: -17.8, lng: 26.0 },
      { lat: -17.2, lng: 25.2 },
      { lat: -16.3, lng: 25.0 },
    ],
  },

  western: {
    slug: 'western',
    name: 'Western',
    center: { lat: -15.0, lng: 23.5 },
    zoom: 6,
    neighbours: ['north-western', 'southern'],
    polygon: [
      { lat: -13.0, lng: 22.0 },
      { lat: -13.0, lng: 23.5 },
      { lat: -13.5, lng: 24.5 },
      { lat: -14.5, lng: 25.0 },
      { lat: -15.5, lng: 25.2 },
      { lat: -16.5, lng: 25.0 },
      { lat: -17.5, lng: 24.5 },
      { lat: -17.5, lng: 23.0 },
      { lat: -16.0, lng: 22.5 },
      { lat: -14.5, lng: 22.0 },
    ],
  },
}

export const PROVINCE_SLUGS = Object.keys(ZAMBIA_PROVINCES)

export function getProvince(slug) {
  return ZAMBIA_PROVINCES[slug] || null
}

/**
 * Pick `n` distractor names for a given province. Prefers neighbours
 * (more pedagogically valuable — encourages careful shape comparison),
 * falls back to a deterministic shuffle of the rest.
 */
export function getProvinceDistractors(slug, n = 3) {
  const province = ZAMBIA_PROVINCES[slug]
  if (!province) return []
  const neighbours = (province.neighbours || [])
    .map((s) => ZAMBIA_PROVINCES[s]?.name)
    .filter(Boolean)
  const others = PROVINCE_SLUGS
    .filter((s) => s !== slug && !province.neighbours.includes(s))
    .map((s) => ZAMBIA_PROVINCES[s].name)
  const ordered = [...neighbours, ...others]
  return ordered.slice(0, n)
}
