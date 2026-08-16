/**
 * Classify a record saved under a pre-split subject key.
 *
 * Canonical subjects were carved out of shared keys:
 *
 *   commerce_and_principles_of_accounts → commerce | principles_of_accounts
 *   home_economics (senior only)        → food_and_nutrition | home_management
 *                                       | fashion_and_fabrics
 *                                       | hospitality_management
 *   mathematics (Forms 1-4 second book) → mathematics_ii
 *   english (Forms 1-4 literature)      → literature_in_english
 *
 * Records written before the split still carry the shared key. Reassigning them
 * matters — the subject decides which syllabus grounds a regeneration and which
 * topic tree a picker offers — but assigning the WRONG subject is worse than
 * leaving the old key in place, because it silently moves a teacher's paper into
 * a syllabus it was never written against.
 *
 * So this classifier is deliberately conservative and refuses rather than
 * guesses. The evidence it will act on, strongest first:
 *
 *   1. An explicit source-syllabus field naming the document it came from.
 *   2. Its topics matching the real catalogue. Every topic is looked up in the
 *      split catalogue for the record's own curriculum + grade; the record is
 *      classified only when every topic that resolves resolves to the SAME
 *      subject. This is evidence from the Ministry's own data, not a keyword
 *      guess, and it is the path almost every record takes.
 *   3. Nothing else. A record whose topics resolve to both subjects (a paper
 *      that genuinely spans them), or to neither (free-text topics, no topics at
 *      all, a grade with no catalogue rows), is reported AMBIGUOUS for a human
 *      to decide. It is never assigned to "the first match".
 *
 * Every outcome carries the evidence that produced it so the migration report
 * can be audited rather than trusted.
 *
 * Pure (no React, no Firebase, no I/O).
 */

import { normalizeCurriculumId } from '../curriculum/resolvers/curriculumTopicIdentity.js'
import { SPLIT_DOCUMENTS } from './syllabusSubjectSplit.js'
import { parseTopicCode } from './syllabusTopicTree.js'

/**
 * Shared keys that need per-record classification, and the candidates each can
 * resolve to.
 *
 * home_economics is a special case: it is STILL a real subject (CBC Grades 4-6,
 * 2013 Grades 5-7). Only records whose topics actually belong to one of the
 * senior-secondary pathways should move; a genuine Home Economics record stays
 * put. So its candidate list includes home_economics itself.
 */
export const SPLIT_SOURCES = Object.freeze({
  commerce_and_principles_of_accounts: ['commerce', 'principles_of_accounts'],
  home_economics: [
    'food_and_nutrition',
    'home_management',
    'fashion_and_fabrics',
    'hospitality_management',
    'home_economics',
  ],
  // `mathematics` is different again, and the difference matters. Unlike the
  // retired combined key, it stays the CORRECT key for the Mathematics syllabus
  // at every grade in both curricula — Mathematics II was folded INTO it, so the
  // misfiled records are the ones authored against Mathematics II topics. A
  // record here is therefore only moved when its topics say Mathematics II; with
  // no such evidence the existing key is already right and is left alone.
  mathematics: ['mathematics', 'mathematics_ii'],
  // `english` is the same shape as `mathematics`: still the correct key for the
  // English language syllabus everywhere, with Literature in English folded into
  // it. Only records authored against Literature topics move.
  english: ['english', 'literature_in_english'],
  // `religious_education` divides only in the 2013 senior-secondary set, where
  // RE 2044 and RE 2046 are separately examined syllabi both numbered from 10.1.
  // Everywhere else — the whole CBC, and the OBC below senior secondary — it is
  // still the one correct key, so it stays among its own candidates and the
  // curriculum+grade narrowing below is what confines the split to G10-G12 of
  // the 2013 curriculum.
  religious_education: [
    'religious_education',
    'religious_education_2044',
    'religious_education_2046',
  ],
})

/** Outcome codes. `unchanged` means "correctly on this key already". */
export const OUTCOMES = Object.freeze({
  CLASSIFIED: 'classified',
  AMBIGUOUS: 'ambiguous',
  UNCHANGED: 'unchanged',
  NOT_APPLICABLE: 'not_applicable',
})

