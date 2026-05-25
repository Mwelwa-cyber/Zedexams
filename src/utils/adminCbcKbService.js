/**
 * Admin CBC Knowledge Base service.
 *
 * Reads/writes Firestore `cbcKnowledgeBase/{KB_VERSION}/topics/*`.
 * Firestore rules allow admin-only writes (already in firestore.rules).
 */

import {
  collection, deleteDoc, doc, getDoc, getDocs, query, orderBy,
  serverTimestamp, setDoc,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'
import { LEARNING_ENVIRONMENT_VALUES } from '../config/learningEnvironments'

const functions = getFunctions(app, 'us-central1')
const importBuiltInCbcTopicsCallable = httpsCallable(functions, 'importBuiltInCbcTopics', {
  timeout: 60_000,
})
const importCurriculumModulesCallable = httpsCallable(functions, 'importCurriculumModules', {
  timeout: 120_000,
})
const preflightCurriculumRefCallable = httpsCallable(functions, 'preflightCurriculumRef', {
  timeout: 20_000,
})
const backfillKbSourceRefsCallable = httpsCallable(functions, 'backfillKbSourceRefs', {
  // Backfill walks every lesson module under the active KB version. With
  // hundreds of modules this can comfortably take a minute on a cold
  // start; the server-side timeoutSeconds is 540 so the bottleneck is
  // the client-side cancel budget.
  timeout: 540_000,
})

const LE_SET = new Set(LEARNING_ENVIRONMENT_VALUES)

/**
 * Ask the server-side strict resolver whether a given subtopic will be
 * accepted by the learner-AI dispatcher before queueing a task.
 * Returns { ok, reason?, message? }.
 */
export async function preflightCurriculumRef({ grade, subject, topic, subtopic, term }) {
  try {
    const result = await preflightCurriculumRefCallable({
      grade, subject, topic, subtopic, term,
    })
    const data = (result && result.data) || {}
    if (data.ok) return { ok: true }
    return { ok: false, reason: data.reason || 'unknown', message: data.message || null }
  } catch (err) {
    return {
      ok: false,
      reason: err?.code === 'permission-denied' ? 'permission_denied' : 'callable_error',
      message: err?.message || 'Preflight failed',
    }
  }
}

/**
 * Run the strict-resolver source-doc-ref backfill from the admin UI.
 * Defaults to a dry run so a misclick reports rather than writes — pass
 * `{ dryRun: false }` to actually apply.
 *
 * Returns the full server response on success, or `{ ok:false, error }`
 * shaped like the other admin callables in this file.
 */
export async function backfillKbSourceRefs({ dryRun = true, grade = null, subject = null } = {}) {
  try {
    const result = await backfillKbSourceRefsCallable({ dryRun, grade, subject })
    return { ok: true, ...(result?.data || {}) }
  } catch (err) {
    console.error('backfillKbSourceRefs failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Backfill failed.'),
    }
  }
}

/**
 * Count approvedSyllabi docs that match a (grade, subject) tuple. The
 * backfill cannot link a subtopic unless at least one approved-syllabus
 * doc exists for its grade+subject, so the admin UI surfaces this count
 * to explain why "Backfill" would otherwise be a no-op.
 *
 * Returns `{ total, byTerm: { 1: n, 2: n, 3: n, null: n } }`. Errors
 * resolve to `{ total: 0, byTerm: {} }` so the UI degrades gracefully.
 */
