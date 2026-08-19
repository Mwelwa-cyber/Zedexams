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
const setOfferedCallable = httpsCallable(functions, 'setTtsOfferedVoices')
const previewVoiceCallable = httpsCallable(functions, 'previewTtsVoice')

/** The two tool rows /api/tts writes. Paid synthesis, and what the cache saved. */
export const TTS_TOOL = 'tts'
export const TTS_CACHE_TOOL = 'tts-cache-hit'

export async function fetchTtsControlRoom() {
  const res = await controlRoomCallable({})
  return res?.data || null
}

/**
 * Persist the offered list (the /api/tts allow-list). The server validates
 * with the same module the endpoint resolves with and reports `dropped` —
 * surfaced to the admin, because a silently shrunken list is a voice
 * quietly missing.  An EMPTY list means "back to the Google defaults".
 */
export async function saveOfferedVoices(voices) {
  const res = await setOfferedCallable({ voices })
  return res?.data || { saved: 0, dropped: 0 }
}

/**
 * Synthesise a short test phrase in any voice (offered or not) and play it.
 * Costs real credits on a cache miss (~$0.005 at 30 chars on ElevenLabs),
 * which is exactly what a small budget should buy first: hearing a voice
 * before pointing learners at it. Returns the created object URL so the
 * caller can revoke it when playback ends.
 */
export async function previewVoice({ voice, text }) {
  const res = await previewVoiceCallable({ voice, text })
  const b64 = res?.data?.audioBase64
  if (!b64) throw new Error('No audio returned.')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
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

/**
 * One row shape for the voices table, both providers. The page maps ONE
 * list; provider quirks (Google has a tier and no free sample, ElevenLabs
 * has a hosted preview and one flat rate) are resolved here, once.
 */
export function catalogueRows(room) {
  const google = (room?.voices?.google || []).map((v) => ({
    id: v.id,
    provider: 'google',
    label: v.label || v.id,
    lang: v.lang || '',
    sub: `Google · ${v.tier || ''}`,
    usdPerMchar: v.usdPerMchar ?? null,
    previewUrl: null,
  }))
  const elRate = room?.rates?.elevenlabs?.usdPerMchar ?? null
  const eleven = (room?.voices?.elevenlabs || []).map((v) => ({
    id: v.voiceId,
    provider: 'elevenlabs',
    label: v.name || v.voiceId,
    lang: '',
    sub: `ElevenLabs${v.category ? ` · ${v.category}` : ''}`,
    usdPerMchar: elRate,
    previewUrl: v.previewUrl || null,
  }))
  return [...google, ...eleven]
}

/** The ids currently offered (explicit config or the standing defaults). */
export function offeredIds(room) {
  return (room?.offered?.voices || []).map((v) => v.id)
}

/**
 * The payload for saveOfferedVoices from the table's checked state. Order
 * follows the CATALOGUE, not click order, so the first offered voice — which
 * the endpoint uses as the default for voice-less requests — is stable and
 * visible rather than an accident of what was ticked last.
 */
export function buildOfferedPayload(rows, checkedIdList) {
  const checked = new Set(checkedIdList)
  return rows
    .filter((r) => checked.has(r.id))
    .map((r) => ({ id: r.id, provider: r.provider, label: r.label, lang: r.lang }))
}
