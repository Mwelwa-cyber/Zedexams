/**
 * Template Bank — client service layer.
 *
 * Reads the shared `lessonPlanTemplates` collection (built + merged server-side
 * by the lessonPlanTemplateOnWrite trigger) and exposes:
 *   - searchTemplates(filters)        instant client-side filtered search
 *   - recommendTemplates(coords)      best matches for a topic/subtopic
 *   - getTemplate(id)
 *   - useTemplate(id)                 increments usage (callable) + returns content
 *   - rateTemplate(id, rating)        1–5 rating (callable)
 *   - createLessonPlanFromTemplate()  spins a NEW private lesson plan from a
 *                                     template (never edits the original)
 *
 * Templates are read-only to clients (firestore.rules) — usage + ratings flow
 * through the `recordTemplateInteraction` callable so they can't be tampered
 * with. Reads are cached for the session so filtering feels instant.
 */

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'
import { saveLessonPlanGeneration } from './teacherLibraryService'
import { LIBRARY_TYPES } from '../config/library'
import { renderPlanHtml } from '../components/teacher/studio/utils/renderPlanHtml'
import {
  templateCurriculumMode, templatePreviewMeta, templateSyllabusHint,
} from '../components/teacher/templates/templatePlanPreview'

const functions = getFunctions(app, 'us-central1')
const interactionCallable = httpsCallable(functions, 'recordTemplateInteraction', { timeout: 30_000 })

const TEMPLATES = 'lessonPlanTemplates'
const SEARCH_LIMIT = 200

let _cache = null // { at:number, rows:[] }
const CACHE_TTL_MS = 60_000

function normaliseTemplate(row) {
  if (!row || typeof row !== 'object') return row
  return {
    id: row.id,
    title: row.title || 'Lesson plan template',
    grade: row.grade || '',
    subject: row.subject || '',
    topic: row.topic || '',
    subtopic: row.subtopic || '',
    competency: row.competency || '',
    specificOutcome: row.specificOutcome || '',
    curriculum: row.curriculum || '',
    curriculumVersion: row.curriculumVersion || '',
    preview: row.preview || '',
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    qualityScore: typeof row.qualityScore === 'number' ? row.qualityScore : 0,
    qualityBreakdown: row.qualityBreakdown || {},
    aiRecommendations: Array.isArray(row.aiRecommendations) ? row.aiRecommendations : [],
    usageCount: typeof row.usageCount === 'number' ? row.usageCount : 0,
    ratingAvg: typeof row.ratingAvg === 'number' ? row.ratingAvg : 0,
    ratingCount: typeof row.ratingCount === 'number' ? row.ratingCount : 0,
    version: typeof row.version === 'number' ? row.version : 1,
    status: row.status || 'active',
    updatedAt: row.updatedAt || null,
    content: row.content || null,
  }
}

/** Fetch (and cache) the top active templates ordered by quality. */
async function loadActiveTemplates({ force = false } = {}) {
  const now = Date.now()
  if (!force && _cache && now - _cache.at < CACHE_TTL_MS) return _cache.rows
  try {
    const q = query(
      collection(db, TEMPLATES),
      where('status', '==', 'active'),
      orderBy('qualityScore', 'desc'),
      limit(SEARCH_LIMIT),
    )
    const snap = await getDocs(q)
    const rows = snap.docs.map((d) => normaliseTemplate({ id: d.id, ...d.data() }))
    // Session cache — a benign last-write-wins on concurrent loads is fine.
    // eslint-disable-next-line require-atomic-updates
    _cache = { at: now, rows }
    return rows
  } catch (err) {
    console.error('loadActiveTemplates failed', err)
    if (err?.code === 'failed-precondition') {
      throw new Error('The Template Bank index is still building. Try again in a minute.')
    }
    throw new Error('Could not load the Template Bank right now. Please try again.')
  }
}

const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
const has = (hay, needle) => String(hay || '').toLowerCase().includes(String(needle || '').toLowerCase())

/**
 * Instant client-side filtered search. All filters optional:
 *   { curriculum, grade, subject, topic, subtopic, competency,
 *     specificOutcome, keywords (string), minQuality }
 */
export async function searchTemplates(filters = {}) {
  const rows = await loadActiveTemplates()
  const f = filters || {}
  const terms = String(f.keywords || '').toLowerCase().split(/\s+/).filter(Boolean)

  return rows.filter((t) => {
    if (f.curriculum && !eq(t.curriculum, f.curriculum)) return false
    if (f.grade && !eq(t.grade, f.grade)) return false
    if (f.subject && !eq(t.subject, f.subject)) return false
    if (f.topic && !has(t.topic, f.topic)) return false
    if (f.subtopic && !has(t.subtopic, f.subtopic)) return false
    if (f.competency && !has(t.competency, f.competency)) return false
    if (f.specificOutcome && !has(t.specificOutcome, f.specificOutcome)) return false
    if (typeof f.minQuality === 'number' && t.qualityScore < f.minQuality) return false
    if (terms.length) {
      const hayParts = [t.title, t.topic, t.subtopic, t.subject, t.competency, t.preview,
        ...(t.keywords || [])]
      const hay = hayParts.join(' ').toLowerCase()
      if (!terms.every((term) => hay.includes(term))) return false
    }
    return true
  })
}