export async function countApprovedSyllabiFor(grade, subject) {
  const out = { total: 0, byTerm: {} }
  if (!grade || !subject) return out
  try {
    const normGrade = String(grade).toUpperCase().replace(/\s+/g, '')
    const normSubject = String(subject).toLowerCase().replace(/[^a-z]/g, '_')
    // approvedSyllabi is small (one doc per uploaded syllabus). Reading
    // the full collection client-side is OK and avoids a composite index.
    const snap = await getDocs(collection(db, 'approvedSyllabi'))
    for (const d of snap.docs) {
      const v = d.data() || {}
      const g = String(v.grade || '').toUpperCase().replace(/\s+/g, '')
      const s = String(v.subject || '').toLowerCase().replace(/[^a-z]/g, '_')
      if (g !== normGrade || s !== normSubject) continue
      out.total += 1
      const t = Number(v.term)
      const tKey = Number.isInteger(t) && t >= 1 && t <= 3 ? String(t) : 'null'
      out.byTerm[tKey] = (out.byTerm[tKey] || 0) + 1
    }
    return out
  } catch (err) {
    console.warn('countApprovedSyllabiFor failed', err)
    return out
  }
}

/**
 * One-click admin action: copy the 90 built-in G1-9 topics into Firestore so
 * they become editable through the admin UI. Returns { ok, written, totalInCode }.
 */
export async function importBuiltInTopics() {
  try {
    const result = await importBuiltInCbcTopicsCallable({})
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('importBuiltInTopics failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Import failed'),
    }
  }
}

// Seed default KB version. Used as the fallback when cbcKnowledgeBase/_meta
// doesn't exist yet (i.e. before the Phase C approve-and-activate flow has
// ever run). Must match KB_DEFAULT_VERSION in functions/teacherTools/cbcKnowledge.js.
export const KB_VERSION = 'cbc-kb-2026-04-seed'

// In-memory cache for the active-version pointer. Same 10s TTL as the
// server-side getActiveKbState() so a Phase D rollback feels equally fast
// from both the studio (server) and admin UI (client).
const ACTIVE_STATE_TTL_MS = 10_000
let _activeStateCache = null
let _activeStateAt = 0

/**
 * Read the runtime-active KB version from cbcKnowledgeBase/_meta. Falls back
 * to KB_VERSION when the doc is missing or unreadable, so the admin UI keeps
 * working before any active-version pointer is ever written.
 */
export async function getActiveKbVersion() {
  const now = Date.now()
  if (_activeStateCache && (now - _activeStateAt) < ACTIVE_STATE_TTL_MS) {
    return _activeStateCache.version
  }
  try {
    const snap = await getDoc(doc(db, 'cbcKnowledgeBase', '_meta'))
    const data = snap.exists() ? (snap.data() || {}) : {}
    const version = (typeof data.version === 'string' && data.version) ?
      data.version : KB_VERSION
    // Last-write-wins is the intended behaviour for this module-level cache —
    // overlapping callers should converge on the most recent fetch.
    // eslint-disable-next-line require-atomic-updates
    _activeStateCache = { version }
    // eslint-disable-next-line require-atomic-updates
    _activeStateAt = now
    return version
  } catch (err) {
    console.warn('getActiveKbVersion fallback to default', err)
    _activeStateCache = { version: KB_VERSION }
    _activeStateAt = now
    return KB_VERSION
  }
}