/** Document title → the canonical subject a source-syllabus field implies. */
const SOURCE_DOCUMENT_SUBJECTS = Object.freeze({
  'Commerce & Principles of Accounts Syllabus (Forms 1-4)': null, // two subjects — no answer
  'Food & Nutrition Syllabus (Forms 1-4)': 'food_and_nutrition',
  'Food & Nutrition Syllabus (Grades 10-12, 2013)': 'food_and_nutrition',
  'Fashion & Fabrics Syllabus (Forms 1-4)': 'fashion_and_fabrics',
  'Hospitality Management Syllabus (Forms 1-4)': 'hospitality_management',
  'Home Management Syllabus (Grades 10-12, 2013)': 'home_management',
  'Home Economics Syllabus (Grades 5-7, 2013)': 'home_economics',
  'Home Economics & Hospitality Syllabus (Grades 4-6)': 'home_economics',
  'Literature in English Syllabus (Forms 1-4)': 'literature_in_english',
  'English Syllabus (Forms 1-4)': 'english',
  'English Language Syllabus (Grades 4-6)': 'english',
  'English Language Syllabus (Grades 2-7, 2013)': 'english',
  'Religious Education 2044 Syllabus (Grades 10-12, 2013)': 'religious_education_2044',
  'Religious Education 2046 Syllabus (Grades 10-12, 2013)': 'religious_education_2046',
  'Religious Education Syllabus (Forms 1-4)': 'religious_education',
})

function clean(value) {
  return String(value ?? '').trim()
}

// Records store grades every way a form has ever offered them: "G8", "F1",
// "Form 1", "Grade 10", "8". The catalogue is keyed on G-codes, so a grade is
// normalised before anything is looked up. An unrecognisable grade yields ''
// and the record is reported ambiguous rather than looked up under a guess.
const FORM_TO_GRADE = { 1: 'G8', 2: 'G9', 3: 'G10', 4: 'G11', 5: 'G12' }

export function resolveGradeCode(raw) {
  const s = clean(raw)
  if (!s) return ''
  const upper = s.toUpperCase().replace(/\s+/g, '')
  if (/^G\d{1,2}$/.test(upper)) return upper
  if (/^ECE(_[NR])?$/.test(upper)) return upper
  const form = upper.match(/^F(?:ORM)?(\d)$/)
  if (form) return FORM_TO_GRADE[form[1]] || ''
  const grade = s.match(/grade\s*(\d{1,2})/i)
  if (grade) return `G${Number(grade[1])}`
  if (/^\d{1,2}$/.test(upper)) return `G${Number(upper)}`
  return ''
}

/**
 * Normalise a topic label for comparison.
 *
 * Keyed on the parsed code plus the title rather than the raw string, because
 * the same topic is punctuated differently in different workbooks: Mathematics
 * has "4.5 GEOMETRICAL TRANSFORMATIONS" where Mathematics II has "4.5.
 * GEOMETRICAL TRANSFORMATIONS". Those are the same topic in two syllabi — so
 * they must collide here, be recognised as contested, and count as evidence for
 * neither. Comparing raw strings would treat them as distinct and let a shared
 * topic decide a subject.
 */
