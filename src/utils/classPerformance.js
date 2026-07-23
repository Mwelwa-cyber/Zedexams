import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const fns = getFunctions(app, 'us-central1')
const getSeriesCallable = httpsCallable(fns, 'getClassPerformanceSeries')

const CACHE_KEY = 'zedexams:class-performance-series'
const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * Weekly class-performance series for the dashboard chart — "Your Class"
 * (the caller's class members' weekly average) vs "Class Average"
 * (platform baseline). Server-bounded (≤10 classes, ≤200 learners,
 * 6-week window); cached in sessionStorage for 10 minutes so re-visiting
 * the dashboard doesn't re-run the aggregation.
 */
export async function getClassPerformanceSeries({ force = false } = {}) {
  if (!force) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY)
      if (raw) {
        const cached = JSON.parse(raw)
        if (Date.now() - cached.at < CACHE_TTL_MS && cached.data) return cached.data
      }
    } catch { /* cache unavailable — fall through to the network */ }
  }
  const result = await getSeriesCallable({})
  const data = result.data
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }))
  } catch { /* storage full/unavailable — fine, next visit refetches */ }
  return data
}
