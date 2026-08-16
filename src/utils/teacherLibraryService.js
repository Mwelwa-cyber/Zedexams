/**
 * Teacher Library — Firestore service layer.
 *
 * Reads from the aiGenerations collection (written by the Cloud Functions).
 * Writes allowed: toggle pin (teacherEdited bool), delete.
 *
 * Security: Firestore rules already restrict reads/writes to the owner,
 * but we still filter by ownerUid client-side to scope the query.
 */

import {
  addDoc, collection, doc, getDoc, getDocs, deleteDoc, updateDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { LIBRARY_SECTION_BY_ID, LIBRARY_TYPES } from '../config/library'
import { TOOL_TO_LIBRARY_TYPE, classifyForLibrary } from './libraryClassification'
import { buildRequestKey } from './requestControl.js'
import { deduplicatedRequest } from './requestDeduplication.js'

const GENERATIONS_PAGE_SIZE = 60

/**
 * List the current user's generations, newest first. Optional filters.
 *
 * @param {object} opts
 *   uid (required)
 *   tool  (optional) one of "lesson_plan" | "worksheet" | "flashcards"
 *   grade (optional) e.g. "G5"
 *   subject (optional) e.g. "mathematics"
 */
export async function listMyGenerations(opts = {}) {
  const {uid, tool, grade, subject} = opts
  if (!uid) return []

  // Several surfaces call this for the SAME teacher within moments of each
  // other (the dashboard summary, the Library page, a studio's "connected?"
  // probe) — share one Firestore round-trip instead of firing one per
  // caller. Scoped by uid (never shared across teachers) + every filter that
  // affects the result.
  const key = buildRequestKey('teacher-library-generations', uid, tool, grade, subject)
  return deduplicatedRequest(key, () => fetchMyGenerations(uid, {tool, grade, subject}))
}

async function fetchMyGenerations(uid, {tool, grade, subject}) {
  // Base query: own generations, newest first. We do tool/grade/subject
  // filtering client-side for simplicity; server-side indexing would need
  // a composite index for each combination. With ≤60 recent items this is
  // cheap and avoids index deploys for every filter combination.
  const q = query(
    collection(db, 'aiGenerations'),
    where('ownerUid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(GENERATIONS_PAGE_SIZE),
  )

  let snap
  try {
    snap = await getDocs(q)
  } catch (err) {
    // If the composite index (ownerUid + createdAt) is missing, Firestore
    // throws a FAILED_PRECONDITION with a link to create it. Surface a
    // friendly error the UI can display.
    console.error('listMyGenerations query failed', err)
    throw new Error(
      err?.code === 'failed-precondition' ?
        'The library index is still being built. Try again in a minute.' :
        'Could not load your library right now. Please try again.',
    )
  }

  const rows = snap.docs.map((d) => normaliseGeneration({id: d.id, ...d.data()}))
  return rows.filter((r) => {
    if (tool && r.tool !== tool) return false
    if (grade && r.inputs?.grade !== grade) return false
    if (subject && r.inputs?.subject !== subject) return false
    return true
  })
}

/**
 * Existence probe: does the teacher have ANY saved generation of `tool`?
 * Used by the Teaching Profile completion checklist ("Scheme of Work
 * connected", "Class Timetable connected"). Equality-only + limit(1), so it
 * costs at most one document read and needs no composite index (Firestore
 * merges single-field indexes for pure-equality queries). Best-effort: false
 * on any failure — the checklist item simply stays "Optional".
 */
export async function hasGenerationOfTool(uid, tool) {
  if (!uid || !tool) return false
  try {
    const snap = await getDocs(query(
      collection(db, 'aiGenerations'),
      where('ownerUid', '==', uid),
      where('tool', '==', tool),
      limit(1),
    ))
    return !snap.empty
  } catch (err) {
    console.warn('hasGenerationOfTool failed:', err)
    return false
  }
}

/**
 * Fetch a single generation by id.
 *
 * Returns null for the "no such document / not yours" cases and RE-THROWS a
 * genuine load failure, so a caller can tell a deleted doc (dead end) from a
 * transient error (retryable) instead of rendering both as "not found".
 *
 * The distinction is subtle because of the owner-only read rule. `aiGenerations`
 * read requires `resource.data.ownerUid == request.auth.uid || isAdmin()`
 * (firestore.rules), so for a normal teacher a DELETED or FOREIGN doc is
 * *denied* — `getDoc` rejects with `permission-denied` before `snap.exists()`
 * is ever reached. That denial IS the "missing / not yours" case, not a
 * failure, so it maps to null (an admin, who is allowed to read any doc, gets
 * the `!snap.exists()` path for a truly deleted one — also null). Every OTHER
 * error (network drop, `unavailable`, a parse throw in normaliseGeneration) is
 * a real failure and re-thrown.
 *
 * Callers that prefer fail-soft opt in explicitly with `.catch(() => null)`
 * (RecordOfWorkStudio) or a try/catch that skips the id (TimetablePanel); the
 * ones that surface an error/retry UI let it reject (LibraryItemDetail,
 * LessonPlanStudio).
 */
export async function getGeneration(id) {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, 'aiGenerations', id))
    if (!snap.exists()) return null
    return normaliseGeneration({id: snap.id, ...snap.data()})
  } catch (err) {
    if (err?.code === 'permission-denied') return null
    throw err
  }
}

