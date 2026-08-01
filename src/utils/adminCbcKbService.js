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
import { ref as storageRef } from 'firebase/storage'
import { uploadBytes } from '../firebase/attestedStorage'
import app, { db, storage } from '../firebase/config'
import { LEARNING_ENVIRONMENT_VALUES } from '../config/learningEnvironments'
import { compressImportedImage } from './quizDocumentImport'

const functions = getFunctions(app, 'us-central1')
const importBuiltInCbcTopicsCallable = httpsCallable(functions, 'importBuiltInCbcTopics', {
  timeout: 60_000,
})
const importCurriculumModulesCallable = httpsCallable(functions, 'importCurriculumModules', {
  timeout: 120_000,
})
const importBuiltInAssessmentFormatsCallable = httpsCallable(functions, 'importBuiltInAssessmentFormats', {
  timeout: 60_000,
})
const extractAssessmentFormatCallable = httpsCallable(functions, 'extractAssessmentFormat', {
  // Downloads the sample paper, runs Claude over it and writes the draft;
  // server-side timeoutSeconds is 300, so match it on the client.
  timeout: 300_000,
})
const analyzeExamPaperCallable = httpsCallable(functions, 'analyzeExamPaper', {
  // Same download + Claude path as extraction; server timeoutSeconds is 300.
  timeout: 300_000,
})
const synthesizeAssessmentFormatCallable = httpsCallable(functions, 'synthesizeAssessmentFormat', {
  timeout: 300_000,
})

const backfillKbSourceRefsCallable = httpsCallable(functions, 'backfillKbSourceRefs', {
  // Backfill walks every lesson module under the active KB version. With
  // hundreds of modules this can comfortably take a minute on a cold
  // start; the server-side timeoutSeconds is 540 so the bottleneck is
  // the client-side cancel budget.
  timeout: 540_000,
})
const expandKbLessonsCallable = httpsCallable(functions, 'expandKbLessons', {
  timeout: 540_000,
})

const LE_SET = new Set(LEARNING_ENVIRONMENT_VALUES)


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
 * Expand subtopics[] on every live KB topic into lessons/ subcollection docs.
 * Safe to run on an already-active version — uses merge:true so richer
 * existing lesson data is never overwritten. Pass dryRun=true to get counts
 * without writing.
 */
