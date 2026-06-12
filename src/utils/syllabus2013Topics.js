// Topic suggestions from the OLD (2013) syllabus file. Client mirror of
// the minimal parts of functions/teacherTools/syllabiCurriculumData.js's
// get2013CurriculumDataTopics — topic names + knowledge sub-points only,
// because the client just feeds type-ahead suggestions; the SERVER
// re-grounds generation on the 2013 framework independently via
// resolveCbcContext({ framework: '2013' }).
//
// Keep STUDIO_SUBJECT_TO_KB_2013 in sync with the server copy.

import { sheetNameToGrade } from './syllabusMapping.js'

export const STUDIO_SUBJECT_TO_KB_2013 = {
  'Integrated Science Syllabus (Grades 1-7, 2013)': 'integrated_science',
  'Mathematics Syllabus (Grades 1-7, 2013)': 'mathematics',
  'Social Studies Syllabus (Grades 1-7, 2013)': 'social_studies',
  'English Language Syllabus (Grades 2-7, 2013)': 'english',
  'Creative & Technology Studies Syllabus (2013)': 'creative_and_technology_studies',
  'Home Economics Syllabus (Grades 5-7, 2013)': 'home_economics',
  'Design & Technology Syllabus (Grades 5-7, 2013)': 'design_and_technology',
  'Expressive Arts Syllabus (Grades 5-7, 2013)': 'expressive_arts',
  'Zambian Language Syllabus (Grades 5-7, 2013)': 'zambian_language',
  'Physical Education Syllabus (Grades 8-9, 2013)': 'physical_education',
  'Agricultural Science Syllabus (Grades 10-12, 2013)': 'agricultural_science',
  'Art & Design Syllabus (Grades 10-12, 2013)': 'art_and_design',
  'Biology Syllabus (Grades 10-12, 2013)': 'biology',
  'Chemistry Syllabus (Grades 10-12, 2013)': 'chemistry',
  'Civic Education Syllabus (Grades 10-12, 2013)': 'civic_education',
  'Food & Nutrition Syllabus (Grades 10-12, 2013)': 'home_economics',
  'Geography Syllabus (Grades 10-12, 2013)': 'geography',
  'History Syllabus (Senior Secondary, 2013)': 'history',
  'Home Management Syllabus (Grades 10-12, 2013)': 'home_economics',
  'Mathematics Syllabus (Grades 10-12, 2013)': 'mathematics',
  'Physical Education Syllabus (Grades 10-12, 2013)': 'physical_education',
  'Religious Education 2044 Syllabus (Grades 10-12, 2013)': 'religious_education',
  'Religious Education 2046 Syllabus (Grades 10-12, 2013)': 'religious_education',
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
 * Sub-topic suggestions come from the KNOWLEDGE column bullets.
 */
export function extract2013TopicLookup(raw) {
  const byKey = new Map()
  for (const [studioSubject, sheets] of Object.entries(raw || {})) {
    const subject = STUDIO_SUBJECT_TO_KB_2013[studioSubject]
    if (!subject) continue
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const grade = sheetNameToGrade(sheetName)
      if (!grade) continue
      const topicCol = detect2013TopicColumn(sheet)
      const key = `${String(grade).toUpperCase()}|${subject}`
      let inner = byKey.get(key)
      if (!inner) { inner = new Map(); byKey.set(key, inner) }
      let topic = ''
      for (const row of (sheet?.rows || [])) {
        if (row?.type !== 'data') continue
        const cells = row.cells || {}
        const codeRaw = topicCol ? String(cells[topicCol] || '').trim() : ''
        if (codeRaw) topic = codeRaw
        if (!topic) continue
        let subs = inner.get(topic)
        if (!subs) { subs = new Set(); inner.set(topic, subs) }
        for (const k of splitBullets(cells.KNOWLEDGE)) {
          if (k.length >= 3) subs.add(k.slice(0, 200))
        }
      }
    }
  }
  return byKey
}