/**
 * Normalise legacy generation shapes at the read boundary so every
 * downstream UI/util can rely on the canonical {tool, inputs} keys.
 *
 * The Lesson Plan Studio (legacy /public/studio/* editor) writes docs as
 *   { tool: 'lesson-plan', meta: {klass, subject, topic, termWeek, …},
 *     data: {…}, html: '…' }
 * while the Cloud Functions pipeline writes
 *   { tool: 'lesson_plan',  inputs: {grade, subject, topic, term, …},
 *     output: {…} }
 * This helper translates the former to the latter on the way out — the
 * original `meta` / `data` / `html` fields are preserved (read-only) so
 * the detail view can still render the studio's pre-rendered HTML.
 */
function normaliseGeneration(row) {
  if (!row || typeof row !== 'object') return row
  let tool = row.tool
  if (tool === 'lesson-plan') tool = 'lesson_plan'
  // Build inputs from meta if missing — needed for the detail view's
  // grade/subject pills and the title fallback.
  let inputs = row.inputs
  if (!inputs && row.meta && typeof row.meta === 'object') {
    const m = row.meta
    const termOnly = (() => {
      const tw = String(m.termWeek || '')
      const match = tw.match(/Term\s*(\d)/i)
      return match ? `Term ${match[1]}` : null
    })()
    inputs = {
      grade:    m.klass || m.grade || null,
      subject:  m.subject || null,
      topic:    m.topic || null,
      subtopic: m.subtopic || null,
      term:     termOnly,
    }
  }
  return { ...row, tool, inputs: inputs || row.inputs }
}

/**
 * Delete a generation.
 */
export async function deleteGeneration(id) {
  if (!id) return false
  try {
    await deleteDoc(doc(db, 'aiGenerations', id))
    return true
  } catch (err) {
    console.error('deleteGeneration failed', err)
    return false
  }
}

/**
 * Update the teacherEdited flag. Our Firestore rules allow the owner to
 * toggle this field and `visibility` + `exportedFormats` only.
 */
export async function markAsEdited(id, edited = true) {
  if (!id) return false
  try {
    await updateDoc(doc(db, 'aiGenerations', id), {teacherEdited: Boolean(edited)})
    return true
  } catch (err) {
    console.error('markAsEdited failed', err)
    return false
  }
}

/**
 * Replace the `output` field of a generation. Used by in-place editing in
 * the library detail view — e.g. personalising the header of a lesson plan
 * (teacher name, date, school) without re-running Claude.
 */
export async function updateGenerationOutput(id, output) {
  if (!id || !output || typeof output !== 'object') return false
  try {
    await updateDoc(doc(db, 'aiGenerations', id), {
      output,
      teacherEdited: true,
    })
    return true
  } catch (err) {
    console.error('updateGenerationOutput failed', err)
    return false
  }
}

/**
 * Attach the library coordinates ({syllabus, gradeForm, term, subject,
 * assessmentType, path, libraryType}) to a saved generation. Called by
 * studios immediately after generation succeeds so the doc lands in the
 * correct library folder. Idempotent.
 *
 * Firestore rules permit only `output | teacherEdited | visibility |
 * exportedFormats | library` to be updated by the owner — keep this set
 * in sync with `firestore.rules` if you change it.
 */
export async function setGenerationLibrary(id, library) {
  if (!id || !library || typeof library !== 'object') return false
  try {
    await updateDoc(doc(db, 'aiGenerations', id), { library })
    return true
  } catch (err) {
    console.error('setGenerationLibrary failed', err)
    return false
  }
}

/**
 * Re-file a saved library document into a different folder.
 *
 * The library shows rows from TWO collections — `aiGenerations` (everything a
 * studio generates) and `assessments` (papers the Assessment Studio saves,
 * adapted into library rows by TeacherLibrary.jsx). A move has to write to
 * whichever one the row actually came from; writing every move to
 * aiGenerations would silently do nothing for half the library, and the UI
 * would report success because the update itself succeeded against a document
 * id that exists in the other collection or not at all.
 *
 * Both collections already permit this write: `library` is in the owner's
 * changedKeys allowlist on aiGenerations, and assessments validates the merged
 * document, so a library-only patch leaves every other field as it was. No
 * rules change is needed to move a document.
 *
 * Throws with a teacher-presentable message — the caller surfaces it in the
 * dialog rather than leaving the document looking moved when it is not.
 *
 * @param {object} row      the library row (needs `id`; `tool` picks the collection)
 * @param {object} library  coords from coordsFromDraft()
 */
