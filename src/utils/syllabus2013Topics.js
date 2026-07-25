// Topic suggestions from the OLD (2013) syllabus file. Client mirror of
// the minimal parts of functions/teacherTools/syllabiCurriculumData.js's
// get2013CurriculumDataTopics — topic names + knowledge sub-points only,
// because the client just feeds type-ahead suggestions; the SERVER
// re-grounds generation on the 2013 framework independently via
// resolveCbcContext({ framework: '2013' }).
//
// Keep STUDIO_SUBJECT_TO_KB_2013 in sync with the server copy.

import { sheetNameToGrade } from './syllabusMapping.js'
import { resolveColumnRoles, isHeaderEchoRow, repairColumnShiftedRow } from './curriculum2013Parser.js'
import { normalizeTopicLookup } from './syllabusTopicTree.js'

export const STUDIO_SUBJECT_TO_KB_2013 = {
  'Integrated Science Syllabus (Grades 1-7, 2013)': 'integrated_science',
  'Mathematics Syllabus (Grades 1-7, 2013)': 'mathematics',
  'Social Studies Syllabus (Grades 1-7, 2013)': 'social_studies',
  'English Language Syllabus (Grades 2-7, 2013)': 'english',
  'Creative & Technology Studies Syllabus (2013)': 'creative_and_technology_studies',
  'Home Economics Syllabus (Grades 5-7, 2013)': 'home_economics',
  'Technology Studies Syllabus (Grades 5-7, 2013)': 'technology_studies',
  'Expressive Arts Syllabus (Grades 5-7, 2013)': 'expressive_arts',
  'Zambian Language Syllabus (Grades 5-7, 2013)': 'zambian_language',
  'Physical Education Syllabus (Grades 8-9, 2013)': 'physical_education',
  'Agricultural Science Syllabus (Grades 10-12, 2013)': 'agricultural_science',
  'Art & Design Syllabus (Grades 10-12, 2013)': 'art_and_design',
  'Biology Syllabus (Grades 10-12, 2013)': 'biology',
  'Chemistry Syllabus (Grades 10-12, 2013)': 'chemistry',
  'Civic Education Syllabus (Grades 10-12, 2013)': 'civic_education',
  // Food & Nutrition and Home Management are two separate examinable subjects,
  // each numbered from 10.1. Filing both under home_economics made every one of
  // their codes collide at G10-G12 and made hierarchy repair pick a parent by
  // document order. The G5-7 "Home Economics" syllabus below is a genuinely
  // different subject at different grades and keeps the home_economics key.
  'Food & Nutrition Syllabus (Grades 10-12, 2013)': 'food_and_nutrition',
  'Geography Syllabus (Grades 10-12, 2013)': 'geography',
  'History Syllabus (Senior Secondary, 2013)': 'history',
  'Home Management Syllabus (Grades 10-12, 2013)': 'home_management',
  'Mathematics Syllabus (Grades 10-12, 2013)': 'mathematics',
  'Physical Education Syllabus (Grades 10-12, 2013)': 'physical_education',
  // RE 2044 and RE 2046 are two distinct ECZ examinable syllabi, sat by
  // different candidates, and each numbers its topics from 10.1. Filing both
  // under `religious_education` made 10.1-10.4 collide at G10 (2044's "Work in
  // a changing society" against 2046's "Birth and infancy of John the Baptist
  // and Jesus") and left hierarchy repair picking a parent by document order.
  // 2044 is the thematic/life-issues syllabus, 2046 the Biblical Studies one;
  // the junior + primary RE syllabi keep the plain religious_education key.
  'Religious Education 2044 Syllabus (Grades 10-12, 2013)': 'religious_education_2044',
  'Religious Education 2046 Syllabus (Grades 10-12, 2013)': 'religious_education_2046',
}

// The 2013 workbooks have mangled headers — the topic column carries a
// stray heading from the source PDF, so we detect it as the first column
// that is NOT one of the known data columns (server does the same).
const KNOWN_COLS = new Set([
  'TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES',
])

