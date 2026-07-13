/**
 * Bridges the Syllabi Studio data shape (subject → sheet → rows of
 * TOPIC / SUB-TOPIC / SPECIFIC COMPETENCES / LEARNING ACTIVITIES /
 * EXPECTED STANDARD) and the CBC Knowledge Base topic shape
 * ({ grade, subject, topic, subtopics[{name, specificCompetence,
 * learningActivities, expectedStandard}], specificOutcomes, ... }).
 *
 * Used by both:
 *   - src/components/admin/CbcKbAdmin.jsx (the admin browser/editor)
 *   - src/utils/syllabusKbService.js (read/write merged source)
 *   - functions/teacherTools/curriculumDataLoader.js (server-side mirror)
 *
 * Keep this file pure (no imports of Firebase / React) so the server can
 * require the JSON-mapping subset without touching the SDKs.
 */

// Pure text helpers shared with the curriculum parser (page-break fragment
// healing + joined-competence splitting) — no SDK imports there either.
import { joinCellText, splitSpecificOutcomes } from './curriculum2013Parser.js'

// ── Subject-key mapping ──────────────────────────────────────────────────
// The Syllabi Studio uses long human-readable subject names (e.g.
// "Mathematics Syllabus (Forms 1-4)"). The CBC KB uses canonical slug
// keys ("mathematics") shared with TEACHER_SUBJECTS. The same canonical
// subject can map to several Studio subjects (one per grade band).

export const STUDIO_SUBJECT_TO_KB = {
  'Agricultural Science Syllabus (Forms 1-4)':     'agricultural_science',
  'Art & Design Syllabus (Forms 1-4)':             'art_and_design',
  'Biology Syllabus (Forms 1-4)':                  'biology',
  'English Syllabus (Forms 1-4)':                  'english',
  'Commerce & Principles of Accounts Syllabus (Forms 1-4)': 'commerce_and_principles_of_accounts',
  'Design & Technology Studies Syllabus (Forms 1-4)': 'design_and_technology_studies',
  'Early Childhood Education Syllabi (3-5 Years)': 'expressive_arts',
  'Lower Primary Syllabi (Grades 1-3)':            'english',
  'English Language Syllabus (Grades 4-6)':        'english',
  'Mathematics Syllabus (Grades 4-6)':             'mathematics',
  'Science Syllabus (Grades 4-6)':                 'integrated_science',
  'Social Studies Syllabus (Grades 4-6)':          'social_studies',
  'Home Economics & Hospitality Syllabus (Grades 4-6)': 'home_economics',
  'Technology Studies Syllabus (Grades 4-6)':      'technology_studies',
  'Mathematics Syllabus (Forms 1-4)':              'mathematics',
  'Mathematics II Syllabus (Forms 1-4)':           'mathematics',
  'Physics Syllabus (Forms 1-4)':                  'physics',
  'History Syllabus (Forms 1-4)':                  'history',
  'Geography Syllabus (Forms 1-4)':                'geography',
  'ICT Syllabus (Forms 1-4)':                      'technology_studies',
  'Literature in English Syllabus (Forms 1-4)':    'english',
  'Religious Education Syllabus (Forms 1-4)':      'religious_education',
  'Physical Education Syllabus (Forms 1-4)':       'physical_education',
  'Food & Nutrition Syllabus (Forms 1-4)':         'home_economics',
  'Fashion & Fabrics Syllabus (Forms 1-4)':        'home_economics',
  'Hospitality Management Syllabus (Forms 1-4)':   'home_economics',
  'Music & Creative Arts Syllabus (Forms 1-4)':    'music_and_creative_arts',
  'Travel & Tourism Syllabus (Forms 1-4)':         'social_studies',
  'Zambian Languages Syllabus (Forms 1-4)':        'zambian_language',
}