export async function moveLibraryDocument(row, library) {
  if (!row?.id) throw new Error('This document cannot be moved.')
  if (!library || typeof library !== 'object') throw new Error('Pick a folder first.')
  const collectionName = row.tool === 'assessment' ? 'assessments' : 'aiGenerations'
  try {
    await updateDoc(doc(db, collectionName, row.id), { library })
    return library
  } catch (err) {
    console.error('moveLibraryDocument failed', err)
    throw new Error('Could not move this document. Check your connection and try again.')
  }
}

/**
 * One-shot helper used by studios: classify the studio's raw inputs into
 * canonical library coords, then patch the saved generation. Silent
 * no-op when classification fails or the row isn't owned by the user.
 */
export async function attachLibraryToGeneration(generationId, classification) {
  const lib = classifyForLibrary(classification)
  if (!generationId || !lib) return null
  await setGenerationLibrary(generationId, lib)
  return lib
}

/**
 * Save a Lesson Plan Studio plan into the teacher library.
 *
 * The Lesson Plan is the one AI tool whose library copy is assembled in the
 * browser: the generate callable only logs a lightweight cost record, while
 * the studio holds the full plan JSON + the pre-rendered HTML. firestore.rules
 * therefore allows the owner to CREATE a `lesson_plan` doc directly, but only
 * with the studio's field set — `inputs`, `library`, `meta`, `data`, `html`,
 * `studioFormat` (notably NOT `output`, which is reserved for the server
 * pipeline + in-place library edits). We save in that exact shape:
 *   - `data` — the plan JSON (used by the library's PDF/DOCX exporters), and
 *   - `html` — renderPlanHtml() output, rendered verbatim by LegacyStudioFrame
 *     so the library view is byte-identical to the studio preview (including
 *     any manual / AI edits and illustrations the teacher applied).
 *
 * Each save creates a fresh library snapshot — there is no in-place update path
 * because the update rule forbids changing `data` / `html`, and a plan re-saved
 * as `output` would render through a different code path and lose fidelity.
 * The studio gates duplicate saves by content signature instead.
 *
 * @param {object} args
 *   uid (required), planJson (required), html (required), meta, studioFormat,
 *   inputs ({grade, subject, topic, subtopic, term}), classification
 * @returns {Promise<string>} the new generation id
 */
export async function saveLessonPlanGeneration({
  uid, planJson, html, meta, studioFormat, inputs, classification,
}) {
  if (!uid) throw new Error('Sign in again to save to your library.')
  if (!planJson || typeof planJson !== 'object') throw new Error('Generate a plan before saving.')
  const library = classifyForLibrary(classification)
  const ref = await addDoc(collection(db, 'aiGenerations'), {
    ownerUid: uid,
    tool: 'lesson_plan',
    status: 'complete',
    visibility: 'private',
    createdAt: serverTimestamp(),
    inputs: inputs || {},
    ...(library ? { library } : {}),
    meta: meta || {},
    data: planJson,
    html: html || '',
    studioFormat: studioFormat || (meta && meta.format) || 'modern',
  })
  return ref.id
}

/**
 * Save a client-side tool's document into the library. Mark schedules and
 * weekly forecasts are the only client-CREATED generations (pure
 * client-side derivation, no Cloud Function) — firestore.rules pins the
 * create to those tools with exactly this field set, so don't add
 * top-level fields here without updating the rule. First save creates
 * the doc; later saves patch output+library (within the update rule's
 * changedKeys allowlist).
 *
 * Returns the generation id, or throws with a user-presentable message.
 */
async function saveClientToolGeneration({ uid, existingId, tool, artifact, inputs, classification }) {
  if (!uid) throw new Error('Sign in again to save to your library.')
  const library = classifyForLibrary(classification)
  if (existingId) {
    await updateDoc(doc(db, 'aiGenerations', existingId), {
      output: artifact,
      ...(library ? { library } : {}),
    })
    return existingId
  }
  const ref = await addDoc(collection(db, 'aiGenerations'), {
    ownerUid: uid,
    tool,
    status: 'complete',
    visibility: 'private',
    createdAt: serverTimestamp(),
    inputs,
    output: artifact,
    ...(library ? { library } : {}),
  })
  return ref.id
}