/**
 * Recommend the best templates for a target lesson. Ranks by coordinate match
 * (subtopic > topic > subject/grade) then quality score. Returns top `n`.
 */
export async function recommendTemplates({ grade, subject, topic, subtopic } = {}, n = 5) {
  const rows = await loadActiveTemplates()
  const scored = rows.map((t) => {
    let match = 0
    if (subtopic && has(t.subtopic, subtopic)) match += 50
    if (topic && has(t.topic, topic)) match += 30
    if (subject && eq(t.subject, subject)) match += 12
    if (grade && eq(t.grade, grade)) match += 8
    return { t, rank: match * 100 + t.qualityScore }
  })
  return scored
    .filter((s) => s.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, n)
    .map((s) => s.t)
}

export async function getTemplate(id) {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, TEMPLATES, id))
    if (!snap.exists()) return null
    return normaliseTemplate({ id: snap.id, ...snap.data() })
  } catch (err) {
    console.error('getTemplate failed', err)
    return null
  }
}

/** Tell the server a teacher used this template (increments usageCount). */
export async function markTemplateUsed(id) {
  if (!id) return false
  try {
    await interactionCallable({ templateId: id, action: 'use' })
    return true
  } catch (err) {
    console.warn('markTemplateUsed failed', err)
    return false
  }
}

/** Submit a 1–5 rating for a template. */
export async function rateTemplate(id, rating) {
  if (!id || !(rating >= 1 && rating <= 5)) throw new Error('Pick a rating from 1 to 5.')
  await interactionCallable({ templateId: id, action: 'rate', rating })
  _cache = null // ratings changed — drop the cache so the next search is fresh
  return true
}

/**
 * Create a NEW private lesson plan from a template. The original template is
 * never modified. The teacher-supplied header (school / teacher / date / time /
 * class / learning environment) is merged onto the anonymised template content,
 * the plan is rendered to HTML, and saved into the teacher's own library.
 *
 * @returns {Promise<string>} the new aiGenerations doc id (for navigation)
 */
export async function createLessonPlanFromTemplate({ uid, template, header = {} }) {
  if (!uid) throw new Error('Sign in again to use a template.')
  if (!template || !template.content) throw new Error('This template has no content to copy.')

  const content = JSON.parse(JSON.stringify(template.content))
  const baseHeader = (content.header && typeof content.header === 'object') ? content.header : {}
  content.header = {
    ...baseHeader,
    school: header.school || '',
    teacherName: header.teacherName || '',
    date: header.date || '',
    time: header.time || '',
    class: header.class || '',
  }
  if (header.learningEnvironment) {
    // Studio plans store a structured environment; accept a single free-text
    // line too (drop it into `natural` so it still renders).
    content.learningEnvironment = typeof header.learningEnvironment === 'string'
      ? { ...(content.learningEnvironment || {}), natural: header.learningEnvironment }
      : header.learningEnvironment
  }

  // The SAME rendering options the Template Bank previewed it with, now
  // carrying the teacher's own header instead of the template's blanks. The
  // preview and the saved plan drawing the same document is the whole point:
  // this used to save `format: 'modern'` under a preview that had drawn
  // something else, so the plan a teacher chose was not the plan they got.
  const curriculumMode = templateCurriculumMode(template)
  const meta = {
    ...templatePreviewMeta(template, {
      school: header.school || '',
      teacherName: header.teacherName || '',
      date: header.date || '',
      time: header.time || '',
      class: header.class || '',
    }),
    grade: template.grade,
    // Tag the save so the Template Bank trigger does NOT re-ingest a
    // template-derived plan back into the bank.
    fromTemplateId: template.id,
  }

  let html = ''
  try {
    html = renderPlanHtml(content, meta, curriculumMode)
  } catch (err) {
    html = ''
  }

  const newId = await saveLessonPlanGeneration({
    uid,
    planJson: content,
    html,
    meta,
    studioFormat: meta.format,
    inputs: {
      grade: template.grade || null,
      subject: template.subject || null,
      topic: template.topic || null,
      subtopic: template.subtopic || null,
    },
    classification: {
      libraryType: LIBRARY_TYPES.LESSON_PLANS,
      // Without the hint an OBC template's plan files under CBC, and the studio
      // reopens it in the wrong curriculum's vocabulary.
      syllabusHint: templateSyllabusHint(template),
      grade: template.grade,
      subject: template.subject,
    },
  })

  // Best-effort usage bump — never block the teacher on it.
  markTemplateUsed(template.id)
  return newId
}

/** Drop the in-memory cache (e.g. after the bank is known to have changed). */
export function clearTemplateCache() { _cache = null }