// ── Sheet-name → grade ───────────────────────────────────────────────────
// Pre-primary sheets like "3-4 Years - English Language" map to the ECE age
// band ('ECE_N' Nursery / 'ECE_R' Reception); the per-band-language splits
// are resolved by studioSubjectToKbSubject from the sheet name.
//
// Lower Primary sheets carry the grade plus an internal language/strand
// (e.g. "Grade 1 - English Language"). The CBC KB only needs the grade,
// so we strip the trailing strand.
//
// Secondary sheets use the historical "Form N" labelling. The CBC system
// maps Form 1..4 to G8..G11 (the Form 5 ↔ G12 cap is consistent with
// TEACHER_GRADES, which displays "G8 / Form 1").
const FORM_TO_GRADE = {
  'form 1': 'G8',
  'form 2': 'G9',
  'form 3': 'G10',
  'form 4': 'G11',
  'form 3 - 4': 'G10',
  'form 5': 'G12',
}

// ECE age bands map to distinct grade codes so the topic/sub-topic pickers
// can scope to the band the teacher picked (Nursery 3-4 vs Reception 4-5).
// The combined "3-5 Years" band (if a sheet ever uses it) stays the generic
// 'ECE' code. Keep in lock-step with functions/teacherTools/syllabiCurriculumData.js.
const ECE_NURSERY_PATTERN = /3-4\s*years?/i   // Nursery (3-4)
const ECE_RECEPTION_PATTERN = /4-5\s*years?/i // Reception (4-5)
const ECE_COMBINED_PATTERN = /3-5\s*years?/i

export function sheetNameToGrade(sheetName) {
  if (!sheetName) return ''
  const lower = String(sheetName).trim().toLowerCase()
  if (ECE_NURSERY_PATTERN.test(lower)) return 'ECE_N'
  if (ECE_RECEPTION_PATTERN.test(lower)) return 'ECE_R'
  if (ECE_COMBINED_PATTERN.test(lower)) return 'ECE'
  const gradeMatch = lower.match(/grade\s*(\d+)/)
  if (gradeMatch) return `G${gradeMatch[1]}`
  for (const [pattern, grade] of Object.entries(FORM_TO_GRADE)) {
    if (lower.startsWith(pattern)) return grade
  }
  const formMatch = lower.match(/form\s*(\d+)/)
  if (formMatch) {
    const n = Number(formMatch[1])
    if (n >= 1 && n <= 5) return `G${n + 7}`
  }
  return ''
}

export function studioSubjectToKbSubject(studioSubject, sheetName) {
  // ECE + Lower Primary have ONE top-level syllabus that bundles every
  // strand (English, Zambian Languages, Maths & Science, Creative). The
  // canonical CBC subject lives in the sheet name, not the top-level
  // subject key — without this dispatch every G1 row gets force-mapped
  // to "english", erasing zambian_language / numeracy / creative coverage.
  if (
    studioSubject === 'Early Childhood Education Syllabi (3-5 Years)' ||
    studioSubject === 'Lower Primary Syllabi (Grades 1-3)'
  ) {
    const lower = String(sheetName || '').toLowerCase()
    const isEce = studioSubject.startsWith('Early')
    if (lower.includes('english')) return 'english'
    if (lower.includes('zambian')) return 'zambian_language'
    if (lower.includes('creative') || lower.includes('tech')) {
      // ECE doesn't have "Creative & Technology Studies" — the closest
      // CBC subject is Expressive Arts. Lower Primary has the dedicated
      // Creative & Technology Studies key.
      return isEce ? 'expressive_arts' : 'creative_and_technology_studies'
    }
    if (
      lower.includes('math') || lower.includes('numeracy') || lower.includes('science')
    ) {
      // Maths & Science is one combined sheet in both ECE and Lower
      // Primary. Numeracy covers it best: it's the pre-Mathematics
      // strand and at this level the science content is environment
      // observation woven into number/measurement activities.
      return 'numeracy'
    }
    return STUDIO_SUBJECT_TO_KB[studioSubject] || ''
  }
  return STUDIO_SUBJECT_TO_KB[studioSubject] || ''
}