export async function saveMarkScheduleGeneration({ uid, existingId, artifact }) {
  if (!artifact?.pupils?.length) throw new Error('Add at least one pupil before saving.')
  const header = artifact.header || {}
  return saveClientToolGeneration({
    uid,
    existingId,
    tool: 'mark_schedule',
    artifact,
    inputs: {
      grade: header.grade || null,
      term: header.term != null ? String(header.term) : null,
      subject: null,
      topic: `Term ${header.term ?? ''} mark schedule`.trim(),
    },
    classification: {
      libraryType: LIBRARY_TYPES.MARK_SCHEDULES,
      grade: header.grade,
      term: header.term,
    },
  })
}

export async function saveWeeklyForecastGeneration({ uid, existingId, artifact }) {
  if (!artifact?.days?.length) throw new Error('Build the week before saving.')
  const header = artifact.header || {}
  return saveClientToolGeneration({
    uid,
    existingId,
    tool: 'weekly_forecast',
    artifact,
    inputs: {
      grade: header.grade || null,
      term: header.term != null ? String(header.term) : null,
      subject: header.subject || null,
      topic: `Week ${header.weekNumber ?? ''} forecast`.trim(),
    },
    classification: {
      libraryType: LIBRARY_TYPES.WEEKLY_FORECASTS,
      grade: header.grade,
      term: header.term,
      subject: header.subject,
    },
  })
}

export async function saveRecordOfWorkGeneration({ uid, existingId, artifact }) {
  if (!artifact?.weeks?.length) throw new Error('Log at least one week before saving.')
  const header = artifact.header || {}
  return saveClientToolGeneration({
    uid,
    existingId,
    tool: 'record_of_work',
    artifact,
    inputs: {
      grade: header.grade || null,
      term: header.term != null ? String(header.term) : null,
      subject: header.subject || null,
      topic: `Term ${header.term ?? ''} record of work`.trim(),
    },
    classification: {
      libraryType: LIBRARY_TYPES.RECORDS_OF_WORK,
      grade: header.grade,
      term: header.term,
      subject: header.subject,
    },
  })
}

export async function saveClassTimetableGeneration({ uid, existingId, artifact, publishState }) {
  const hasLesson = artifact?.slots && Object.values(artifact.slots)
    .some((row) => row && Object.values(row).some(Boolean))
  if (!hasLesson) throw new Error('Fill at least one lesson before saving.')
  const header = artifact.header || {}
  const cls = header.className || (header.grade ? `Grade ${String(header.grade).replace(/^G/i, '')}` : '')
  // savedAt lives INSIDE the artifact (security rules pin the top-level field
  // set), so sibling conflict checks can tell when another class timetable
  // changed between refreshes. publishState marks a final, conflict-gated save.
  const stamped = {
    ...artifact,
    savedAt: new Date().toISOString(),
    ...(publishState ? { publishState } : {}),
  }
  return saveClientToolGeneration({
    uid,
    existingId,
    tool: 'class_timetable',
    artifact: stamped,
    inputs: {
      grade: header.grade || null,
      term: header.term != null && header.term !== '' ? String(header.term) : null,
      subject: null,
      topic: `${cls || 'Class'} timetable`.trim(),
    },
    classification: {
      libraryType: LIBRARY_TYPES.CLASS_TIMETABLES,
      grade: header.grade,
      term: header.term,
    },
  })
}

export async function saveSbaMarkSheetGeneration({ uid, existingId, artifact }) {
  if (!artifact?.pupils?.length) throw new Error('Add at least one pupil before saving.')
  const header = artifact.header || {}
  return saveClientToolGeneration({
    uid,
    existingId,
    tool: 'sba_mark_sheet',
    artifact,
    inputs: {
      grade: header.grade || null,
      term: null,
      subject: header.subject || null,
      topic: `${header.subjectLabel || ''} ${header.gradeLabel || ''} SBA marks`.trim(),
    },
    classification: {
      libraryType: LIBRARY_TYPES.SBA_MARK_SHEETS,
      syllabusHint: 'OBC',
      grade: header.grade,
      subject: header.subject,
    },
  })
}

export async function saveSbaPlanGeneration({ uid, existingId, artifact }) {
  if (!artifact?.statuses || !Object.keys(artifact.statuses).length) {
    throw new Error('Set at least one task status before saving.')
  }
  const header = artifact.header || {}
  return saveClientToolGeneration({
    uid,
    existingId,
    tool: 'sba_plan',
    artifact,
    inputs: {
      grade: header.grade || null,
      term: null,
      subject: header.subject || null,
      topic: `${header.subjectLabel || ''} ${header.gradeLabel || ''} SBA plan`.trim(),
    },
    classification: {
      libraryType: LIBRARY_TYPES.SBA_PLANS,
      syllabusHint: 'OBC',
      grade: header.grade,
      subject: header.subject,
    },
  })
}

