/**
 * learnerDuplicates — deciding whether two rows on a class list are the same
 * child.
 *
 * Pure module (no React / Firebase / DOM) so the node suite imports it
 * directly. Used by the capture/import review screen, the "possible
 * duplicates" filter on the Class List, and the register validation pass.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE (§8): two learners are never merged
 * automatically because their names look alike. Zambian classes routinely
 * contain real namesakes — two unrelated Chanda Mulengas in one Grade 4 is
 * ordinary, not a data error — and a merge destroys a child's attendance
 * history. So this module RANKS evidence and hands the decision to a teacher.
 * The only relationship it will assert on its own is an exact match on the
 * school's own admission number, which is the one identifier a school
 * guarantees to be unique.
 *
 * Confidence tiers, strongest first:
 *
 *   same_admission_number — the school says these are one learner. Linkable
 *                           without asking (`canLinkWithoutAsking`).
 *   very_likely           — identical names plus a second agreeing fact
 *                           (date of birth or parent phone), and nothing
 *                           contradicting.
 *   likely                — identical normalised names, nothing else known.
 *   possible              — the names are one edit / an initial / a reordering
 *                           apart, or they share a parent phone.
 *
 * A CONTRADICTION demotes everything: two rows with different admission
 * numbers, different dates of birth, or different genders are reported as
 * `conflicting_identifiers` rather than as a duplicate, because the most
 * likely reading is that they really are two children.
 */

// ── name normalisation ───────────────────────────────────────────

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'master', 'mstr'])

/**
 * A name reduced to comparable form: accents folded, punctuation dropped,
 * case and inner whitespace flattened.
 *
 * Accent folding matters here because the same learner is written "Nakazwe"
 * on one page and "Nakazwé" on another depending on who held the pen, and an
 * unfolded comparison calls those two different children.
 */
export function normalizeLearnerName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/['’`]/g, '')
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** The comparable name split into tokens, with honorifics dropped. */
export function nameTokens(name) {
  return normalizeLearnerName(name)
    .split(' ')
    .filter((t) => t && !HONORIFICS.has(t))
}

/**
 * A key two rows share when they are written identically. Tokens are SORTED,
 * so "Mulenga Chanda" and "Chanda Mulenga" produce the same key — Zambian
 * class lists are written surname-first about as often as they are written
 * given-name-first, and frequently both ways within one register.
 */
export function learnerNameKey(name) {
  return nameTokens(name).slice().sort().join(' ')
}

// ── comparison primitives ────────────────────────────────────────

/** Levenshtein distance, capped: anything past `max` returns max + 1. */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (row[j] < best) best = row[j]
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length] > max ? max + 1 : prev[b.length]
}

/**
 * How well one token stands for another, 0 (not at all) to 1 (the same word).
 *
 *   1.0  the same token
 *   0.9  one typing slip apart. Only longer tokens qualify: a one-edit gap
 *        between three-letter names ("Ben"/"Bea") is more often two children.
 *   0.5  an INITIAL of it. "M." standing for "Mulenga" is the commonest way
 *        one child appears twice on a captured list — the top of a page writes
 *        the full name and the continuation writes an initial — but it is weak
 *        evidence and must be scored as such, because a single letter also
 *        matches Musonda, Mwansa, Mwila and every other M on the register.
 *        Scoring it as a full match made "Chanda M. Mulenga" look like
 *        "Chanda Musonda", and offered a teacher three duplicate pairs that
 *        were three different children.
 */
function tokenAffinity(a, b) {
  if (a === b) return 1
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.5 : 0
  const threshold = Math.min(a.length, b.length) >= 5 ? 1 : 0
  if (threshold > 0 && editDistance(a, b, threshold) <= threshold) return 0.9
  return 0
}

/**
 * How alike two names are, 0–1, ignoring word order.
 *
 * TWO PASSES, and the order matters. Exact tokens are claimed first, then the
 * weaker matches take what is left. A single greedy pass lets an initial claim
 * the token an exact match needed: comparing "Chanda Mulenga" with "Chanda M.
 * Mulenga", the token `mulenga` would reach `m` before it reached `mulenga`,
 * spend itself on the initial, and score the pair lower than two strangers.
 *
 * One-to-one throughout: each token of the shorter name claims at most one
 * token of the longer, or "Mary Mary" scores a perfect match on "Mary Banda".
 */