export function topicMatchKey(label) {
  const raw = clean(label)
  if (!raw) return ''
  const parsed = parseTopicCode(raw)
  const base = parsed ? `${parsed.code}|${parsed.title}` : raw
  return base.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Build the lookup the classifier reads: every catalogue topic, keyed by
 * curriculum + grade + topic label → the canonical subject that owns it.
 *
 * A label claimed by two candidate subjects in the same curriculum+grade is
 * dropped from the index entirely — it cannot be evidence for either.
 *
 * @param {Array<{grade:string, subject:string, topic:string}>} topics
 * @param {string} curriculumId  the curriculum these topics came from
 * @param {Map} [into]  an existing index to add to (so both catalogues share one)
 */
export function buildTopicSubjectIndex(topics, curriculumId, into = new Map()) {
  const curriculum = normalizeCurriculumId(curriculumId)
  const contested = new Set()
  for (const t of topics || []) {
    const grade = clean(t?.grade).toUpperCase()
    const subject = clean(t?.subject).toLowerCase()
    const topic = topicMatchKey(t?.topic)
    if (!grade || !subject || !topic) continue
    const key = `${curriculum}|${grade}|${topic}`
    const existing = into.get(key)
    if (existing && existing !== subject) {
      contested.add(key)
      continue
    }
    if (!contested.has(key)) into.set(key, subject)
  }
  for (const key of contested) into.delete(key)
  return into
}

/**
 * Which subjects actually have catalogue rows at a given curriculum + grade.
 *
 * Used to narrow the candidate list before anything is decided. A Grade 6 Home
 * Economics record cannot be Food & Nutrition or Home Management, because
 * neither subject exists below senior secondary — so it is simply correct as it
 * stands, not ambiguous. Without this, every legitimate primary Home Economics
 * record would be dumped into the review pile and the real cases would be lost
 * in the noise.
 *
 * Presence NARROWS; it never classifies. "The only candidate at this grade is X"
 * is enough to confirm a record already on X, but not enough to move a record
 * onto X — for that we still require the record's own topics to say so.
 */
export function buildSubjectPresence(topics, curriculumId, into = new Set()) {
  const curriculum = normalizeCurriculumId(curriculumId)
  for (const t of topics || []) {
    const grade = clean(t?.grade).toUpperCase()
    const subject = clean(t?.subject).toLowerCase()
    if (grade && subject) into.add(`${curriculum}|${grade}|${subject}`)
  }
  return into
}

/** Collect the topic-ish strings a record carries, from any of the usual shapes. */
export function recordTopics(record) {
  const out = []
  const push = (value) => {
    if (typeof value === 'string' && clean(value)) out.push(clean(value))
  }
  const walk = (value, depth) => {
    if (depth > 3 || value == null) return
    if (typeof value === 'string') return push(value)
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1)
      return
    }
    if (typeof value === 'object') {
      // Only the fields that genuinely name a topic — never a free-text body.
      for (const field of ['topic', 'topics', 'topicName', 'subtopic', 'subTopic', 'name']) {
        if (field in value) walk(value[field], depth + 1)
      }
    }
  }
  walk(record?.topic, 0)
  walk(record?.topics, 0)
  walk(record?.inputs?.topic, 0)
  walk(record?.inputs?.topics, 0)
  walk(record?.meta?.topic, 0)
  return Array.from(new Set(out))
}

/**
 * Classify ONE record.
 *
 * @param {object} record        the stored record (any of the shapes above)
 * @param {object} context
 * @param {Map} context.topicIndex   from buildTopicSubjectIndex
 * @param {string} record.subject    the stored subject key
 * @param {string} record.grade      grade/form code (G8, F1, "Grade 10", …)
 * @param {string} record.curriculum '2023' | '2013' | 'cbc' | 'previous'
 * @returns {{outcome:string, subject:string, from:string, evidence:string,
 *            candidates:string[], topicsSeen:number, topicsResolved:number}}
 */