// Tools whose library docs the client may CREATE directly — mirrors the
// firestore.rules aiGenerations create rule (pure client-side derivations,
// no AI call). These are the only tools "Duplicate" can support without a
// server round-trip; AI-generated docs are created by Cloud Functions only,
// so their duplicate path is "Generate similar".
export const CLIENT_CREATED_TOOLS = [
  'mark_schedule', 'weekly_forecast', 'record_of_work',
  'class_timetable', 'sba_mark_sheet', 'sba_plan',
]

/**
 * Duplicate a client-created generation into a fresh library doc owned by
 * `uid`. The copy gets its own id + createdAt; the teacher then edits it in
 * place (the classic "duplicate last term's mark schedule / timetable and
 * tweak" flow). Returns the new generation id, or throws with a
 * user-presentable message.
 */
export async function duplicateGeneration(item, uid) {
  if (!uid) throw new Error('Sign in again to duplicate this item.')
  if (!item?.id || !CLIENT_CREATED_TOOLS.includes(item.tool)) {
    throw new Error('This document type cannot be duplicated yet — use "Generate similar" instead.')
  }
  if (!item.output) throw new Error('This document has no content to duplicate.')
  // Build the new doc explicitly from the create rule's allowlisted keys —
  // spreading `item` would leak read-only fields (id, exportedFormats,
  // teacherEdited, …) and fail the rules' keys().hasOnly check.
  const ref = await addDoc(collection(db, 'aiGenerations'), {
    ownerUid: uid,
    tool: item.tool,
    status: 'complete',
    visibility: 'private',
    createdAt: serverTimestamp(),
    inputs: item.inputs || {},
    output: item.output,
    ...(item.library ? { library: item.library } : {}),
  })
  return ref.id
}

/**
 * Record that the user exported a generation in a given format. Appends to
 * the `exportedFormats` array (deduped).
 */
export async function recordExport(id, format) {
  if (!id || !format) return false
  try {
    const cur = await getDoc(doc(db, 'aiGenerations', id))
    const existing = Array.isArray(cur.data()?.exportedFormats) ?
      cur.data().exportedFormats : []
    if (existing.includes(format)) return true
    await updateDoc(doc(db, 'aiGenerations', id), {
      exportedFormats: [...existing, format],
    })
    return true
  } catch (err) {
    console.error('recordExport failed', err)
    return false
  }
}

/**
 * Summary stats for a list of generation rows — used by the dashboard.
 * byTool is keyed by the snake_cased Firestore tool id ('lesson_plan'),
 * which is what StudioCard's `libraryKey.replace(/-/g, '_')` lookup expects.
 */
export function summarizeGenerations(rows = []) {
  const byTool = rows.reduce((acc, r) => {
    if (!r?.tool) return acc
    acc[r.tool] = (acc[r.tool] || 0) + 1
    return acc
  }, {})
  return {total: rows.length, byTool}
}

/**
 * Summary stats for the current user's library — used by the dashboard.
 */
export async function getLibrarySummary(uid) {
  if (!uid) return {total: 0, byTool: {}}
  const rows = await listMyGenerations({uid})
  return summarizeGenerations(rows)
}

/* ── UI constants ─────────────────────────────────────────── */

export const TOOL_META = {
  // The Full Lesson studio was retired; the entry stays (no `route`, so
  // "Generate similar" is hidden) to render lessons saved before removal.
  full_lesson: {
    label: 'Full Lesson',
    icon: '✨',
    colour: 'cyan',
  },
  lesson_plan: {
    label: 'Lesson Plan',
    icon: '✨',
    route: '/teacher/lesson-plans/new',
    colour: 'emerald',
  },
  scheme_of_work: {
    label: 'Scheme of Work',
    icon: '🗓️',
    route: '/teacher/generate/scheme-of-work',
    colour: 'teal',
  },
  weekly_forecast: {
    label: 'Weekly Forecast',
    icon: '📅',
    route: '/teacher/generate/weekly-forecast',
    colour: 'cyan',
  },
  record_of_work: {
    label: 'Record of Work',
    icon: '🗂️',
    route: '/teacher/generate/record-of-work',
    colour: 'orange',
  },
  mark_schedule: {
    label: 'Mark Schedule',
    icon: '🧮',
    route: '/teacher/generate/mark-schedule',
    colour: 'lime',
  },
  class_timetable: {
    label: 'Class Timetable',
    icon: '🗓️',
    route: '/teacher/generate/class-timetable',
    colour: 'violet',
  },
  worksheet: {
    label: 'Worksheet',
    icon: '📝',
    route: '/teacher/generate/worksheet',
    colour: 'indigo',
  },
  flashcards: {
    label: 'Flashcards',
    icon: '🎴',
    route: '/teacher/generate/flashcards',
    colour: 'amber',
  },
  rubric: {
    label: 'Rubric',
    icon: '📋',
    route: '/teacher/generate/rubric',
    colour: 'rose',
  },
  notes: {
    label: 'Teacher Notes',
    icon: '📓',
    route: '/teacher/generate/notes',
    colour: 'sky',
  },
  homework: {
    label: 'Homework',
    icon: '🏠',
    route: '/teacher/generate/homework',
    colour: 'sky',
  },
  lesson_activities: {
    label: 'Exercise & Homework',
    icon: '🧩',
    // Generated from inside the Lesson Plan Studio's "Assessment Activities"
    // section, so "Generate similar" sends the teacher back there.
    route: '/teacher/lesson-plans/new',
    colour: 'orange',
  },
  // AI-generated test/exam papers (generateAssessment — plus legacy docs from
  // the retired generateExamPaper callable — land
  // these in aiGenerations). The Library detail view renders them as a printed
  // paper. No `route`: the studio's "Create with AI" modal owns generation and
  // doesn't pre-fill from a query string, so "Generate similar" is intentionally
  // hidden rather than dumping the teacher on a blank studio.
  assessment: {
    label: 'Test Paper',
    icon: '📋',
    colour: 'rose',
  },
  exam_paper: {
    label: 'Exam Paper',
    icon: '📄',
    colour: 'rose',
  },
}

