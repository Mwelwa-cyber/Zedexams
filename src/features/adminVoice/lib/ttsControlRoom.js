/**
 * Client half of the admin TTS panel.
 *
 * The ElevenLabs key never reaches the browser — that is the whole reason
 * these numbers come from a callable rather than a fetch to api.elevenlabs.io.
 * A key in a bundle is public, and ElevenLabs' "auto-disable if leaked" would
 * not catch it: that watches for keys committed to public repositories, not
 * keys served in JavaScript.
 *
 * Spend deliberately does NOT come through the callable. /admin/ai-costs
 * already reads the aiUsage rollups straight from Firestore under admin rules,
 * so this page reuses those same helpers — one path to those numbers, one way
 * for them to be wrong.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'
import { listToolsForDate } from '../../../utils/aiCosts'

const functions = getFunctions(app, 'us-central1')
const controlRoomCallable = httpsCallable(functions, 'getTtsControlRoom')

/** The two tool rows /api/tts writes. Paid synthesis, and what the cache saved. */
export const TTS_TOOL = 'tts'
export const TTS_CACHE_TOOL = 'tts-cache-hit'

export async function fetchTtsControlRoom() {
  const res = await controlRoomCallable({})
  return res?.data || null
}

export function messageFromError(error) {
  const code = error?.code || ''
  if (code.includes('permission-denied')) return 'Admins only.'
  if (code.includes('unauthenticated')) return 'Please sign in again.'
  if (code.includes('resource-exhausted')) return 'Too many refreshes — wait a minute.'
  return error?.message || 'Could not reach the voice service.'
}

/**
 * Today's TTS spend and cache performance, from the per-tool rollups.
 *
 * `savedUsd` is the counterfactual: the characters the cache served, priced at
 * the rate they WOULD have cost. It is derived rather than stored, because a
 * saving is not a transaction — nothing was spent, so nothing was recorded to
 * sum. That makes the arithmetic visible here rather than implied.
 */
export function summariseTtsDay(toolRows = [], { usdPerMchar = null } = {}) {
  const paid = toolRows.find((r) => r.tool === TTS_TOOL) || null
  const cached = toolRows.find((r) => r.tool === TTS_CACHE_TOOL) || null

  const paidCalls = paid?.callCount || 0
  const cachedCalls = cached?.callCount || 0
  const totalCalls = paidCalls + cachedCalls
  const paidChars = paid?.characters || 0
  const cachedChars = cached?.characters || 0

  // A rate is only inferable when we actually paid for something today.
  // Falling back to a passed-in rate keeps the saving computable on a day that
  // was served entirely from cache — which is the best day, and the one where
  // reporting "saved $0.00" would be most misleading.
  const impliedRate = paidChars > 0 && paid?.costUsd > 0
    ? (paid.costUsd / paidChars) * 1_000_000
    : usdPerMchar

  return {
    paidCalls,
    cachedCalls,
    totalCalls,
    paidChars,
    cachedChars,
    costUsd: paid?.costUsd || 0,
    // Null, not zero, when there is no rate to price the saving with — an
    // unknown saving must not render as "you saved nothing".
    savedUsd: impliedRate ? (cachedChars * impliedRate) / 1_000_000 : null,
    hitRate: totalCalls > 0 ? cachedCalls / totalCalls : null,
  }
}

export async function fetchTtsDay(date) {
  const rows = await listToolsForDate(date, { limit: 50 })
  return rows.filter((r) => r.tool === TTS_TOOL || r.tool === TTS_CACHE_TOOL)
}