/** List all Firestore-stored topics. Returns empty array on error. */
export async function listCbcTopics() {
  try {
    const version = await getActiveKbVersion()
    const snap = await getDocs(query(
      collection(db, 'cbcKnowledgeBase', version, 'topics'),
      orderBy('grade'),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('listCbcTopics failed', err)
    return []
  }
}

/** Create or replace a topic. `id` is generated from grade+subject+topic. */
export async function saveCbcTopic(topic) {
  const id = buildTopicId(topic)
  if (!id) throw new Error('Grade, subject and topic are required.')

  const payload = {
    id,
    grade: String(topic.grade || '').toUpperCase().slice(0, 10),
    subject: String(topic.subject || '').toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 40),
    topic: String(topic.topic || '').trim().slice(0, 200),
    subtopics: Array.isArray(topic.subtopics) ?
      topic.subtopics.filter(Boolean).map((s) => String(s).slice(0, 200)) : [],
    specificOutcomes: Array.isArray(topic.specificOutcomes) ?
      topic.specificOutcomes.filter(Boolean).map((s) => String(s).slice(0, 500)) : [],
    keyCompetencies: Array.isArray(topic.keyCompetencies) ?
      topic.keyCompetencies.filter(Boolean).map((s) => String(s).slice(0, 200)) : [],
    values: Array.isArray(topic.values) ?
      topic.values.filter(Boolean).map((s) => String(s).slice(0, 100)) : [],
    suggestedMaterials: Array.isArray(topic.suggestedMaterials) ?
      topic.suggestedMaterials.filter(Boolean).map((s) => String(s).slice(0, 300)) : [],
    updatedAt: serverTimestamp(),
  }
  if (!payload.topic) throw new Error('Topic name is required.')

  const version = await getActiveKbVersion()
  await setDoc(doc(db, 'cbcKnowledgeBase', version, 'topics', id), payload)
  return id
}

/** Delete a topic. */
export async function deleteCbcTopic(id) {
  if (!id) return false
  try {
    const version = await getActiveKbVersion()
    await deleteDoc(doc(db, 'cbcKnowledgeBase', version, 'topics', id))
    return true
  } catch (err) {
    console.error('deleteCbcTopic failed', err)
    return false
  }
}

/** Summary count for the dashboard. */
export async function getCbcKbSummary() {
  try {
    const rows = await listCbcTopics()
    const byGrade = rows.reduce((acc, r) => {
      acc[r.grade] = (acc[r.grade] || 0) + 1
      return acc
    }, {})
    return { total: rows.length, byGrade }
  } catch {
    return { total: 0, byGrade: {} }
  }
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

/**
 * Subtopic compatibility helper (client-side mirror of the server one in
 * functions/teacherTools/cbcKnowledge.js).
 *
 * Legacy topic docs store subtopics as plain strings. The Phase-A syllabus
 * parser writes them as
 *   { name, specificCompetence, learningActivities, expectedStandard }
 * objects to preserve the richer per-subtopic detail. This helper hides
 * the shape difference from any caller that just wants a display string.
 */
export function subtopicName(s) {
  if (s == null) return ''
  if (typeof s === 'string') return s
  if (typeof s === 'object' && typeof s.name === 'string') return s.name
  return String(s)
}

function buildTopicId(t) {
  const g = slug(t.grade)
  const s = slug(t.subject)
  const topic = slug(t.topic)
  if (!g || !s || !topic) return null
  return `${g}-${s}-${topic}`
}

/**
 * The slug-based topic id the generators' resolver computes from
 * grade+subject+topic. Lesson modules MUST be stored under this id (not a
 * topic's raw Firestore doc id, which for seed-imported topics uses
 * abbreviations) so manual edits and the resolver agree. Returns null if
 * grade/subject/topic are incomplete.
 */
export function curriculumTopicDocId(topic) {
  return buildTopicId(topic || {})
}

// ── Lesson-level curriculum modules ──────────────────────────────────────
// Stored under cbcKnowledgeBase/{KB_VERSION}/topics/{topicId}/lessons/{id}.
// Admin-write / teacher-read (firestore.rules). These are the source of
// truth the generators ground against.

const STR_ARRAY_KEYS = [
  'outcomes', 'competencies', 'vocabulary', 'teacherActivities',
  'learnerActivities', 'teachingMaterials', 'assessmentCriteria',
  'exercises', 'remedialActivities', 'extensionActivities',
]

/**
 * Deterministic sub-topic-module doc id — MUST match server buildModuleId()
 * in functions/teacherTools/curriculumModuleSchema.js. One module per
 * (sub-topic, term); the teacher chooses the lesson split at generation.
 */
function buildModuleId(subtopic, term) {
  const sub = slug(subtopic)
  if (!sub) return null
  const t = Number(term)
  const tn = Number.isInteger(t) && t >= 1 && t <= 3 ? t : 1
  return `${sub}-t${tn}`
}

function cleanArr(v) {
  return Array.isArray(v) ?
    v.map((s) => String(s ?? '').trim()).filter(Boolean) : []
}

/** List all sub-topic modules for a topic, ordered by sub-topic. */
export async function listLessons(topicId) {
  if (!topicId) return []
  try {
    const version = await getActiveKbVersion()
    const snap = await getDocs(query(
      collection(db, 'cbcKnowledgeBase', version, 'topics', topicId, 'lessons'),
      orderBy('subtopic'),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('listLessons failed', err)
    return []
  }
}

/**
 * Create or replace one sub-topic module. One module per (sub-topic, term);
 * the teacher chooses how many lessons to split it into at generation time,
 * so we store only a `suggestedLessons` default (one per outcome). Throws on
 * missing required fields so the admin form surfaces the problem.
 */
export async function saveLesson(topicId, lesson) {
  if (!topicId) throw new Error('A topic is required.')
  const subtopic = String(lesson.subtopic || '').trim().slice(0, 200)
  const term = Number(lesson.term) >= 1 && Number(lesson.term) <= 3 ?
    Number(lesson.term) : 1
  const outcomes = cleanArr(lesson.outcomes).map((s) => s.slice(0, 500))
  const askedSuggested = Number(lesson.suggestedLessons ?? lesson.totalLessons)
  const suggestedLessons = Number.isInteger(askedSuggested) &&
    askedSuggested >= 1 ? askedSuggested : Math.max(1, outcomes.length)

  if (!subtopic) throw new Error('Sub-topic is required.')
  if (outcomes.length === 0) {
    throw new Error('At least one specific learning outcome is required.')
  }

  const id = buildModuleId(subtopic, term)
  if (!id) throw new Error('Could not derive a stable sub-topic id.')

  const payload = {
    id,
    topicId,
    grade: String(lesson.grade || '').toUpperCase().slice(0, 10),
    subject: String(lesson.subject || '').toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 40),
    term,
    topic: String(lesson.topic || '').trim().slice(0, 200),
    subtopic,
    suggestedLessons,
    learningEnvironmentOptions: cleanArr(lesson.learningEnvironmentOptions)
      .map((s) => s.toLowerCase().replace(/[^a-z_]/g, '_'))
      .filter((s) => LE_SET.has(s)),
    outcomes,
    contentSummary: String(lesson.contentSummary || '').trim().slice(0, 8000),
    origin: lesson.origin === 'bulk_import' ? 'bulk_import' : 'manual',
    updatedAt: serverTimestamp(),
  }
  for (const k of STR_ARRAY_KEYS) {
    if (k === 'outcomes') continue
    payload[k] = cleanArr(lesson[k]).map((s) => s.slice(0, 800))
  }

  const version = await getActiveKbVersion()
  await setDoc(
    doc(db, 'cbcKnowledgeBase', version, 'topics', topicId, 'lessons', id),
    payload,
  )
  return id
}

/** Delete one lesson module. */
export async function deleteLesson(topicId, lessonId) {
  if (!topicId || !lessonId) return false
  try {
    const version = await getActiveKbVersion()
    await deleteDoc(
      doc(db, 'cbcKnowledgeBase', version, 'topics', topicId, 'lessons', lessonId),
    )
    return true
  } catch (err) {
    console.error('deleteLesson failed', err)
    return false
  }
}

/**
 * Bulk-import curriculum modules from a parsed JSON array. The Cloud
 * Function validates every row authoritatively (admin SDK bypasses rules)
 * and reports per-row errors. Returns { ok, written, skipped, errors }.
 */
export async function bulkImportCurriculumModules(rows) {
  try {
    const result = await importCurriculumModulesCallable({ modules: rows })
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('bulkImportCurriculumModules failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Import failed'),
    }
  }
}