export function detect2013TopicColumn(sheet) {
  const cols = Array.isArray(sheet?.columns) ? sheet.columns : []
  for (const c of cols) {
    if (c && !KNOWN_COLS.has(c)) return c
  }
  return null
}

function splitBullets(s) {
  const str = String(s || '').trim()
  if (!str) return []
  const parts = str.split(/[•●·]\s*/g).map((p) => p.trim()).filter(Boolean)
  return parts.length ? parts : [str]
}

/**
 * Parse the raw curriculum-data-2013.json object into the same lookup
 * shape syllabusTopicOptions uses for 2023:
 *   Map "GRADE|subject" → Map<topicName, Set<subtopicName>>
 *
 * Sub-topic suggestions come from the sheet's REAL sub-topic column (resolved
 * by role, so SUBTOPIC / SUB-TOPIC / SUB TOPIC spellings all work). Content /
 * KNOWLEDGE bullets are only used as a fallback for sheets that genuinely have
 * no sub-topic column (schema E, e.g. primary Mathematics) — they are content
 * points, not sub-topics, and must not displace the real hierarchy.
 *
 * The raw walk below can only propagate whatever the TOPIC column holds, and at
 * a PDF page break that is often a SUB-topic code or a scrap of the previous
 * row. normalizeTopicLookup re-derives the real two-level tree from the dotted
 * numbering before the lookup is handed out, so the picker shows topics and
 * their sub-topics rather than one flat list of both.
 */
export function extract2013TopicLookup(raw) {
  return normalizeTopicLookup(extract2013TopicLookupRaw(raw))
}

/**
 * The unrepaired walk — whatever the TOPIC column literally held, page-break
 * damage and all. Only the syllabus validation report
 * (scripts/validate-syllabus-catalogue.mjs) should use this: it needs to
 * describe the SOURCE data, not the repaired view every other caller gets.
 */
export function extract2013TopicLookupRaw(raw) {
  const byKey = new Map()
  for (const [studioSubject, sheets] of Object.entries(raw || {})) {
    const subject = STUDIO_SUBJECT_TO_KB_2013[studioSubject]
    if (!subject) continue
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const grade = sheetNameToGrade(sheetName)
      if (!grade) continue
      const roles = resolveColumnRoles(sheet?.columns)
      // Legacy mis-headed sheets: the topic may live in a stray-header column.
      const topicCol = roles.topic || detect2013TopicColumn(sheet)
      const subCol = roles.subtopic
      const contentCols = roles.content || []
      const key = `${String(grade).toUpperCase()}|${subject}`
      let inner = byKey.get(key)
      if (!inner) { inner = new Map(); byKey.set(key, inner) }
      let topic = ''
      for (const row of (sheet?.rows || [])) {
        if (row?.type !== 'data') continue
        let cells = row.cells || {}
        if (isHeaderEchoRow(cells)) continue
        // Re-align page-break rows whose cells shifted left, so outcome text
        // in the TOPIC column never becomes a picker "topic".
        cells = repairColumnShiftedRow(cells, sheet?.columns, roles).cells
        const codeRaw = topicCol ? String(cells[topicCol] || '').trim() : ''
        if (codeRaw) topic = codeRaw
        if (!topic) continue
        let subs = inner.get(topic)
        if (!subs) { subs = new Set(); inner.set(topic, subs) }
        if (subCol) {
          const sub = String(cells[subCol] || '').trim()
          if (sub.length >= 3) subs.add(sub.slice(0, 200))
        } else {
          // No sub-topic column on this sheet — content bullets keep the
          // subject usable as type-ahead suggestions (legacy behaviour).
          for (const col of (contentCols.length ? contentCols : ['KNOWLEDGE'])) {
            for (const k of splitBullets(cells[col])) {
              if (k.length >= 3) subs.add(k.slice(0, 200))
            }
          }
        }
      }
    }
  }
  return byKey
}
