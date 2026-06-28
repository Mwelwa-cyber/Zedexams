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

import { getMergedSyllabi } from '../../../../utils/syllabusKbService.js'
import { rowsWithPropagatedTopic } from '../../../../utils/syllabusMapping.js'
import { splitSpecificOutcomes } from './splitSpecificOutcomes.js'

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
 * Check whether a sheet name belongs to the requested grade (case-insensitive).
 *
 * CBC sheets:  "Form 1", "Form 2", "Grade 4", "3-4 Years - English Language", …
 * 2013 sheets: "Grade 10", "Grade 11", …
 *
 * Matching:
 *   1. Exact match.
 *   2. Sheet starts with grade string (sheet "Form 1 - English" matches grade "Form 1").
 *   3. Grade starts with sheet string (symmetric).
 */
function sheetMatchesGrade(sheetName, grade) {
  if (!sheetName || !grade) return false
  const sheet = String(sheetName).trim().toLowerCase()
  const g = String(grade).trim().toLowerCase()
  return sheet === g || sheet.startsWith(g + ' ') || g.startsWith(sheet + ' ')
}

/**
 * Return sheet names from the subject's sheets object that match the grade.
 */
function matchingSheets(sheets, grade) {
  if (!sheets || typeof sheets !== 'object') return []
  return Object.keys(sheets).filter((sheetName) => sheetMatchesGrade(sheetName, grade))
}

/**
 * Propagate the topic carry-forward for 2013 / previous curriculum rows.
 *
 * The 2013 data uses different column names than CBC
 * (SPECIFIC OUTCOMES vs SPECIFIC COMPETENCES, etc.). rowsWithPropagatedTopic
 * from syllabusMapping only maps CBC column names, so we do the propagation
 * here and return the raw cells alongside the propagated topic.
 *
 * Also skips header-echo rows (rows where TOPIC === "TOPIC") and
 * rows where every meaningful cell is empty (blank filler rows in the PDF).
 *
 * @param {Array} rows Raw rows from the sheet.
 * @returns {Array<{topic, subtopic, specificOutcomes, content, skills, values}>}
 */
function propagatePreviousRows(rows) {
  const out = []
  let topic = ''
  for (const row of rows || []) {
    if (row.type !== 'data') continue
    const cells = row.cells || {}
    const rawTopic = String(cells.TOPIC || '').trim()
    // Skip header-echo rows ("TOPIC" in the TOPIC cell and "SUB-TOPIC" in SUB-TOPIC).
    if (
      rawTopic.toUpperCase() === 'TOPIC' &&
      String(cells['SUB-TOPIC'] || '').trim().toUpperCase() === 'SUB-TOPIC'
    ) {
      continue
    }
    if (rawTopic) topic = rawTopic
    const subtopic = String(cells['SUB-TOPIC'] || cells.SUBTOPIC || '').trim()
    const specificOutcomesRaw = String(cells['SPECIFIC OUTCOMES'] || '').trim()
    // Skip pure-filler rows: no subtopic and no outcomes.
    if (!subtopic && !specificOutcomesRaw) continue
    out.push({
      topic,
      subtopic,
      specificOutcomesRaw,
      content: String(cells.CONTENT || '').trim(),
      skills: String(cells.Skills || '').trim(),
      values: String(cells.Values || '').trim(),
    })
  }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the list of subject names available for a given grade.
 *
 * A subject is included when at least one of its sheet names matches the
 * requested grade string.
 *
 * @param {string} grade           e.g. "Grade 4", "Form 1", "Grade 10"
 * @param {'cbc'|'previous'} [curriculumMode='cbc']
 * @returns {Promise<string[]>}
 */
export async function getSubjectsForGrade(grade, curriculumMode = 'cbc') {
  const data = await loadData(curriculumMode)
  return Object.entries(data || {})
    .filter(([, sheets]) => matchingSheets(sheets, grade).length > 0)
    .map(([subject]) => subject)
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
  const sheets = data?.[subject]
  if (!sheets) return []

  const matching = matchingSheets(sheets, grade)
  if (matching.length === 0) return []

  // Use a Map to preserve insertion order and deduplicate subtopics.
  const topicMap = new Map()

  for (const sheetName of matching) {
    const sheet = sheets[sheetName]
    const rows = curriculumMode === 'previous'
      ? propagatePreviousRows(sheet?.rows || [])
      : rowsWithPropagatedTopic(sheet?.rows || [])

    for (const row of rows) {
      if (!row.topic) continue
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

  return Array.from(topicMap.values())
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
  const sheets = data?.[subject]
  if (!sheets) return null

  const matching = matchingSheets(sheets, grade)
  if (matching.length === 0) return null

  const topicLower = String(topic || '').trim().toLowerCase()
  const subtopicLower = String(subtopic || '').trim().toLowerCase()

  for (const sheetName of matching) {
    const sheet = sheets[sheetName]

    if (curriculumMode === 'previous') {
      const rows = propagatePreviousRows(sheet?.rows || [])
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