export async function expandKbLessons({ version = null, grade = null, subject = null, dryRun = false } = {}) {
  try {
    const result = await expandKbLessonsCallable({ version, grade, subject, dryRun })
    return { ok: true, ...(result?.data || {}) }
  } catch (err) {
    console.error('expandKbLessons failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Expand lessons failed.'),
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

// ── Assessment format profiles ───────────────────────────────────────────
// Stored under cbcKnowledgeBase/{version}/assessmentFormats/{id} — Zambian
// paper-format conventions the assessment generator grounds on. Admin-write
// / teacher-read (firestore.rules). Client mirror of the server-side
// validation in functions/teacherTools/assessmentFormats.js.

export const ASSESSMENT_FORMAT_TYPES = [
  { value: 'exercise', label: 'Exercise' },
  { value: 'topic_test', label: 'Topic Test' },
  { value: 'mid_term', label: 'Mid-Term Test' },
  { value: 'end_of_term', label: 'End of Term Test' },
  { value: 'mock_exam', label: 'Mock Examination' },
]
export const ASSESSMENT_FORMAT_BANDS = [
  { value: 'lower_primary', label: 'Lower Primary (ECE–G3)' },
  { value: 'upper_primary', label: 'Upper Primary (G4–G7)' },
  { value: 'junior_secondary', label: 'Junior Secondary (G8–G9, F1–F2)' },
  { value: 'senior_secondary', label: 'Senior Secondary (G10–G12, F3–F4)' },
]
const FORMAT_TYPE_SET = new Set(ASSESSMENT_FORMAT_TYPES.map((t) => t.value))
const FORMAT_BAND_SET = new Set(ASSESSMENT_FORMAT_BANDS.map((b) => b.value))

/** List all Firestore-stored format profiles. Returns [] on error. */
export async function listAssessmentFormats() {
  try {
    const version = await getActiveKbVersion()
    const snap = await getDocs(
      collection(db, 'cbcKnowledgeBase', version, 'assessmentFormats'),
    )
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('listAssessmentFormats failed', err)
    return []
  }
}

function cleanLines(v, maxItems, maxLen) {
  return (Array.isArray(v) ? v : [])
    .map((s) => String(s ?? '').trim()).filter(Boolean)
    .slice(0, maxItems).map((s) => s.slice(0, maxLen))
}

/**
 * Client mirror of the server's grade-code → band map (assessmentFormats.js
 * gradeToBand). Used to group Exam Paper Library samples and to validate the
 * grade picked for a synthesis. Returns null for unrecognised input.
 */
export function gradeToFormatBand(grade) {
  const g = String(grade || '').toUpperCase().trim()
  if (g === 'ECE' || g === 'ECE_N' || g === 'ECE_R') return 'lower_primary'
  const m = g.match(/^([GF])(\d{1,2})$/)
  if (!m) return null
  const n = Number(m[2])
  if (m[1] === 'F') {
    if (n >= 1 && n <= 2) return 'junior_secondary'
    if (n >= 3 && n <= 4) return 'senior_secondary'
    return null
  }
  if (n >= 1 && n <= 3) return 'lower_primary'
  if (n >= 4 && n <= 7) return 'upper_primary'
  if (n >= 8 && n <= 9) return 'junior_secondary'
  if (n >= 10 && n <= 12) return 'senior_secondary'
  return null
}

/** Normalise the optional per-grade nuance map; drops invalid grade keys. */
function cleanGradeNotes(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out = {}
  let count = 0
  for (const [k, val] of Object.entries(v)) {
    if (count >= 12) break
    const grade = String(k || '').toUpperCase().trim()
    if (!gradeToFormatBand(grade)) continue
    const note = String(val ?? '').trim().slice(0, 400)
    if (!note) continue
    out[grade] = note
    count += 1
  }
  return out
}

/**
 * Create or replace a format profile. Doc id is always derived from
 * type+band+subject so the server resolver's deterministic lookup finds it.
 * Throws with a readable message on invalid input (the admin form surfaces it).
 */
export async function saveAssessmentFormat(profile) {
  const assessmentType = String(profile.assessmentType || '').toLowerCase()
  const gradeBand = String(profile.gradeBand || '').toLowerCase()
  const subject = String(profile.subject || '_generic')
    .toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 60)
  if (!FORMAT_TYPE_SET.has(assessmentType)) throw new Error('Pick an assessment type.')
  if (!FORMAT_BAND_SET.has(gradeBand)) throw new Error('Pick a grade band.')
  const label = String(profile.label || '').trim().slice(0, 120)
  if (!label) throw new Error('A label is required.')

  const paperStructure = (Array.isArray(profile.paperStructure) ? profile.paperStructure : [])
    .filter((s) => s && typeof s === 'object')
    .slice(0, 6)
    .map((s) => ({
      name: String(s.name || '').trim().slice(0, 60),
      heading: String(s.heading || '').trim().slice(0, 120),
      instructions: String(s.instructions || '').trim().slice(0, 400),
      questionTypes: cleanLines(s.questionTypes, 6, 30),
      questionCountHint: String(s.questionCountHint || '').trim().slice(0, 30),
      marksShare: Math.round(Number(s.marksShare) || 0),
      marksPerQuestionHint: String(s.marksPerQuestionHint || '').trim().slice(0, 120),
    }))
  if (paperStructure.length === 0) throw new Error('Add at least one paper section.')
  const shareSum = paperStructure.reduce((sum, s) => sum + s.marksShare, 0)
  if (shareSum !== 100) throw new Error(`Section marks shares must sum to 100 (currently ${shareSum}).`)

  const coverInstructions = cleanLines(profile.coverInstructions, 8, 200)
  if (coverInstructions.length === 0) throw new Error('Add at least one front-page instruction line.')
  const numberingStyle = String(profile.numberingStyle || '').trim().slice(0, 600)
  if (!numberingStyle) throw new Error('Describe the numbering style.')

  const exemplarQuestions = (Array.isArray(profile.exemplarQuestions) ? profile.exemplarQuestions : [])
    .filter((q) => q && typeof q === 'object' && String(q.prompt || '').trim())
    .slice(0, 4)
    .map((q) => ({
      type: String(q.type || 'short_answer').trim().slice(0, 30),
      marks: Math.max(1, Math.round(Number(q.marks) || 1)),
      prompt: String(q.prompt || '').trim().slice(0, 500),
      note: String(q.note || '').trim().slice(0, 200),
    }))
  if (exemplarQuestions.length < 2) {
    throw new Error('Add 2-4 exemplar questions (paraphrased — never copy a real paper).')
  }

  const id = `${assessmentType}-${gradeBand}-${subject}`
  const payload = {
    id,
    assessmentType,
    gradeBand,
    subject,
    label,
    paperStructure,
    coverInstructions,
    numberingStyle,
    phrasingNotes: cleanLines(profile.phrasingNotes, 6, 300),
    marksConventions: cleanLines(profile.marksConventions, 6, 300),
    diagramConventions: cleanLines(profile.diagramConventions, 4, 400),
    // Richer signals carried over when a profile is synthesised from the
    // Exam Paper Library. Optional — manual/seed profiles simply omit them.
    answerSpaceConventions: cleanLines(profile.answerSpaceConventions, 6, 300),
    pictureUsage: cleanLines(profile.pictureUsage, 6, 400),
    gradeNotes: cleanGradeNotes(profile.gradeNotes),
    exemplarQuestions,
    status: 'active',
    origin: ['builtin_seed', 'pdf_extract', 'docx_extract', 'library_synthesis'].includes(profile.origin) ?
      profile.origin : 'manual',
    sourceNote: String(profile.sourceNote || '').trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  }

  const version = await getActiveKbVersion()
  await setDoc(doc(db, 'cbcKnowledgeBase', version, 'assessmentFormats', id), payload)
  return id
}

/** Delete a format profile. */
export async function deleteAssessmentFormat(id) {
  if (!id) return false
  try {
    const version = await getActiveKbVersion()
    await deleteDoc(doc(db, 'cbcKnowledgeBase', version, 'assessmentFormats', id))
    return true
  } catch (err) {
    console.error('deleteAssessmentFormat failed', err)
    return false
  }
}

// ── Format-profile drafts (Phase 2: extract from a sample paper) ─────────
// extractAssessmentFormat distils a draft profile from an uploaded sample
// (PDF/DOCX) or an existing pastPapers doc. Drafts live in
// cbcKnowledgeBase/{version}/assessmentFormatDrafts (admin-only rules) and
// are ignored by the generator until approved into assessmentFormats/.

const SAMPLE_EXTS = new Set(['pdf', 'docx'])
const SAMPLE_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const SAMPLE_CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/**
 * Upload a sample paper to assessment-format-samples/{uid}/… and return the
 * storage path to hand to extractAssessmentFormat / analyzeExamPaper. Accepts
 * .pdf and .docx, plus photos of papers (.jpg/.png/.webp) — phone snaps are
 * compressed to a readable JPEG (≤2000px wide) so they stay well under the
 * per-image vision limit while remaining legible. Throws a readable message
 * on unsupported files.
 */
export async function uploadAssessmentFormatSample(file, uid) {
  if (!file || !uid) throw new Error('Pick a file first.')
  const ext = String(file.name || '').split('.').pop().toLowerCase()
  const isImage = SAMPLE_IMAGE_EXTS.has(ext)
  if (!SAMPLE_EXTS.has(ext) && !isImage) {
    throw new Error('Supported files: .pdf, .docx, or a photo (.jpg/.png/.webp).')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('File is over the 25 MB limit.')
  }

  let body = file
  let contentType = SAMPLE_CONTENT_TYPES[ext]
  let storageExt = ext
  if (isImage) {
    // Re-encode to JPEG; keep enough resolution to read a full page of text.
    body = await compressImportedImage(file, 2000, 0.82)
    contentType = 'image/jpeg'
    storageExt = 'jpg'
  }

  const baseName = String(file.name || 'sample')
    .replace(/\.[^.]+$/, '')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80) || 'sample'
  const storagePath =
    `assessment-format-samples/${uid}/${Date.now()}-${baseName}.${storageExt}`
  await uploadBytes(storageRef(storage, storagePath), body, { contentType })
  return storagePath
}