export function nameSimilarity(a, b) {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (!ta.length || !tb.length) return 0
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const claimed = new Array(longer.length).fill(false)
  const spent = new Array(shorter.length).fill(false)
  let score = 0

  // Pass 1 — exact tokens only.
  shorter.forEach((token, s) => {
    const i = longer.findIndex((other, j) => !claimed[j] && other === token)
    if (i >= 0) { claimed[i] = true; spent[s] = true; score += 1 }
  })

  // Pass 2 — the best remaining partial match for each unspent token.
  shorter.forEach((token, s) => {
    if (spent[s]) return
    let best = 0
    let bestIndex = -1
    longer.forEach((other, j) => {
      if (claimed[j]) return
      const affinity = tokenAffinity(token, other)
      if (affinity > best) { best = affinity; bestIndex = j }
    })
    if (bestIndex >= 0) { claimed[bestIndex] = true; score += best }
  })

  // Divided by the LONGER name, so "Chanda" against "Chanda Mulenga Banda"
  // scores 0.33 rather than a perfect 1 — one shared given name is weak
  // evidence, and scoring it as certainty is how namesakes get merged.
  return score / longer.length
}

const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '')

/**
 * Whether two Zambian phone numbers are the same line. Compared on the last
 * nine digits, so 0977123456, +260977123456 and 260977123456 agree without
 * having to know which prefix a teacher typed.
 */
export function samePhone(a, b) {
  const da = digitsOnly(a)
  const db = digitsOnly(b)
  if (da.length < 9 || db.length < 9) return false
  return da.slice(-9) === db.slice(-9)
}

function normAdmission(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  return s || null
}

// ── the comparison ───────────────────────────────────────────────

export const DUPLICATE_CONFIDENCE = ['same_admission_number', 'very_likely', 'likely', 'possible']

const CONFIDENCE_RANK = Object.fromEntries(DUPLICATE_CONFIDENCE.map((c, i) => [c, DUPLICATE_CONFIDENCE.length - i]))

/**
 * Compare two learner records.
 *
 * @returns {{
 *   duplicate: boolean,
 *   confidence: 'same_admission_number'|'very_likely'|'likely'|'possible'|null,
 *   canLinkWithoutAsking: boolean,
 *   conflicts: string[],
 *   agreements: string[],
 *   nameSimilarity: number,
 * }}
 *
 * `conflicts` is the honest half of the answer: it names every fact that says
 * these are two different children, and is populated even when the names match
 * exactly, so the review screen can show a teacher WHY it is only asking.
 */
export function compareLearners(a, b) {
  const conflicts = []
  const agreements = []

  const admA = normAdmission(a?.admissionNumber)
  const admB = normAdmission(b?.admissionNumber)
  if (admA && admB) {
    if (admA === admB) agreements.push('admission_number')
    else conflicts.push('admission_number')
  }

  const dobA = a?.dateOfBirth || null
  const dobB = b?.dateOfBirth || null
  if (dobA && dobB) {
    if (dobA === dobB) agreements.push('date_of_birth')
    else conflicts.push('date_of_birth')
  }

  const genderA = a?.gender || null
  const genderB = b?.gender || null
  if (genderA && genderB && genderA !== genderB) conflicts.push('gender')

  if (a?.parentPhone && b?.parentPhone) {
    if (samePhone(a.parentPhone, b.parentPhone)) agreements.push('parent_phone')
  }

  // A shared previous enrolment (same learnerId) is the platform's own record
  // that these are one learner progressing between years.
  if (a?.learnerId && b?.learnerId && a.learnerId === b.learnerId) {
    agreements.push('previous_enrolment')
  }

  const similarity = nameSimilarity(a?.fullName, b?.fullName)
  const sameName = learnerNameKey(a?.fullName) === learnerNameKey(b?.fullName)
    && learnerNameKey(a?.fullName) !== ''
  if (sameName) agreements.push('name')

  const base = {
    conflicts,
    agreements,
    nameSimilarity: Number(similarity.toFixed(4)),
  }

  // The school's identifier settles it — and is the ONLY thing that does so
  // without a teacher looking.
  if (agreements.includes('admission_number')) {
    return { ...base, duplicate: true, confidence: 'same_admission_number', canLinkWithoutAsking: true }
  }

  // Two different admission numbers, dates of birth or genders: these are two
  // children with similar names, which is the ordinary case this module must
  // not get wrong.
  if (conflicts.length > 0) {
    return { ...base, duplicate: false, confidence: null, canLinkWithoutAsking: false }
  }

  if (agreements.includes('previous_enrolment')) {
    return { ...base, duplicate: true, confidence: 'very_likely', canLinkWithoutAsking: false }
  }

  const corroborated = agreements.includes('date_of_birth') || agreements.includes('parent_phone')

  if (sameName) {
    return {
      ...base,
      duplicate: true,
      confidence: corroborated ? 'very_likely' : 'likely',
      canLinkWithoutAsking: false,
    }
  }

  // Near-identical names, or a shared parent phone with names that are at
  // least in the same family — both worth asking about, neither worth acting
  // on alone.
  if (similarity >= 0.6 || (agreements.includes('parent_phone') && similarity >= 0.34)) {
    return { ...base, duplicate: true, confidence: 'possible', canLinkWithoutAsking: false }
  }

  return { ...base, duplicate: false, confidence: null, canLinkWithoutAsking: false }
}

