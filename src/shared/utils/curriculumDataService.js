/**
 * Data layer for the Lesson Plan Studio.
 *
 * Wraps the existing curriculum data sources and exposes three functions:
 *
 *   getSubjectsForGrade(grade, curriculumMode)             → string[]
 *   getTopicsForSubject(subject, grade, curriculumMode)    → Topic[]
 *   getSubtopicDetail(subject, grade, topic, subtopic, curriculumMode) → SubtopicRow | null
 *
 * curriculumMode is either 'cbc' (default) or 'previous'.
 *
 * CBC data comes from getMergedSyllabi() (curriculum-data.json + admin
 * overrides) in src/utils/syllabusKbService.js.
 *
 * 2013 / "previous" data comes from /syllabi/curriculum-data-2013.json,
 * loaded and cached the same way syllabusKbService.js handles the CBC file.
 *
 * Topic carry-forward (blank TOPIC cells) for CBC is delegated to
 * rowsWithPropagatedTopic() from src/utils/syllabusMapping.js so the
 * duplicate-header stripping and empty-section-banner logic lives in one
 * place. The 2013 data uses its own column names (SPECIFIC OUTCOMES,
 * CONTENT, Skills, Values) that rowsWithPropagatedTopic doesn't map, so
 * those rows are propagated locally and read directly from the raw cells.
 */

import { getMergedSyllabi } from '../../utils/syllabusKbService.js'
import { rowsWithPropagatedTopic } from '../../utils/syllabusMapping.js'
// A document that carries two independently-numbered syllabi (Commerce &
// Principles of Accounts) must offer ONE dropdown entry per subject, and a pick
// must scope its topics to that subject's half of the sheet.
import {
  SPLIT_DOCUMENTS, resolveSplitSubjects, sectionSubjectForLabel,
} from '../../utils/syllabusSubjectSplit.js'
import { sortByCurriculumCode } from '../../utils/curriculumTopicCell.js'
import { splitSpecificOutcomes } from './splitSpecificOutcomes.js'
import {
  resolveColumnRoles,
  repairColumnShiftedRow,
  isHeaderEchoRow,
  joinCellText,
} from '../../utils/curriculum2013Parser.js'

// ── 2013 / Previous curriculum loader ────────────────────────────────────────
// Mirrors the loadRawCurriculum() pattern in syllabusKbService.js.

let _prevCache = null
let _prevCachePromise = null

async function loadPreviousCurriculum() {
  if (_prevCache) return _prevCache
  if (_prevCachePromise) return _prevCachePromise
  _prevCachePromise = (async () => {
    try {
      const response = await fetch('/syllabi/curriculum-data-2013.json')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      _prevCache = await response.json()
      return _prevCache
    } catch (err) {
      console.error('loadPreviousCurriculum failed', err)
      // Keep _prevCache = null so the next call retries the fetch instead of
      // permanently serving an empty object. _prevCachePromise is cleared in
      // the finally block, which is enough to allow a fresh attempt.
      _prevCache = null
      return {}
    } finally {
      _prevCachePromise = null
    }
  })()
  return _prevCachePromise
}