/**
 * Run the extraction. Pass either { storagePath } (from
 * uploadAssessmentFormatSample) or { paperId } (a pastPapers doc id),
 * plus the admin's classification of the paper.
 * Returns { ok, draftId, draft, validationErrors, warning } or { ok:false, error }.
 */
export async function extractAssessmentFormat({ storagePath = null, paperId = null, assessmentType, gradeBand, subject }) {
  try {
    const result = await extractAssessmentFormatCallable({
      storagePath, paperId, assessmentType, gradeBand, subject,
    })
    return { ok: true, ...(result?.data || {}) }
  } catch (err) {
    console.error('extractAssessmentFormat failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Extraction failed.'),
    }
  }
}

/** List pending format-profile drafts. Returns [] on error. */
export async function listAssessmentFormatDrafts() {
  try {
    const version = await getActiveKbVersion()
    const snap = await getDocs(
      collection(db, 'cbcKnowledgeBase', version, 'assessmentFormatDrafts'),
    )
    return snap.docs.map((d) => ({ draftId: d.id, ...d.data() }))
  } catch (err) {
    console.error('listAssessmentFormatDrafts failed', err)
    return []
  }
}

/** Delete (reject) a draft. */
export async function deleteAssessmentFormatDraft(draftId) {
  if (!draftId) return false
  try {
    const version = await getActiveKbVersion()
    await deleteDoc(doc(db, 'cbcKnowledgeBase', version, 'assessmentFormatDrafts', draftId))
    return true
  } catch (err) {
    console.error('deleteAssessmentFormatDraft failed', err)
    return false
  }
}

