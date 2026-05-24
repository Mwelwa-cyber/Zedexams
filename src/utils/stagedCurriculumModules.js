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
const rejectCallable = httpsCallable(functions, 'rejectIngestedCurriculumModule', {
  timeout: 15_000,
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

export async function rejectCurriculumModule(curriculumId, reason) {
  if (!curriculumId) return { ok: false, error: 'Missing curriculumId' }
  try {
    const { data } = await rejectCallable({ curriculumId, reason: reason || null })
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: toError(err, 'Reject failed') }
  }
}