export function classifyRecord(record, {
  topicIndex = new Map(), subjectPresence = null, gradeResolver = null,
} = {}) {
  const from = clean(record?.subject).toLowerCase()
  const candidates = SPLIT_SOURCES[from]
  const base = {
    outcome: OUTCOMES.NOT_APPLICABLE,
    subject: from,
    from,
    evidence: '',
    candidates: candidates || [],
    topicsSeen: 0,
    topicsResolved: 0,
  }
  if (!candidates) return { ...base, evidence: 'not a pre-split subject key' }

  // ── Evidence 1: an explicit source-syllabus field ────────────────────────
  const sourceDoc = clean(record?.sourceSyllabus || record?.syllabusDocument || record?.inputs?.sourceSyllabus)
  if (sourceDoc && Object.prototype.hasOwnProperty.call(SOURCE_DOCUMENT_SUBJECTS, sourceDoc)) {
    const implied = SOURCE_DOCUMENT_SUBJECTS[sourceDoc]
    if (implied && candidates.includes(implied)) {
      return {
        ...base,
        outcome: implied === from ? OUTCOMES.UNCHANGED : OUTCOMES.CLASSIFIED,
        subject: implied,
        evidence: `source syllabus "${sourceDoc}"`,
      }
    }
    // The Commerce & PoA document names both subjects — no answer from here.
  }

  // ── Evidence 2: the record's topics, against the real catalogue ──────────
  const curriculum = normalizeCurriculumId(record?.curriculum ?? record?.framework ?? record?.inputs?.framework)
  const rawGrade = clean(record?.grade || record?.inputs?.grade || record?.meta?.grade)
  const grade = (gradeResolver ? gradeResolver(rawGrade) : rawGrade).toUpperCase()
  const topics = recordTopics(record)

  // Narrow to the candidates that exist at all at this curriculum + grade.
  const narrowed = subjectPresence && grade
    ? candidates.filter((c) => subjectPresence.has(`${curriculum}|${grade}|${c}`))
    : candidates

  // Narrowing to NOTHING is the one result that must not be read as an answer.
  // It means this curriculum+grade has no digitised rows for any candidate — a
  // missing catalogue, not evidence that the record is stranded. The 2013 set
  // is only digitised in parts, so reading absence as evidence would report
  // every OBC junior-secondary Religious Education record as needing a human,
  // and bury the senior records that genuinely do. Fall back to the unnarrowed
  // list and let the incumbent's own validity decide: a live key stays, a
  // retired combined key (which is never among its own candidates) still goes
  // to the review pile.
  const possible = narrowed.length ? narrowed : candidates

  // Already correct: no other candidate subject is even taught here.
  if (possible.length === 1 && possible[0] === from) {
    return {
      ...base,
      outcome: OUTCOMES.UNCHANGED,
      subject: from,
      candidates: possible,
      evidence: `${from} is the only candidate subject with ${curriculum} rows at ${grade}`,
    }
  }

  const resolved = new Set()
  let matched = 0
  if (grade) {
    for (const topic of topics) {
      const owner = topicIndex.get(`${curriculum}|${grade}|${topicMatchKey(topic)}`)
      if (owner && possible.includes(owner)) {
        resolved.add(owner)
        matched += 1
      }
    }
  }

  const withCounts = {
    ...base, candidates: possible, topicsSeen: topics.length, topicsResolved: matched,
  }

  if (resolved.size === 1) {
    const subject = Array.from(resolved)[0]
    return {
      ...withCounts,
      outcome: subject === from ? OUTCOMES.UNCHANGED : OUTCOMES.CLASSIFIED,
      subject,
      evidence: `${matched} of ${topics.length} topic(s) matched ${subject} in the ${curriculum} catalogue at ${grade}`,
    }
  }

  if (resolved.size > 1) {
    return {
      ...withCounts,
      outcome: OUTCOMES.AMBIGUOUS,
      evidence: `topics span ${Array.from(resolved).sort().join(' and ')} — a human must split or pick`,
    }
  }

  // No evidence for any candidate. What that MEANS depends on whether the key
  // the record already carries is still a real subject here.
  //
  //   • Still valid (a `mathematics` paper at Form 1, a Grade 6 Home Economics
  //     record) → it is already filed correctly. Leaving it is not a guess; it
  //     is the absence of any reason to move it.
  //   • Retired (the combined Commerce key, senior `home_economics`) → the
  //     record is stranded on a key nothing owns and a human must pick.
  const incumbentStillValid = possible.includes(from)
  const why = !grade
    ? 'no grade on the record, so its topics cannot be looked up'
    : topics.length === 0
      ? 'no topics on the record'
      : `none of its ${topics.length} topic(s) match the ${curriculum} catalogue at ${grade}`

  if (incumbentStillValid) {
    return {
      ...withCounts,
      outcome: OUTCOMES.UNCHANGED,
      subject: from,
      evidence: `${why} — nothing indicates another subject, and ${from} is still valid at ${grade || 'this level'}`,
    }
  }

  return { ...withCounts, outcome: OUTCOMES.AMBIGUOUS, evidence: why }
}

/** True when the split documents/keys this classifier knows are still current. */
export function knownSplitKeys() {
  const fromDocs = Object.values(SPLIT_DOCUMENTS).map((s) => s.legacyKey)
  return Array.from(new Set([...fromDocs, ...Object.keys(SPLIT_SOURCES)]))
}