/**
 * Approve a draft: validate + publish through saveAssessmentFormat (the
 * same path manual profiles take), then remove the draft. Throws the
 * validation error if the profile still needs fixes.
 */
export async function approveAssessmentFormatDraft(draft) {
  const id = await saveAssessmentFormat(draft)
  if (draft?.draftId) await deleteAssessmentFormatDraft(draft.draftId)
  return id
}

/** Shallow list of past papers for the extraction picker (admin-read). */
export async function listPastPapersForExtraction() {
  try {
    const snap = await getDocs(collection(db, 'pastPapers'))
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .map((p) => ({
        id: p.id,
        label: [p.title, p.grade, p.subject, p.year].filter(Boolean).join(' · ') || p.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch (err) {
    console.error('listPastPapersForExtraction failed', err)
    return []
  }
}

/**
 * One-click admin action: copy the built-in Zambian format profiles into
 * Firestore so they become editable. Returns { ok, written, totalInCode }.
 */
export async function importBuiltInAssessmentFormats() {
  try {
    const result = await importBuiltInAssessmentFormatsCallable({})
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('importBuiltInAssessmentFormats failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Import failed'),
    }
  }
}

// ── Exam Paper Library ───────────────────────────────────────────────────
// Real uploaded Zambian assessment papers, each analysed into a structured
// per-paper doc at cbcKnowledgeBase/{version}/examPaperSamples/{id}
// (admin-only rules). The corpus the format synthesiser learns the national
// assessment style from. Uploads reuse the assessment-format-samples/ path.

/**
 * Analyse one uploaded paper into the library. Pass either { storagePath }
 * (from uploadAssessmentFormatSample) or { paperId } (a pastPapers doc id),
 * plus the admin's classification (precise grade, subject, assessmentType,
 * and optional title/year/region).
 * Returns { ok, sampleId, analysis, warning } or { ok:false, error }.
 */
export async function analyzeExamPaper({
  storagePath = null, paperId = null,
  grade, subject, assessmentType, title = '', year = null, region = '',
}) {
  try {
    const result = await analyzeExamPaperCallable({
      storagePath, paperId, grade, subject, assessmentType, title, year, region,
    })
    return { ok: true, ...(result?.data || {}) }
  } catch (err) {
    console.error('analyzeExamPaper failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Analysis failed.'),
    }
  }
}

/** List all analysed exam-paper samples in the active KB version. */
export async function listExamPaperSamples() {
  try {
    const version = await getActiveKbVersion()
    const snap = await getDocs(
      collection(db, 'cbcKnowledgeBase', version, 'examPaperSamples'),
    )
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('listExamPaperSamples failed', err)
    return []
  }
}

/** Remove one sample from the library. */
export async function deleteExamPaperSample(id) {
  if (!id) return false
  try {
    const version = await getActiveKbVersion()
    await deleteDoc(doc(db, 'cbcKnowledgeBase', version, 'examPaperSamples', id))
    return true
  } catch (err) {
    console.error('deleteExamPaperSample failed', err)
    return false
  }
}

/**
 * Synthesise a consolidated format-profile draft from every analysed sample
 * for a (assessmentType, gradeBand, subject). Lands in assessmentFormatDrafts
 * for the same review-and-approve flow as extracted drafts.
 * Returns { ok, draftId, draft, validationErrors, sampleCount, warning }.
 */
export async function synthesizeAssessmentFormat({ assessmentType, gradeBand, subject }) {
  try {
    const result = await synthesizeAssessmentFormatCallable({
      assessmentType, gradeBand, subject,
    })
    return { ok: true, ...(result?.data || {}) }
  } catch (err) {
    console.error('synthesizeAssessmentFormat failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Synthesis failed.'),
    }
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