export const TOOL_FILTER_OPTIONS = [
  {value: '', label: 'All tools'},
  {value: 'lesson_plan', label: 'Lesson plans'},
  {value: 'full_lesson', label: 'Full lessons'},
  {value: 'scheme_of_work', label: 'Schemes of work'},
  {value: 'weekly_forecast', label: 'Weekly forecasts'},
  {value: 'record_of_work', label: 'Records of work'},
  {value: 'mark_schedule', label: 'Mark schedules'},
  {value: 'class_timetable', label: 'Class timetables'},
  {value: 'worksheet', label: 'Worksheets'},
  {value: 'flashcards', label: 'Flashcards'},
  {value: 'rubric', label: 'Rubrics'},
  {value: 'notes', label: 'Teacher notes'},
  {value: 'homework', label: 'Homework'},
  {value: 'lesson_activities', label: 'Exercises & homework'},
]

/**
 * Derive a human-readable title for a generation.
 */
export function titleForGeneration(gen) {
  if (!gen) return 'Untitled'
  const out = gen.output || {}
  if (gen.tool === 'lesson_plan') {
    const headerTopic    = out?.header?.topic    || gen.meta?.topic    || gen.inputs?.topic
    const headerSubtopic = out?.header?.subtopic || gen.meta?.subtopic || gen.inputs?.subtopic
    if (headerTopic) {
      return headerSubtopic ? `${headerTopic} — ${headerSubtopic}` : headerTopic
    }
    const g = gen.inputs?.grade || gen.meta?.klass || ''
    const s = gen.inputs?.subject || gen.meta?.subject || ''
    return `${g} ${s} lesson plan`.trim() || 'Lesson plan'
  }
  if (gen.tool === 'worksheet') {
    return out?.header?.title || `${gen.inputs?.topic || 'Worksheet'}`
  }
  if (gen.tool === 'flashcards') {
    return out?.header?.title || `${gen.inputs?.topic || 'Flashcards'}`
  }
  if (gen.tool === 'scheme_of_work') {
    const g = out?.header?.class || gen.inputs?.grade || ''
    const s = out?.header?.subject || gen.inputs?.subject || ''
    const t = out?.header?.term || gen.inputs?.term || ''
    return `${g} ${s} — Term ${t} Scheme of Work`.trim()
  }
  if (gen.tool === 'weekly_forecast') {
    const g = String(out?.header?.grade || gen.inputs?.grade || '').replace(/^G/i, '')
    const subj = out?.header?.subject || ''
    const w = out?.header?.weekNumber || ''
    const t = out?.header?.term || gen.inputs?.term || ''
    return [`${g ? `Grade ${g}` : ''} ${subj}`.trim(), `Term ${t} Week ${w} Forecast`.trim()]
      .filter(Boolean).join(' — ')
  }
  if (gen.tool === 'record_of_work') {
    const g = String(out?.header?.grade || gen.inputs?.grade || '').replace(/^G/i, '')
    const subj = out?.header?.subject || ''
    const t = out?.header?.term || gen.inputs?.term || ''
    const y = out?.header?.year || ''
    return [`${g ? `Grade ${g}` : ''} ${subj}`.trim(), `Term ${t} Record of Work${y ? ` ${y}` : ''}`.trim()]
      .filter(Boolean).join(' — ')
  }
  if (gen.tool === 'mark_schedule') {
    const g = out?.header?.grade || gen.inputs?.grade || ''
    const t = out?.header?.term || gen.inputs?.term || ''
    const y = out?.header?.year || ''
    const n = out?.pupils?.length
    const head = `${g ? `Grade ${String(g).replace(/^G/i, '')}` : ''} — Term ${t} Mark Schedule${y ? ` ${y}` : ''}`.trim()
    return n ? `${head} (${n} pupils)` : head
  }
  if (gen.tool === 'class_timetable') {
    const h = out?.header || {}
    const cls = h.className || (h.grade ? `Grade ${String(h.grade).replace(/^G/i, '')}` : '')
    const t = h.term || gen.inputs?.term || ''
    const y = h.year || ''
    return [cls || 'Class', `Timetable${t ? ` — Term ${t}` : ''}${y ? ` ${y}` : ''}`]
      .filter(Boolean).join(' ').trim() || 'Class timetable'
  }
  if (gen.tool === 'rubric') {
    return out?.header?.title ||
      `${gen.inputs?.grade || ''} ${gen.inputs?.subject || ''} — ${gen.inputs?.taskType || 'rubric'}`.trim()
  }
  if (gen.tool === 'notes') {
    if (out?.header?.title) return out.header.title
    const topic = out?.header?.topic || gen.inputs?.topic || 'Notes'
    const grade = out?.header?.grade || gen.inputs?.grade || ''
    return [`Teacher notes — ${topic}`, grade].filter(Boolean).join(' · ')
  }
  if (gen.tool === 'full_lesson') {
    if (out?.header?.title) return out.header.title
    const topic = out?.header?.topic || gen.inputs?.topic || ''
    const sub = out?.header?.subtopic || gen.inputs?.subtopic || ''
    const head = [topic, sub].filter(Boolean).join(' — ')
    return head ? `Lesson: ${head}` : 'Full lesson'
  }
  if (gen.tool === 'homework') {
    if (out?.header?.title) return out.header.title
    const topic = out?.header?.topic || gen.inputs?.topic || ''
    const grade = out?.header?.grade || gen.inputs?.grade || ''
    return [topic ? `Homework — ${topic}` : 'Homework', grade].filter(Boolean).join(' · ')
  }
  if (gen.tool === 'lesson_activities') {
    // Output is { exercise, homework }; no top-level header — derive from inputs
    // or either activity's header.
    const exH = out?.exercise?.header || {}
    const hwH = out?.homework?.header || {}
    const topic = gen.inputs?.topic || exH.topic || hwH.topic || 'Lesson'
    const parts = []
    if (out?.exercise) parts.push('Exercise')
    if (out?.homework) parts.push('Homework')
    const what = parts.join(' & ') || 'Activities'
    return `${what} — ${topic}`
  }
  if (gen.tool === 'exam_paper') {
    if (out?.header?.title) return out.header.title
    const g = gen.inputs?.grade || out?.header?.grade || ''
    const s = gen.inputs?.subject || out?.header?.subject || ''
    return `${g} ${s} exam questions`.trim() || 'Exam questions'
  }
  if (gen.tool === 'assessment') {
    if (out?.header?.title) return out.header.title
    const g = gen.inputs?.grade || out?.header?.grade || ''
    const s = gen.inputs?.subject || out?.header?.subject || ''
    const topic = gen.inputs?.topic || out?.header?.topic || ''
    return topic || `${g} ${s} test paper`.trim() || 'Test paper'
  }
  return gen.inputs?.topic || 'Generation'
}

