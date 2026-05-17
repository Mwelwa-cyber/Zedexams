/**
 * Admin CBC Knowledge Base service.
 *
 * Reads/writes Firestore `cbcKnowledgeBase/{KB_VERSION}/topics/*`.
 * Firestore rules allow admin-only writes (already in firestore.rules).
 */

import {
  collection, deleteDoc, doc, getDocs, query, orderBy,
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

const LE_SET = new Set(LEARNING_ENVIRONMENT_VALUES)

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

// Must match the server-side KB_VERSION in functions/teacherTools/cbcKnowledge.js
export const KB_VERSION = 'cbc-kb-2026-04-seed'

/** List all Firestore-stored topics. Returns empty array on error. */
export async function listCbcTopics() {
  try {
    const snap = await getDocs(query(
      collection(db, 'cbcKnowledgeBase', KB_VERSION, 'topics'),
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
    term: Number(topic.term) || 1,
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

  await setDoc(doc(db, 'cbcKnowledgeBase', KB_VERSION, 'topics', id), payload)
  return id
}

/** Delete a topic. */
export async function deleteCbcTopic(id) {
  if (!id) return false
  try {
    await deleteDoc(doc(db, 'cbcKnowledgeBase', KB_VERSION, 'topics', id))
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
    const snap = await getDocs(query(
      collection(db, 'cbcKnowledgeBase', KB_VERSION, 'topics', topicId, 'lessons'),
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

  await setDoc(
    doc(db, 'cbcKnowledgeBase', KB_VERSION, 'topics', topicId, 'lessons', id),
    payload,
  )
  return id
}

/** Delete one lesson module. */
export async function deleteLesson(topicId, lessonId) {
  if (!topicId || !lessonId) return false
  try {
    await deleteDoc(
      doc(db, 'cbcKnowledgeBase', KB_VERSION, 'topics', topicId, 'lessons', lessonId),
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
