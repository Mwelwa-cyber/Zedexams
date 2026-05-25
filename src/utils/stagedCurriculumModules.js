/**
 * Client-side wrappers for the three admin callables that surface and
 * resolve staged curriculum modules (the ingester's output).
 *
 *   listStagedCurriculumModules()   → { ok, modules } | { ok:false, error }
 *   promoteCurriculumModule(id)     → { ok, topicId, version } | { ok:false, error }
 *   rejectCurriculumModule(id, r?)  → { ok } | { ok:false, error }
 *
 * Each callable is admin-only on the server. The client checks
 * isAdmin in the AuthContext before rendering the page, so these
 * functions assume the caller is allowed — they just translate
 * errors into a uniform `{ ok:false, error }` shape the panel can
 * render.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')

const listCallable = httpsCallable(functions, 'listStagedCurriculumModules', {
  timeout: 30_000,
})
const promoteCallable = httpsCallable(functions, 'promoteIngestedCurriculumModule', {
  timeout: 30_000,
})
const promoteWithAiCallable = httpsCallable(functions, 'promoteIngestedCurriculumModuleWithAi', {
  // Longer timeout — Claude call can take ~10–30s on big extracts.
  timeout: 60_000,
})
const rejectCallable = httpsCallable(functions, 'rejectIngestedCurriculumModule', {
  timeout: 15_000,
})
const runWatcherNowCallable = httpsCallable(functions, 'runCurriculumWatcherNow', {
  // Match the server-side timeoutSeconds — full runs can take a couple
  // of minutes when downloading + parsing modules across all sources.
  timeout: 540_000,
})

function toError(err, fallback) {
  if (err?.code === 'permission-denied') return 'Admin only.'
  if (err?.code === 'unauthenticated') return 'Please sign in again.'
  return err?.message || fallback
}

export async function listStagedCurriculumModules() {
  try {
    const { data } = await listCallable({})
    return { ok: true, modules: (data && data.modules) || [] }
  } catch (err) {
    return { ok: false, error: toError(err, 'Failed to load staged modules') }
  }
}

export async function promoteCurriculumModule(curriculumId) {
  if (!curriculumId) return { ok: false, error: 'Missing curriculumId' }
  try {
    const { data } = await promoteCallable({ curriculumId })
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: toError(err, 'Promotion failed') }
  }
}

/**
 * AI-assisted promotion. Calls Claude on the staged module's RAG
 * chunks to extract subtopics/outcomes/competencies/values/materials,
 * then writes the canonical KB topic with those fields filled in.
 * Cost: ~$0.02 per call. Slower (~10–30s) than the stub flow.
 */
export async function promoteCurriculumModuleWithAi(curriculumId) {
  if (!curriculumId) return { ok: false, error: 'Missing curriculumId' }
  try {
    const { data } = await promoteWithAiCallable({ curriculumId })
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: toError(err, 'AI promotion failed') }
  }
}

export async function rejectCurriculumModule(curriculumId, reason) {
  if (!curriculumId) return { ok: false, error: 'Missing curriculumId' }
  try {
    const { data } = await rejectCallable({ curriculumId, reason: reason || null })
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: toError(err, 'Reject failed') }
  }
}

/**
 * Manually trigger one full pass of the curriculumWatcher agent. Used
 * to verify ingestion without waiting for the daily 02:00 UTC cron.
 *
 * @param {object} [options]
 * @param {string[]} [options.grades]   Grade tokens to scope the run to,
 *                                       e.g. ['3','4','ECE']. Empty array
 *                                       or undefined → all grades.
 * @param {boolean}  [options.includeUnknownGrade]
 *                                       When a grade scope is set, this
 *                                       controls whether to keep modules
 *                                       whose grade can't be detected.
 *                                       Defaults: true when unscoped,
 *                                       false when scoped (matches the
 *                                       server's normaliseRunOptions()).
 *
 * Returns `{ ok, taskId, summary: { changedCount, unreachableCount,
 * ingestedTotal, skippedTotal, gradeFilter, includeUnknownGrade,
 * aggregatedSkipReasons, bySource } }` on success.
 */
export async function runCurriculumWatcherNow(options = {}) {
  const payload = {}
  if (Array.isArray(options.grades)) payload.grades = options.grades
  if (typeof options.includeUnknownGrade === 'boolean') {
    payload.includeUnknownGrade = options.includeUnknownGrade
  }
  try {
    const { data } = await runWatcherNowCallable(payload)
    if (data && data.ok === false) {
      return { ok: false, error: data.error || 'Run failed' }
    }
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: toError(err, 'Run failed') }
  }
}