/* ── Library bucketing & access control ─────────────────────── */

/**
 * Bucket a generation into a library section. Prefers the saved
 * `library.libraryType` (set by `setGenerationLibrary`) and falls back
 * to deriving it from the legacy `tool` field for un-backfilled rows.
 */
export function libraryTypeForGeneration(gen) {
  if (!gen) return null
  if (gen.library?.libraryType) return gen.library.libraryType
  return TOOL_TO_LIBRARY_TYPE[gen.tool] || null
}

/**
 * Returns the LIBRARY_SECTIONS entry for an item, or null if unknown.
 */
export function librarySectionForGeneration(gen) {
  const t = libraryTypeForGeneration(gen)
  return t ? LIBRARY_SECTION_BY_ID[t] : null
}

/**
 * Bucket the user's generations + assessments into the canonical library
 * folder tree. Returns a map keyed by libraryType → syllabus → gradeForm
 * → term → subject → [items]. For Syllabi the term level is omitted; for
 * Assessments an extra `assessmentType` level is added beneath subject.
 *
 *   tree.lesson_plans.CBC['Grade 4']['Term 2'].Mathematics  // [item, ...]
 */
// Legacy: the old syllabus was stored as 'CDC' before it was correctly
// renamed to 'OBC' (Outcome-Based Curriculum). Map it on read so already-
// saved items keep showing under the right bucket.
function normalizeSyllabus(value) {
  return value === 'CDC' ? 'OBC' : value
}

