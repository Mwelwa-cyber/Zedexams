/**
 * One syllabus document, two canonical subjects.
 *
 * THE PROBLEM
 *
 * Topic codes are only unique within one curriculum + grade + subject. That is
 * how the Ministry numbers them and it is correct: Commerce topic "1.1" and
 * Principles of Accounts topic "1.1" are two different topics that legitimately
 * share a code. The bug was ours — we filed both under ONE canonical subject
 * key, so the two independently-numbered syllabi collided:
 *
 *     G8|commerce_and_principles_of_accounts
 *        1.1 Commerce                 ← Commerce, topic 1.1
 *        1.1 Principles of Accounts   ← Principles of Accounts, topic 1.1
 *
 * That produced 82 phantom "duplicate code" findings in the validation report
 * and, worse, made hierarchy repair ambiguous: a sub-topic "1.1.3" has two
 * candidate parents and would fold under whichever appeared first.
 *
 * THE SPLIT SIGNAL
 *
 * The 2023 CDC workbook ships Commerce and Principles of Accounts as one
 * document with the two syllabi laid end to end, each numbered from scratch.
 * So the boundary is in the data, not in the prose: the topic codes ascend
 * monotonically through the first subject and then RESET.
 *
 *     Form 1:  1.1 1.2 1.3 1.4 1.5 │ 1.1 1.2 1.3 1.4 1.5
 *     Form 2:  2.1 … 2.6           │ 2.1 … 2.5
 *     Form 3:  3.1 … 3.4           │ 3.1 … 3.5
 *     Form 4:  4.1 … 4.4           │ 4.1 … 4.5
 *
 * Keying off the reset means we never guess a subject from topic text — the
 * numbering is authoritative and machine-checkable. Form 1 corroborates it for
 * free: its two section-opening topics are literally titled "Commerce" and
 * "Principles of Accounts".
 *
 * WHEN IT DOESN'T HOLD
 *
 * If a sheet does not split into exactly the expected number of sections, this
 * returns `ambiguous` and NO topic is reassigned — the document keeps its old
 * combined key and the validation report names the sheet. A wrong split would
 * silently move curriculum content between subjects, which is worse than a
 * known-stale key.
 *
 * Documents that are already one-subject-per-file (2013 Food & Nutrition vs
 * Home Management) need none of this — they are fixed by giving each document
 * its own canonical key in the mapping tables.
 *
 * Pure (no React, no Firebase, no I/O) and mirrored server-side in
 * functions/teacherTools/syllabusSubjectSplit.js — keep the two in lock-step
 * (guarded by scripts/test-syllabus-subject-split.mjs).
 */

import { parseTopicCode } from './syllabusTopicTree.js'

/**
 * Syllabus documents that carry more than one canonical subject, in the order
 * the sections appear in the document.
 *
 * `legacyKey` is the single key these topics used to be filed under. It is kept
 * so the migration can recognise an old record, and so an ambiguous sheet can
 * fall back to exactly the behaviour that shipped before.
 */
export const SPLIT_DOCUMENTS = {
  'Commerce & Principles of Accounts Syllabus (Forms 1-4)': {
    sections: ['commerce', 'principles_of_accounts'],
    // What the teacher picks in a subject dropdown. The studio's subject values
    // are syllabus DOCUMENT titles, so a split document has to offer one entry
    // per subject — otherwise picking it means "one of these two" and the
    // assignment can't be saved. Same order as `sections`.
    sectionLabels: ['Commerce', 'Principles of Accounts'],
    legacyKey: 'commerce_and_principles_of_accounts',
  },
}

/** The canonical subject a document's section LABEL stands for, or ''. */
export function sectionSubjectForLabel(studioSubject, label) {
  const spec = SPLIT_DOCUMENTS[studioSubject]
  if (!spec) return ''
  const index = spec.sectionLabels.findIndex(
    (l) => l.toLowerCase() === String(label ?? '').trim().toLowerCase(),
  )
  return index === -1 ? '' : spec.sections[index]
}

/** Numeric tuple comparison: [1,10] sorts after [1,9], not before. */
function compareSegments(a, b) {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const left = a[i] ?? -1
    const right = b[i] ?? -1
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/**
 * Cut an ordered list of topic labels into sections at each point where the
 * numbering restarts.
 *
 * A label with no parseable code continues the section it appears in — that is
 * ordering continuity, not an inference about its subject. A code that merely
 * repeats the previous code exactly (a duplicated row) does NOT open a section;
 * only a strict decrease does, so a repeated heading can't manufacture a split.
 *
 * @param {string[]} topicLabels  distinct topic labels in document order
 * @returns {{sections: string[][], boundaries: number[]}}
 */
export function sectionsByCodeReset(topicLabels) {
  const labels = (topicLabels || []).map((t) => String(t ?? '').trim()).filter(Boolean)
  const sections = []
  const boundaries = []
  let current = []
  let highWater = null

  labels.forEach((label, index) => {
    const parsed = parseTopicCode(label)
    if (parsed && highWater && compareSegments(parsed.segments, highWater) < 0) {
      sections.push(current)
      boundaries.push(index)
      current = []
      highWater = null
    }
    current.push(label)
    if (parsed && (!highWater || compareSegments(parsed.segments, highWater) > 0)) {
      highWater = parsed.segments
    }
  })
  if (current.length) sections.push(current)
  return { sections, boundaries }
}

/**
 * Resolve the per-topic canonical subject for one sheet of a split document.
 *
 * @param {string} studioSubject  the document title
 * @param {string[]} topicLabels  distinct topic labels in document order
 * @returns {{byTopic: Map<string,string>, ambiguous: boolean, reason: string,
 *            sectionCount: number, expected: number}|null}
 *   null when the document is not a split document at all.
 */
export function resolveSplitSubjects(studioSubject, topicLabels) {
  const spec = SPLIT_DOCUMENTS[studioSubject]
  if (!spec) return null

  const { sections } = sectionsByCodeReset(topicLabels)
  const expected = spec.sections.length
  const base = {
    byTopic: new Map(), sectionCount: sections.length, expected, ambiguous: false, reason: '',
  }

  if (sections.length !== expected) {
    return {
      ...base,
      ambiguous: true,
      reason: `expected ${expected} numbered sections, found ${sections.length}`,
    }
  }

  const byTopic = new Map()
  const conflicting = []
  sections.forEach((labels, index) => {
    const subject = spec.sections[index]
    for (const label of labels) {
      // The same heading appearing in two sections would make its subject
      // genuinely undecidable. Record it rather than letting the last write win.
      if (byTopic.has(label) && byTopic.get(label) !== subject) conflicting.push(label)
      else byTopic.set(label, subject)
    }
  })

  if (conflicting.length) {
    return {
      ...base,
      ambiguous: true,
      reason: `topic appears in both sections: ${conflicting.join(', ')}`,
    }
  }
  return { ...base, byTopic }
}

/** Every canonical key a split document can produce, plus its legacy key. */
export function splitSubjectKeys() {
  const keys = new Set()
  for (const spec of Object.values(SPLIT_DOCUMENTS)) {
    for (const s of spec.sections) keys.add(s)
    keys.add(spec.legacyKey)
  }
  return keys
}

/** The legacy combined keys the migration has to recognise and retire. */
export const LEGACY_COMBINED_KEYS = Object.freeze(
  Object.values(SPLIT_DOCUMENTS).map((s) => s.legacyKey),
)