// The column-header names the studio sheets use. When a row's cells echo
// these names verbatim it's a duplicated header line captured during PDF
// ingestion (the CDC PDFs repeat the header at every page break), not real
// content — see isHeaderEchoRow below.
const COLUMN_HEADER_NAMES = new Set([
  'TOPIC', 'SUB-TOPIC', 'SUBTOPIC', 'SPECIFIC COMPETENCES',
  'LEARNING ACTIVITIES', 'EXPECTED STANDARD',
])

// True when a data row is just the sheet's column-header line repeated in the
// body (e.g. {TOPIC:"TOPIC", "SUB-TOPIC":"SUB-TOPIC", ...}). These slip in at
// PDF page breaks and would otherwise surface as a bogus "TOPIC" topic with a
// "SUB-TOPIC" sub-topic. Require ≥2 echoed cells so a real one-word topic that
// happens to equal a header (unlikely, but safe) isn't dropped.
function isHeaderEchoRow(cells) {
  const values = ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD']
    .map((k) => String(cells[k] || cells[k.replace('-', '')] || '').trim().toUpperCase())
    .filter(Boolean)
  return values.length >= 2 && values.every((v) => COLUMN_HEADER_NAMES.has(v))
}

// Each data row from the Studio carries its own "TOPIC" header in the
// first cell, but rows under the same topic leave it blank to mimic the
// CDC PDFs' merged cells. Walk the rows in order and propagate the most
// recent non-empty topic forward.
//
// Two classes of ingestion artifact are stripped here so they never reach the
// topic/sub-topic pickers (or the AI grounding):
//   1. Header-echo rows — the column-header line repeated mid-sheet.
//   2. Empty section banners stored as data rows — strand headings like
//      "READING" / "WRITING" / "VOCABULARY" that were captured as a TOPIC with
//      no sub-topic and no competence/activity/standard. A genuine topic always
//      carries at least one sub-topic or some content, so a topic that has
//      neither across all its rows is a mis-tagged banner and is dropped.
export function rowsWithPropagatedTopic(rows) {
  const out = []
  let topic = ''
  let section = ''
  for (const row of rows || []) {
    if (row.type === 'section') {
      section = row.label || ''
      continue
    }
    if (row.type !== 'data') continue
    const cells = row.cells || {}
    if (isHeaderEchoRow(cells)) continue
    const raw = String(cells.TOPIC || '').trim()
    if (raw) topic = raw
    const subtopic = String(cells['SUB-TOPIC'] || cells.SUBTOPIC || '').trim()
    const specificCompetence = String(cells['SPECIFIC COMPETENCES'] || '').trim()
    const learningActivities = String(cells['LEARNING ACTIVITIES'] || '').trim()
    const expectedStandard = String(cells['EXPECTED STANDARD'] || '').trim()
    // Page-break continuation row: no sub-topic and no competence, only the
    // tail of the previous row's activities/standard cells (the PDFs split
    // those cells mid-phrase at page breaks). Join it back onto the previous
    // row instead of emitting a fragment row the pickers can't attach.
    const prev = out.length ? out[out.length - 1] : null
    if (prev && !raw && !subtopic && !specificCompetence && (learningActivities || expectedStandard)) {
      prev.learningActivities = joinCellText(prev.learningActivities, learningActivities)
      prev.expectedStandard = joinCellText(prev.expectedStandard, expectedStandard)
      continue
    }
    out.push({
      topic,
      section,
      subtopic,
      specificCompetence,
      learningActivities,
      expectedStandard,
    })
  }

  // Drop topics that never carry a sub-topic or any content — these are the
  // empty strand banners (READING / WRITING / …) mis-tagged as topics.
  const topicHasSubstance = new Map()
  for (const r of out) {
    if (topicHasSubstance.get(r.topic)) continue
    if (r.subtopic || r.specificCompetence || r.learningActivities || r.expectedStandard) {
      topicHasSubstance.set(r.topic, true)
    }
  }
  return out.filter((r) => !r.topic || topicHasSubstance.get(r.topic))
}