/** Invalidate the previous-curriculum cache (2013/previous only — CBC cache lives in syllabusKbService.js). */
export function invalidatePreviousCurriculumCache() {
  _prevCache = null
  _prevCachePromise = null
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Load the raw studio JSON for the requested curriculum mode.
 *
 * @param {'cbc'|'previous'} mode
 * @returns {Promise<object>} Raw studio JSON: subject → sheet → {columns, rows}
 */
async function loadData(mode) {
  if (mode === 'previous') return loadPreviousCurriculum()
  return getMergedSyllabi()
}

/**
 * ECE class name → age-band sheet prefix.
 *
 * The Early Childhood Education syllabi are digitised as age-band sheets
 * ("3-4 Years - English Language", "4-5 Years - Pre-Maths & Science", …), but
 * the Lesson Plan Studio's Class picker offers the friendly ECE class names
 * "Nursery" and "Reception". Without this bridge, picking Nursery/Reception
 * matched no sheet, so the grades were filtered out of the picker entirely and
 * resolved to zero subjects/topics. Map each class to its age band so the same
 * grade→sheet matching used for every other class works for ECE too.
 */
const ECE_GRADE_TO_AGE_BAND = {
  nursery: '3-4 years',
  reception: '4-5 years',
}

/**
 * Check whether a sheet name belongs to the requested grade (case-insensitive).
 *
 * CBC sheets:  "Form 1", "Form 2", "Grade 4", "3-4 Years - English Language", …
 * 2013 sheets: "Grade 10", "Grade 11", …
 *
 * Matching:
 *   1. ECE class names ("Nursery"/"Reception") are first translated to their
 *      age-band sheet prefix ("3-4 Years"/"4-5 Years") — see
 *      ECE_GRADE_TO_AGE_BAND — so they line up with how the ECE syllabi are keyed.
 *   2. Exact match.
 *   3. Sheet starts with grade string (sheet "Form 1 - English" matches grade "Form 1").
 *   4. Grade starts with sheet string (symmetric).
 */
function sheetMatchesGrade(sheetName, grade) {
  if (!sheetName || !grade) return false
  const sheet = String(sheetName).trim().toLowerCase()
  const rawGrade = String(grade).trim().toLowerCase()
  const g = ECE_GRADE_TO_AGE_BAND[rawGrade] ?? rawGrade
  return sheet === g || sheet.startsWith(g + ' ') || g.startsWith(sheet + ' ')
}

/**
 * Return sheet names from the subject's sheets object that match the grade.
 */
function matchingSheets(sheets, grade) {
  if (!sheets || typeof sheets !== 'object') return []
  return Object.keys(sheets).filter((sheetName) => sheetMatchesGrade(sheetName, grade))
}

// ── 2013 schema-adaptive column detection ────────────────────────────────────
//
// The 2013 workbooks were digitised from PDFs with WILDLY inconsistent column
// schemas — a fixed cells.TOPIC / cells['SUB-TOPIC'] read (the old behaviour)
// silently produced ZERO subtopics for whole subjects, which then could never
// be generated (the studio requires a sub-topic). The real schemas seen in
// curriculum-data-2013.json:
//   A. [TOPIC, SUB-TOPIC, …]           → topic=TOPIC,     subtopic=SUB-TOPIC   (Biology, senior secondary)
//   B. [TOPIC, SUBTOPIC, …]            → topic=TOPIC,     subtopic=SUBTOPIC    (Integrated Science, Social Studies)
//   C. [THEME, SUB TOPIC, …]           → topic=THEME,     subtopic=SUB TOPIC   (Technology Studies 5-7)
//   D. [COMPONENT, TOPIC, …]           → topic=COMPONENT, subtopic=TOPIC       (English, Zambian Language)
//   E. [TOPIC, SPECIFIC OUTCOMES, …]   → topic=TOPIC,     subtopic=(none)      (Mathematics 1-7)
// For schema E (and any sheet whose sub-topic column is empty), sub-topics are
// SYNTHESISED from the SPECIFIC OUTCOMES so the subject is still usable.

const PREV_DETAIL_COLS = new Set([
  'specific outcomes', 'knowledge', 'content', 'skills', 'values',
])
const PREV_HEADER_WORDS = new Set([
  'topic', 'sub-topic', 'subtopic', 'sub topic', 'specific outcomes',
  'knowledge', 'content', 'skills', 'values', 'component', 'theme', 'strand',
])
const normCol = (c) => String(c == null ? '' : c).trim().toLowerCase()
const isSubtopicCol = (c) => /sub[\s_-]*topic/i.test(String(c || ''))

/**
 * Split a SPECIFIC OUTCOMES cell into individual outcome strings via the
 * canonical parser (handles primary-Maths 3-segment codes, OCR double-dots and
 * codes glued to their statement). Used to synthesise per-outcome sub-topics
 * for schema-E sheets (no sub-topic column, e.g. primary Mathematics).
 */
function splitOutcomesLenient(raw) {
  const t = String(raw || '').trim()
  if (!t) return []
  return splitSpecificOutcomes(t)
}

/** Pick the topic + subtopic columns for one 2013 sheet (see schemas above). */
function resolvePrevColumns(sheet) {
  let columns = Array.isArray(sheet?.columns) ? sheet.columns.filter(Boolean) : []
  if (!columns.length) {
    const first = (sheet?.rows || []).find((r) => r.type === 'data')
    columns = first ? Object.keys(first.cells || {}) : []
  }
  const subtopicCol = columns.find(isSubtopicCol) || null
  const structural = columns.filter((c) => !PREV_DETAIL_COLS.has(normCol(c)) && c !== subtopicCol)
  let topicCol = null
  let subCol = subtopicCol
  if (subtopicCol) {
    topicCol = structural.find((c) => normCol(c) === 'topic')
      || structural.find((c) => normCol(c) === 'theme')
      || structural[0] || null
  } else if (structural.length >= 2) {
    // Grouping column + granular column (e.g. COMPONENT + TOPIC): the grouping
    // column is the topic, the granular column is the sub-topic.
    topicCol = structural.find((c) => ['component', 'theme', 'strand'].includes(normCol(c))) || structural[0]
    subCol = structural.find((c) => c !== topicCol && normCol(c) === 'topic')
      || structural.find((c) => c !== topicCol) || null
  } else {
    topicCol = structural[0] || columns.find((c) => normCol(c) === 'topic') || null
    subCol = null
  }
  return { topicCol, subCol }
}

/**
 * Parse one 2013 / previous-curriculum sheet into propagated rows, adapting to
 * the sheet's actual column schema (see resolvePrevColumns). Skips header-echo
 * and blank filler rows, carries the topic forward over merged-cell blanks, and
 * — when the sheet has no usable sub-topic column — synthesises sub-topics from
 * the specific outcomes so every subject yields at least one selectable
 * sub-topic.
 *
 * @param {object} sheet The sheet object ({ columns, rows }).
 * @returns {Array<{topic, subtopic, specificOutcomesRaw, content}>}
 */
function propagatePreviousRows(sheet) {
  const { topicCol, subCol } = resolvePrevColumns(sheet)
  const shiftRoles = resolveColumnRoles(sheet?.columns)
  const out = []
  let topic = ''
  let carriedSub = ''
  for (const row of sheet?.rows || []) {
    if (row.type !== 'data') continue
    let cells = row.cells || {}
    // Drop repeated header rows and re-align page-break rows whose cells
    // shifted left (outcome text in the TOPIC column) before reading columns.
    if (isHeaderEchoRow(cells)) continue
    cells = repairColumnShiftedRow(cells, sheet?.columns, shiftRoles).cells
    const rawTopic = topicCol ? String(cells[topicCol] || '').trim() : ''
    const rawSub = subCol ? String(cells[subCol] || '').trim() : ''
    // Skip header-echo rows (the column-header line repeated mid-sheet).
    if (PREV_HEADER_WORDS.has(normCol(rawTopic)) && (!rawSub || PREV_HEADER_WORDS.has(normCol(rawSub)))) {
      continue
    }
    if (rawTopic) { topic = rawTopic; carriedSub = '' }
    if (rawSub) carriedSub = rawSub
    const specificOutcomesRaw = String(cells['SPECIFIC OUTCOMES'] || '').trim()
    const content = String(cells.CONTENT || cells.KNOWLEDGE || '').trim()
    // Skip pure-filler rows: nothing identifying and no content.
    if (!topic && !rawSub && !specificOutcomesRaw) continue
    // Merged-cell inheritance: a blank sub-topic cell on a row that carries
    // outcomes belongs to the previous sub-topic (vertically merged PDF cell).
    const subtopic = rawSub || (specificOutcomesRaw ? carriedSub : '')
    // A continuation of the SAME (topic, subtopic) — e.g. a repaired page-break
    // row — extends the previous entry instead of starting a new one, so
    // getSubtopicDetail sees ALL the sub-topic's outcomes + full content.
    const last = out.length ? out[out.length - 1] : null
    if (last && subtopic && last.subtopic === subtopic && last.topic === (topic || subtopic)) {
      last.specificOutcomesRaw = [last.specificOutcomesRaw, specificOutcomesRaw].filter(Boolean).join(' ')
      last.content = joinCellText(last.content, content)
      continue
    }
    out.push({ topic: topic || subtopic, subtopic, specificOutcomesRaw, content })
  }

  // Fallback: a sheet that produced no sub-topics at all (schema E, or a
  // sub-topic column that's blank throughout) would leave the subject
  // ungenerable. Synthesise sub-topics from the specific outcomes — each
  // outcome becomes one selectable sub-topic — so the subject works.
  if (out.length && !out.some((r) => r.subtopic)) {
    const synth = []
    for (const r of out) {
      const outcomes = splitOutcomesLenient(r.specificOutcomesRaw)
      if (outcomes.length) {
        for (const o of outcomes) {
          synth.push({ topic: r.topic, subtopic: o, specificOutcomesRaw: o, content: r.content })
        }
      } else if (r.content) {
        // Last resort: the topic stands as its own sub-topic.
        synth.push({ topic: r.topic, subtopic: r.topic, specificOutcomesRaw: r.specificOutcomesRaw, content: r.content })
      }
    }
    if (synth.length) return synth
  }
  return out
}

// ── Bundled-subject (strand) keys ─────────────────────────────────────────────
//
// ECE and Lower Primary are stored as ONE top-level subject whose sheets are the
// per-strand syllabi for a grade ("Grade 1 - English Language", "Grade 1 -
// Maths & Science", …). The old resolver returned just the top-level subject, so
// Nursery/Reception/Grade 1-3 showed a SINGLE lumped subject with every strand's
// topics mixed together — the teacher could not pick "Mathematics" vs "English".
// When a top-level subject has MORE THAN ONE sheet matching a single grade, we
// split it into one picker subject per strand, encoded as
// `${topLevelKey}::${sheetName}` so topic/sub-topic lookups can scope to the
// exact strand sheet. Subjects with a single matching sheet keep their plain
// top-level key (unchanged behaviour for upper-primary + secondary).

const SUBJECT_KEY_SEP = '::'

function makeStrandKey(topLevel, sheetName) {
  return `${topLevel}${SUBJECT_KEY_SEP}${sheetName}`
}

/**
 * Split a (possibly scoped) subject key into its parts.
 *
 * The suffix after '::' is a STRAND SHEET for the ECE / Lower-Primary bundles
 * ("Lower Primary Syllabi (Grades 1-3)::Grade 1 - English Language"), and a
 * SECTION SUBJECT for a split document ("Commerce & Principles of Accounts
 * Syllabus (Forms 1-4)::Commerce"). They are told apart by the split registry,
 * not by guessing at the text, and only one of the two is ever set.
 */
export function parseSubjectKey(subject) {
  const s = String(subject || '')
  const i = s.indexOf(SUBJECT_KEY_SEP)
  if (i === -1) return { topLevel: s, sheet: null, section: '' }
  const topLevel = s.slice(0, i)
  const suffix = s.slice(i + SUBJECT_KEY_SEP.length)
  const section = sectionSubjectForLabel(topLevel, suffix)
  return section
    ? { topLevel, sheet: null, section }
    : { topLevel, sheet: suffix, section: '' }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the list of subject keys available for a given grade.
 *
 * A subject is included when at least one of its sheet names matches the grade.
 * A top-level subject with several sheets matching the SAME grade (the ECE /
 * Lower Primary strand bundles) is split into one strand key per matching sheet
 * (`${topLevel}::${sheetName}`) so each strand is independently selectable.
 *
 * @param {string} grade           e.g. "Grade 4", "Form 1", "Grade 10"
 * @param {'cbc'|'previous'} [curriculumMode='cbc']
 * @returns {Promise<string[]>}
 */
export async function getSubjectsForGrade(grade, curriculumMode = 'cbc') {
  const data = await loadData(curriculumMode)
  const out = []
  for (const [subject, sheets] of Object.entries(data || {})) {
    const matched = matchingSheets(sheets, grade)
    if (matched.length === 0) continue
    if (SPLIT_DOCUMENTS[subject]) {
      // Two syllabi under one title: offer each as its own subject so the pick
      // is unambiguous. The grade already chose the sheet.
      for (const label of SPLIT_DOCUMENTS[subject].sectionLabels) {
        out.push(makeStrandKey(subject, label))
      }
    } else if (matched.length === 1) {
      out.push(subject)
    } else {
      // Bundle: one selectable subject per strand sheet.
      for (const sheetName of matched) out.push(makeStrandKey(subject, sheetName))
    }
  }
  return out
}

/**
 * Given a list of candidate grade strings, return only those that actually
 * have at least one subject in the loaded syllabi for the requested curriculum
 * mode.
 *
 * The grade picker offers a superset of grades (Nursery … Form 4 for CBC), but
 * the digitised syllabi don't cover every one of them — e.g. the CBC
 * "(Grades 4-6)" upper-primary subjects only ship a "Grade 4" sheet, so picking
 * Grade 5 or Grade 6 (or the ECE classes, whose sheets are keyed by age band)
 * yields zero subjects and a dead-end form the teacher can never complete. This
 * lets the picker show only grades that resolve to real subjects — the same
 * "never offer a dead option" rule the 2013 grade list already follows, applied
 * data-driven so it self-corrects when an admin adds more grade data.
 *
 * @param {string[]} candidateGrades  e.g. ["Grade 4", "Grade 5", "Form 1"]
 * @param {'cbc'|'previous'} [curriculumMode='cbc']
 * @returns {Promise<string[]>}  the subset of candidateGrades that have subjects
 */
export async function getGradesWithSubjects(candidateGrades, curriculumMode = 'cbc') {
  const data = await loadData(curriculumMode)
  const sheetsList = Object.values(data || {})
  return (candidateGrades || []).filter((grade) =>
    sheetsList.some((sheets) => matchingSheets(sheets, grade).length > 0),
  )
}

/**
 * Returns all topics and their subtopics for a given subject and grade.
 *
 * @param {string} subject
 * @param {string} grade
 * @param {'cbc'|'previous'} [curriculumMode='cbc']
 * @returns {Promise<Array<{label:string, subtopics:string[]}>>}
 */
export async function getTopicsForSubject(subject, grade, curriculumMode = 'cbc') {
  const data = await loadData(curriculumMode)
  const { topLevel, sheet: strandSheet, section } = parseSubjectKey(subject)
  const sheets = data?.[topLevel]
  if (!sheets) return []

  // A strand key scopes to its one sheet; a plain key uses every sheet that
  // matches the grade (the original behaviour for single-sheet subjects).
  const matching = strandSheet
    ? (sheets[strandSheet] ? [strandSheet] : [])
    : matchingSheets(sheets, grade)
  if (matching.length === 0) return []

  // Use a Map to preserve insertion order and deduplicate subtopics.
  const topicMap = new Map()

  for (const sheetName of matching) {
    const sheet = sheets[sheetName]
    const rows = curriculumMode === 'previous'
      ? propagatePreviousRows(sheet)
      : rowsWithPropagatedTopic(sheet?.rows || [])

    // Scope to the picked subject's half of a split document. An ambiguous
    // sheet yields no assignment, so `keep` stays null and every topic is shown
    // rather than an arbitrary half being hidden.
    let keep = null
    if (section) {
      const seen = []
      for (const row of rows) {
        if (row.topic && !seen.includes(row.topic)) seen.push(row.topic)
      }
      const split = resolveSplitSubjects(topLevel, seen)
      if (split && !split.ambiguous) keep = split.byTopic
    }

    for (const row of rows) {
      if (!row.topic) continue
      if (keep && keep.get(row.topic) !== section) continue
      const existing = topicMap.get(row.topic)
      if (!existing) {
        topicMap.set(row.topic, {
          label: row.topic,
          subtopics: row.subtopic ? [row.subtopic] : [],
        })
      } else if (row.subtopic && !existing.subtopics.includes(row.subtopic)) {
        topicMap.set(row.topic, {
          ...existing,
          subtopics: [...existing.subtopics, row.subtopic],
        })
      }
    }
  }

  // Sort topics — and each topic's sub-topics — NUMERICALLY by their leading
  // code segments, so "1.2.2" precedes "1.2.10" (source order can be uneven and
  // alphabetical sorting mis-orders multi-digit codes). Code-less topics keep
  // their insertion order (stable sort).
  const topics = Array.from(topicMap.values())
  for (const t of topics) {
    t.subtopics = sortByCurriculumCode(t.subtopics)
  }
  return sortByCurriculumCode(topics, (t) => t.label)
}

/**
 * Returns the full parsed detail for one subtopic row.
 *
 * CBC mode returns a CBCSubtopicRow:
 *   { topic, subtopic, specificCompetence, learningActivities[], expectedStandard }
 *
 * Previous/2013 mode returns an OldSubtopicRow:
 *   { topic, subtopic, specificOutcomes[] }
 *
 * Returns null when the subtopic is not found.
 *
 * @param {string} subject
 * @param {string} grade
 * @param {string} topic
 * @param {string} subtopic
 * @param {'cbc'|'previous'} [curriculumMode='cbc']
 * @returns {Promise<object|null>}
 */
export async function getSubtopicDetail(subject, grade, topic, subtopic, curriculumMode = 'cbc') {
  const data = await loadData(curriculumMode)
  const { topLevel, sheet: strandSheet } = parseSubjectKey(subject)
  const sheets = data?.[topLevel]
  if (!sheets) return null

  const matching = strandSheet
    ? (sheets[strandSheet] ? [strandSheet] : [])
    : matchingSheets(sheets, grade)
  if (matching.length === 0) return null

  const topicLower = String(topic || '').trim().toLowerCase()
  const subtopicLower = String(subtopic || '').trim().toLowerCase()

  for (const sheetName of matching) {
    const sheet = sheets[sheetName]

    if (curriculumMode === 'previous') {
      const rows = propagatePreviousRows(sheet)
      for (const row of rows) {
        if (
          String(row.topic || '').trim().toLowerCase() === topicLower &&
          String(row.subtopic || '').trim().toLowerCase() === subtopicLower
        ) {
          return {
            topic: row.topic,
            subtopic: row.subtopic,
            specificOutcomes: splitSpecificOutcomes(row.specificOutcomesRaw),
          }
        }
      }
    } else {
      // CBC: rowsWithPropagatedTopic already maps the correct column names.
      const rows = rowsWithPropagatedTopic(sheet?.rows || [])
      for (const row of rows) {
        if (
          String(row.topic || '').trim().toLowerCase() === topicLower &&
          String(row.subtopic || '').trim().toLowerCase() === subtopicLower
        ) {
          // Parse bullet-prefixed learning activities into an array.
          const rawActivities = String(row.learningActivities || '')
          const learningActivities = rawActivities
            .split('\n')
            .map((line) => line.replace(/^[•-]\s*/, '').trim())
            .filter(Boolean)

          return {
            topic: row.topic,
            subtopic: row.subtopic,
            specificCompetence: row.specificCompetence || '',
            learningActivities,
            expectedStandard: row.expectedStandard || '',
          }
        }
      }
    }
  }

  return null
}
