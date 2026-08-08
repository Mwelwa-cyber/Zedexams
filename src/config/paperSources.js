/**
 * Where a past paper CAME FROM — one declaration, as data.
 *
 * The archive holds more than one paper for the same grade + year + subject:
 * Grade 7, 2025, Integrated Science has an official ECZ paper AND a PRISCA
 * mock. Until now the only thing telling them apart was a hand-typed `title`,
 * which meant:
 *
 *   - the distinction was inconsistent (one live title begins with the word
 *     "In"), so it could not be queried, sorted or filtered on;
 *   - the card list truncated it ("Grade 7 Integrated Sci…"), so the fact a
 *     learner most needs — is this the real exam or a practice mock? — was the
 *     first thing an ellipsis threw away;
 *   - nothing stopped the same paper being uploaded twice, because two free-text
 *     titles are never equal by accident.
 *
 * So identity moves out of prose and into structured fields, and this module is
 * the single source of truth for the vocabulary. It follows
 * `src/config/educationLevels.js`: pure data plus resolvers, no React, no
 * Firebase, importable by the plain-node suite, the migration script and the UI
 * alike. Do NOT declare a second registry and do NOT hard-code a source string
 * anywhere else — a source that exists in two places is a source that will
 * disagree with itself.
 *
 * `isOfficial` is the load-bearing field. It is DERIVED from the source id and
 * written onto the paper document so "official only" is one equality query
 * rather than an OR across an ever-growing list of mock publishers.
 */

/**
 * The sources a paper can have.
 *
 *   id          what the document stores and every query filters on
 *   label       the badge text — it carries the meaning ON ITS OWN, because
 *               colour alone must never be the distinction (Night mode, mono
 *               printing, colour-blind readers)
 *   fullName    the unabbreviated publisher, for the viewer header + exports
 *   isOfficial  whether this is a real ECZ examination
 *   descriptor  the secondary line a learner reads under the badge
 */
export const PAPER_SOURCES = {
  ecz: {
    id: 'ecz',
    label: 'ECZ',
    fullName: 'Examinations Council of Zambia',
    isOfficial: true,
    descriptor: 'Official exam',
  },
  prisca: {
    id: 'prisca',
    label: 'PRISCA mock',
    fullName: 'PRISCA',
    isOfficial: false,
    descriptor: 'Practice mock · not an ECZ exam',
  },
  school_mock: {
    id: 'school_mock',
    label: 'School mock',
    fullName: 'School mock paper',
    isOfficial: false,
    descriptor: 'Practice mock · not an ECZ exam',
  },
  other: {
    id: 'other',
    label: 'Practice paper',
    fullName: 'Other publisher',
    isOfficial: false,
    descriptor: 'Practice paper · not an ECZ exam',
  },
}

/**
 * The paper numbers a paper can carry, and the words they print as.
 *
 * Keys are deliberately mixed number-ish and word-ish: `1` and `2` are the
 * printed paper numbers of a two-paper subject, while `'special'` and `'mock'`
 * name a paper that has no number at all. Both live in one registry because
 * both answer the same question — "which of this subject's papers is this?" —
 * and the display layer must not have to know which kind it is holding.
 */
export const PAPER_NUMBERS = {
  1: 'Paper 1',
  2: 'Paper 2',
  special: 'Special paper',
  mock: 'Mock paper',
}

/**
 * Paper numbers already stored in the archive that the picker no longer
 * OFFERS but that must keep reading back correctly. ECZ has never printed a
 * Paper 5, but the old free-number input accepted 1–5 and a stored 3 is a fact
 * about the archive, not a value to silently discard.
 */
export const LEGACY_PAPER_NUMBERS = [3, 4, 5]

/**
 * How the source on a paper came to be there.
 *
 *   explicit  a human chose it (the admin wizard, or the labelling queue)
 *   inferred  the migration matched a pattern against the old free text
 *   unknown   nothing matched — the source is NOT guessed, and the paper is
 *             withheld from learners until a human labels it
 */
export const SOURCE_CONFIDENCE = {
  EXPLICIT: 'explicit',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
}

/** The confidences a learner-visible paper may carry. */
export const LEARNER_VISIBLE_CONFIDENCE = [
  SOURCE_CONFIDENCE.EXPLICIT,
  SOURCE_CONFIDENCE.INFERRED,
]

/** The schema version stamped on any paper carrying these fields. */
export const PAPER_META_VERSION = 1

// ── Resolvers ─────────────────────────────────────────────────────────────

/** The source record for an id, or null. Never throws, never guesses. */
export function getPaperSource(id) {
  if (typeof id !== 'string') return null
  return PAPER_SOURCES[id.trim().toLowerCase()] || null
}

/**
 * True only for a source that IS an official ECZ examination.
 *
 * Fail-closed on purpose: an unknown, missing or unrecognised source is not
 * official. Calling a mock an official exam is the one error this whole
 * feature exists to prevent, so absence of evidence is never a pass.
 */
export function isOfficialSource(id) {
  return getPaperSource(id)?.isOfficial === true
}

/**
 * Every source, in the order a picker should offer them: official first, then
 * the mocks in declaration order. A frozen array copy per call so a caller
 * sorting the list in place cannot reorder the registry for everyone else.
 */