export function bucketIntoTree(rows = []) {
  const tree = {}
  for (const row of rows) {
    const section = librarySectionForGeneration(row)
    if (!section) continue
    const lib = row.library || {}
    const path = [
      section.id,
      normalizeSyllabus(lib.syllabus) || 'Unsorted',
      lib.gradeForm || 'Unsorted',
      ...(section.hasTerm ? [lib.term || 'Unsorted'] : []),
      lib.subject || 'Unsorted',
      ...(section.hasAssessmentType ? [lib.assessmentType || 'Unsorted'] : []),
    ]
    let cursor = tree
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      if (!cursor[key]) cursor[key] = {}
      cursor = cursor[key]
    }
    const leafKey = path[path.length - 1]
    if (!cursor[leafKey]) cursor[leafKey] = []
    cursor[leafKey].push(row)
  }
  return tree
}

/* ── Pro vs Premium access control ──────────────────────────── */
//
// Rule (per spec):
//   PRO     — view, preview, download ONLY their own generations.
//             Cannot download platform/admin-supplied library docs.
//   PREMIUM — view, download, print, export everything.
//   FREE    — view only (no download).
//
// "Premium" maps to the `max` subscription tier (or admin role).
// "Pro" maps to the `pro` tier or any other active premium subscriber.

export const LIBRARY_ACCESS = {
  FREE:    'free',
  PRO:     'pro',
  PREMIUM: 'premium',
}

/**
 * Resolve the access level of the current viewer relative to a saved
 * library item. Pass the user's profile and the item; returns one of
 * LIBRARY_ACCESS values.
 */
export function getLibraryAccessLevel({ userProfile, isAdmin = false } = {}) {
  if (isAdmin) return LIBRARY_ACCESS.PREMIUM
  if (!userProfile) return LIBRARY_ACCESS.FREE

  const tier = String(
    userProfile.subscriptionTier ||
    userProfile.tier ||
    userProfile.subscriptionPlan ||
    userProfile.plan ||
    '',
  ).toLowerCase()

  // 'max' / 'premium' / 'unlimited' → premium.
  if (tier.startsWith('max') || tier === 'premium' || tier === 'unlimited') {
    return LIBRARY_ACCESS.PREMIUM
  }
  // 'pro_*' or any active subscription → pro.
  if (tier.startsWith('pro') ||
      userProfile.premium === true ||
      userProfile.isPremium === true ||
      userProfile.subscriptionStatus === 'active' ||
      userProfile.paymentStatus === 'active') {
    return LIBRARY_ACCESS.PRO
  }
  return LIBRARY_ACCESS.FREE
}

/**
 * Should this viewer's studio exports carry the free-plan ZedExams branding
 * (the diagonal page watermark + "Made with ZedExams" footer)? Free plan
 * only — paid (and admin) documents stay clean. Consumed by the studios
 * together with docxAttribution.js (DOCX) and exportWatermark.js (PDF/HTML).
 */
export function isFreePlanTeacher({ userProfile, isAdmin = false } = {}) {
  return getLibraryAccessLevel({ userProfile, isAdmin }) === LIBRARY_ACCESS.FREE
}

/**
 * Decides what the viewer can do with a single library item.
 *
 *   { canView, canDownload, canPrint, canExport }
 */
export function getItemPermissions({ userProfile, isAdmin = false, item }) {
  const level = getLibraryAccessLevel({ userProfile, isAdmin })
  const ownsIt = !!item && !!userProfile && item.ownerUid === (userProfile.uid ?? userProfile.id)

  if (level === LIBRARY_ACCESS.PREMIUM) {
    return { canView: true, canDownload: true, canPrint: true, canExport: true, level }
  }
  if (level === LIBRARY_ACCESS.PRO) {
    // Pro: download own generations only. Library-supplied/admin docs are
    // view-only for pro users.
    return {
      canView:     true,
      canDownload: ownsIt,
      canPrint:    ownsIt,
      canExport:   ownsIt,
      level,
    }
  }
  return { canView: true, canDownload: false, canPrint: false, canExport: false, level }
}

/* ── Library section meta passthrough ───────────────────────── */

export { LIBRARY_TYPES, LIBRARY_SECTION_BY_ID }

/**
 * Format a Firestore Timestamp as a short relative date.
 */
export function formatDate(ts) {
  if (!ts) return ''
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('en-ZM', {hour: '2-digit', minute: '2-digit'})
  }
  const diffMs = now - d
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-ZM', {year: 'numeric', month: 'short', day: 'numeric'})
}