/**
 * Every duplicate pair within one list of learners.
 *
 * @param {Array} learners records carrying at least { id, fullName }
 * @returns {Array<{ a, b, aIndex, bIndex, confidence, ... }>} strongest first
 *
 * O(n²) in the worst case, which for a class list is 120 × 120 — a few
 * thousand comparisons, done once per import. A blocking index (first letter
 * of each token) skips the overwhelming majority of pairs; correctness does
 * not depend on it, only speed.
 */
export function findDuplicatePairs(learners) {
  const rows = Array.isArray(learners) ? learners : []
  const buckets = new Map()
  rows.forEach((learner, index) => {
    const keys = new Set(nameTokens(learner?.fullName).map((t) => t[0]))
    const adm = normAdmission(learner?.admissionNumber)
    if (adm) keys.add(`#${adm}`)
    const phone = digitsOnly(learner?.parentPhone).slice(-9)
    if (phone.length === 9) keys.add(`@${phone}`)
    if (keys.size === 0) keys.add('')
    for (const key of keys) {
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(index)
    }
  })

  const seen = new Set()
  const pairs = []
  for (const indices of buckets.values()) {
    for (let i = 0; i < indices.length; i += 1) {
      for (let j = i + 1; j < indices.length; j += 1) {
        const [aIndex, bIndex] = indices[i] < indices[j] ? [indices[i], indices[j]] : [indices[j], indices[i]]
        const pairKey = `${aIndex}:${bIndex}`
        if (seen.has(pairKey)) continue
        seen.add(pairKey)
        const result = compareLearners(rows[aIndex], rows[bIndex])
        if (!result.duplicate) continue
        pairs.push({ aIndex, bIndex, a: rows[aIndex], b: rows[bIndex], ...result })
      }
    }
  }

  return pairs.sort((x, y) => {
    const rank = (CONFIDENCE_RANK[y.confidence] || 0) - (CONFIDENCE_RANK[x.confidence] || 0)
    if (rank !== 0) return rank
    return y.nameSimilarity - x.nameSimilarity
  })
}

/**
 * The ids of learners involved in at least one duplicate pair — what the
 * Class List's "possible duplicates" filter shows.
 */
export function duplicateLearnerIds(learners) {
  const ids = new Set()
  for (const pair of findDuplicatePairs(learners)) {
    if (pair.a?.id != null) ids.add(pair.a.id)
    if (pair.b?.id != null) ids.add(pair.b.id)
  }
  return ids
}

/**
 * Merge two records into one, field by field.
 *
 * `keep` is the record whose identity survives (its id, its learnerId, its
 * attendance). Every field it is MISSING is taken from `drop`, and no field it
 * has is overwritten — so merging never silently replaces a value a teacher
 * typed with one an OCR pass read.
 *
 * Returns the merged record plus `filledFrom`, the list of fields that came
 * from the dropped record, so the confirmation can say exactly what a merge
 * will change before it happens.
 */
export function mergeLearners(keep, drop) {
  const merged = { ...keep }
  const filledFrom = []
  const fields = [
    'admissionNumber', 'gender', 'parentPhone', 'dateOfBirth', 'admissionDate',
    'previousSchool', 'learnerNumber', 'learnerId', 'linkedUid',
  ]
  for (const field of fields) {
    const mine = merged[field]
    const theirs = drop?.[field]
    const missing = mine == null || mine === ''
    if (missing && theirs != null && theirs !== '') {
      merged[field] = theirs
      filledFrom.push(field)
    }
  }
  // The merged record still needs a human eye if either side did, and a merge
  // is itself a reason to look once more.
  merged.needsReview = Boolean(keep?.needsReview || drop?.needsReview)
  const reasons = new Set([...(keep?.reviewReasons || []), ...(drop?.reviewReasons || [])])
  reasons.delete('possible_duplicate')
  merged.reviewReasons = [...reasons]
  if (!merged.reviewReasons.length) merged.needsReview = false
  return { merged, filledFrom }
}