export function listPaperSources() {
  const all = Object.values(PAPER_SOURCES)
  return [...all.filter((s) => s.isOfficial), ...all.filter((s) => !s.isOfficial)]
}

// Every spelling that resolves onto a source id. Built from the registry so a
// new source is matchable the moment it is declared.
const SOURCE_ALIASES = (() => {
  const map = new Map()
  const add = (key, id) => {
    const k = String(key ?? '').trim().toLowerCase()
    if (k) map.set(k, id)
  }
  for (const s of Object.values(PAPER_SOURCES)) {
    add(s.id, s.id)
    add(s.id.replace(/_/g, '-'), s.id)
    add(s.id.replace(/_/g, ' '), s.id)
    add(s.label, s.id)
    add(s.fullName, s.id)
  }
  // Spellings the registry's own strings don't produce but humans write.
  add('examinations council of zambia', 'ecz')
  add('examination council of zambia', 'ecz')
  add('exam council of zambia', 'ecz')
  add('schoolmock', 'school_mock')
  add('school', 'school_mock')
  return map
})()

/**
 * Resolve any written spelling onto a source id, or null when it resolves to
 * nothing. Null is a real answer — "this paper's source is not known" — and
 * callers must keep it distinguishable from `'other'`, which is a human
 * saying "some publisher, not ECZ".
 */
export function normalizeSourceId(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim().toLowerCase()
  if (!raw) return null
  return SOURCE_ALIASES.get(raw) || null
}

/** The badge text for a source id; null when there is no source to badge. */
export function paperSourceLabel(id) {
  return getPaperSource(id)?.label ?? null
}

/** The secondary line under the badge; null when there is no source. */
export function paperSourceDescriptor(id) {
  return getPaperSource(id)?.descriptor ?? null
}

/**
 * Canonical paper number: 1 | 2 | 'special' | 'mock' | a legacy int | null.
 *
 * Numbers come back as numbers and words as lowercase words, so a caller can
 * compare against the `PAPER_NUMBERS` keys without knowing which kind it has.
 */
export function normalizePaperNumberToken(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase()
    if (!raw) return null
    if (raw === 'special' || raw === 'mock') return raw
    // "Paper 1" / "p1" / "1" all mean the same printed number.
    const digits = raw.match(/(\d+)/)
    if (digits) return normalizePaperNumberToken(Number(digits[1]))
    return null
  }
  const n = Number(value)
  if (!Number.isInteger(n)) return null
  if (n === 1 || n === 2) return n
  return LEGACY_PAPER_NUMBERS.includes(n) ? n : null
}

/** The words a paper number prints as, or null when the paper has none. */
export function paperNumberLabel(value) {
  const token = normalizePaperNumberToken(value)
  if (token == null) return null
  return PAPER_NUMBERS[token] || `Paper ${token}`
}

/** The paper-number options a picker offers, in declaration order. */
export function listPaperNumbers() {
  return Object.entries(PAPER_NUMBERS).map(([key, label]) => ({
    value: /^\d+$/.test(key) ? Number(key) : key,
    label,
  }))
}

/** Canonical confidence token; anything unrecognised reads as 'unknown'. */
export function normalizeSourceConfidence(value) {
  if (typeof value !== 'string') return SOURCE_CONFIDENCE.UNKNOWN
  const raw = value.trim().toLowerCase()
  return Object.values(SOURCE_CONFIDENCE).includes(raw) ? raw : SOURCE_CONFIDENCE.UNKNOWN
}

/**
 * May a learner be shown this paper?
 *
 * Two things must BOTH hold: the paper names a source we recognise, and that
 * source was established rather than left unknown. Fail-closed — a paper whose
 * provenance we cannot state is not shown, because showing it is exactly the
 * "is this the real exam?" question we would be answering with a shrug.
 *
 * This is the client-side half of the rule. The Firestore rules enforce the
 * same thing, and the published-list index is built with the same filter, so
 * this function is a UX courtesy rather than the guarantee.
 */
export function paperSourceIsLearnerVisible(paper) {
  if (!paper || typeof paper !== 'object') return false
  if (!getPaperSource(paper.source)) return false
  return LEARNER_VISIBLE_CONFIDENCE.includes(normalizeSourceConfidence(paper.sourceConfidence))
}

/**
 * Sort comparator for the papers inside one subject: official first, then by
 * paper number, then the mocks. Numbered papers sort ahead of word-numbered
 * ones ('special'/'mock' have no position in a numbered sequence), and a paper
 * with no number at all sorts last within its group.
 */
export function comparePapersBySource(a, b) {
  const officialA = isOfficialSource(a?.source) ? 0 : 1
  const officialB = isOfficialSource(b?.source) ? 0 : 1
  if (officialA !== officialB) return officialA - officialB
  const rankA = paperNumberRank(a?.paperNumber)
  const rankB = paperNumberRank(b?.paperNumber)
  if (rankA !== rankB) return rankA - rankB
  // Same source class and same number slot: fall back to the source id so the
  // order is deterministic rather than dependent on read order.
  return String(a?.source ?? '').localeCompare(String(b?.source ?? ''))
}

function paperNumberRank(value) {
  const token = normalizePaperNumberToken(value)
  if (token == null) return 900
  if (typeof token === 'number') return token
  // 'special' then 'mock', both after every numbered paper.
  return token === 'special' ? 800 : 850
}