/**
 * Deterministic key for one row of the Studio data. Used both to address
 * the row in the UI and to key Firestore overrides. Stable across edits
 * because it's derived from the stable column values that an admin would
 * use to identify which row to modify.
 */
export function rowKey(studioSubject, sheetName, topic, subtopic) {
  const parts = [studioSubject, sheetName, topic || '', subtopic || '']
    .map((p) => String(p || '').trim().toLowerCase().replace(/\s+/g, '_'))
  return parts.join('||')
}

/**
 * Turn a single propagated row into a KB-shape topic entry (one topic per
 * row's TOPIC value). The caller is expected to collapse rows that share
 * the same {grade, subject, topic} so each KB entry carries every
 * sub-topic for that topic at that grade level.
 */
export function rowToTopicFragment({ row, studioSubject, sheetName }) {
  const grade = sheetNameToGrade(sheetName)
  const subject = studioSubjectToKbSubject(studioSubject, sheetName)
  if (!grade || !subject || !row.topic) return null
  return {
    grade,
    subject,
    topic: row.topic,
    // Enriched sub-topic shape — same as the Phase-A syllabus parser
    // writes. cbcKnowledge.js subtopicName() handles both legacy strings
    // and these objects without changes.
    subtopic: row.subtopic ? {
      name: row.subtopic,
      specificCompetence: row.specificCompetence || '',
      learningActivities: row.learningActivities || '',
      expectedStandard: row.expectedStandard || '',
    } : null,
    section: row.section || '',
  }
}

/**
 * Collapse a flat list of {grade, subject, topic, subtopic} fragments
 * into the KB topic shape: one entry per (grade+subject+topic) with all
 * the subtopics under it.
 */
export function fragmentsToTopics(fragments) {
  const byKey = new Map()
  for (const frag of fragments) {
    if (!frag) continue
    const key = `${frag.grade}|${frag.subject}|${frag.topic.toLowerCase()}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = {
        id: `${slug(frag.grade)}-${slug(frag.subject)}-${slug(frag.topic)}`,
        grade: frag.grade,
        subject: frag.subject,
        topic: frag.topic,
        subtopics: [],
        specificOutcomes: [],
        keyCompetencies: [],
        values: [],
        suggestedMaterials: [],
        origin: 'syllabi_studio',
      }
      byKey.set(key, entry)
    }
    if (frag.subtopic) {
      entry.subtopics.push(frag.subtopic)
      // Bubble the per-subtopic specificCompetence up as a topic-level
      // outcome too so the legacy renderContextBlock() path still has
      // something to put under "Typical Specific Outcomes" for callers
      // that match at the topic level (not at the subtopic level).
      // A cell can hold SEVERAL coded competences (the ECE sheets join
      // "0.1.1.6.1 Name… 0.1.1.6.2 Use…") — split so each is its own outcome.
      if (frag.subtopic.specificCompetence) {
        for (const o of splitSpecificOutcomes(frag.subtopic.specificCompetence)) {
          entry.specificOutcomes.push(o.code ? `${o.code} ${o.statement}` : o.statement)
        }
      }
    }
  }
  return Array.from(byKey.values())
}

function slug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/**
 * Normalises the full Studio JSON into the KB topic shape. Used by both
 * the client admin page (so the merge happens once) and the server-side
 * `curriculumDataLoader.js`.
 */
export function syllabiToKbTopics(rawData) {
  if (!rawData || typeof rawData !== 'object') return []
  const fragments = []
  for (const [studioSubject, sheets] of Object.entries(rawData)) {
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const rows = rowsWithPropagatedTopic(sheet?.rows || [])
      for (const row of rows) {
        const frag = rowToTopicFragment({ row, studioSubject, sheetName })
        if (frag) fragments.push(frag)
      }
    }
  }
  return fragmentsToTopics(fragments)
}
