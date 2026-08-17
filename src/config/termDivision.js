/**
 * termDivision — share a subject's syllabus across Term 1, Term 2 and Term 3.
 *
 * WHY THIS FILE EXISTS. `gradeTermPlan.js` carries the owner's own term
 * allocation, and it covers two subjects at one grade. Every other
 * subject/grade fell through to "no term data", which showed the learner the
 * same full syllabus on all three tabs and made the switcher read as broken.
 *
 * WHAT THIS DOES, AND WHAT IT DOES NOT. It divides the catalogue that is
 * already in the repo — it never writes a topic, renames one, or moves one out
 * of syllabus order. Terms are three CONSECUTIVE slices of the published
 * order, so Term 2 continues where Term 1 stopped and nothing is repeated or
 * skipped. That is pacing, which is what a scheme of work is; it is not a
 * claim about the syllabus, which is why the screen labels a derived plan as
 * suggested and an authored plan (gradeTermPlan) always wins over it.
 *
 * THE UNIT OF DIVISION IS THE SUB-TOPIC, not the topic. "Unit 1: Fractions"
 * is not one week's work — it is Operations, Addition, Subtraction,
 * Multiplication and Division, and a topic listing five of those is five times
 * the teaching of a topic listing one. Cutting at the sub-topic is how a wide
 * topic takes a proportionally wider share of the year without anyone having
 * to score topics by hand: each sub-topic counts once, so the share follows
 * the breadth the catalogue already records. A topic with no sub-topics
 * listed stands as one unit itself.
 *
 * Consequence worth stating plainly: a topic wider than a term's share is
 * SPLIT across a term boundary rather than distorting the year around it —
 * Grade 7 Number Bases is 21 sub-topics of Mathematics' 75. The split prefers
 * a topic boundary when one is close by (see `snapToTopicBoundary`), so a
 * topic is only ever cut when keeping it whole would leave the terms lopsided.
 *
 * Pure: no DOM, no React, no Firebase, and no import of the curriculum itself
 * — the catalogue is passed in, so this module can be tested on fixtures and
 * cannot drift into being a second source of curriculum truth.
 */

export const TERMS = [1, 2, 3]

/**
 * A term's slice may drift this far from an equal share to land on a topic
 * boundary instead of cutting a topic in half. A quarter of a term: enough to
 * keep "Unit 3: Percentages" (5 sub-topics) whole, not enough to let one
 * oversized topic swallow a neighbouring term.
 */
const BOUNDARY_SNAP_TOLERANCE = 0.25

/** The four tag tones, reused across subjects — see STRAND_TONES. */
const TONES = ['speak', 'read', 'write', 'struct']

/**
 * Flatten a subject's catalogue into the ordered list this module divides.
 *
 * Each unit is one row on the learner's screen: `{ title, parent, parentIndex }`.
 * `parent` is null when the unit IS a topic (nothing to be a child of), which
 * is what the caller keys the strand tag off — a row with no parent shows no
 * tag rather than a tag naming itself.
 *
 * @param {string[]} topics ordered topic names for the subject+grade
 * @param {(topic: string) => string[]} subtopicsOf sub-topics of one topic
 */
export function buildTermUnits(topics, subtopicsOf) {
  const list = Array.isArray(topics) ? topics : []
  const read = typeof subtopicsOf === 'function' ? subtopicsOf : () => []
  const units = []
  list.forEach((topic, parentIndex) => {
    const name = String(topic || '').trim()
    if (!name) return
    const subs = (read(name) || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
    if (subs.length === 0) {
      units.push({ title: name, parent: null, parentIndex })
      return
    }
    for (const sub of subs) units.push({ title: sub, parent: name, parentIndex })
  })
  return units
}

/**
 * Index of every point where one topic ends and the next begins, plus the two
 * ends of the list. A cut placed here keeps every topic whole.
 */
function topicBoundaries(units) {
  const out = [0]
  for (let i = 1; i < units.length; i += 1) {
    if (units[i].parentIndex !== units[i - 1].parentIndex) out.push(i)
  }
  out.push(units.length)
  return out
}

/**
 * Move a cut to the nearest topic boundary, but only while every term stays
 * within `BOUNDARY_SNAP_TOLERANCE` of an equal share. Returns `ideal`
 * unchanged when no boundary is close enough — a tidy-looking split that
 * empties a term is worse than a topic cut in two.
 */
function snapToTopicBoundary(ideal, boundaries, share) {
  const drift = Math.max(1, Math.round(share * BOUNDARY_SNAP_TOLERANCE))
  let best = ideal
  let bestDistance = Infinity
  for (const b of boundaries) {
    const distance = Math.abs(b - ideal)
    if (distance > drift) continue
    // Ties (a boundary equally far either side) resolve to the earlier cut, so
    // the split is a function of the list alone and never of iteration order.
    if (distance < bestDistance) {
      best = b
      bestDistance = distance
    }
  }
  return best
}

/**
 * Divide the units into three consecutive, non-empty, balanced slices.
 *
 * Returns `null` when there are fewer units than terms: a term tab with
 * nothing on it tells the learner their subject is empty, which is a worse
 * answer than the full list on every tab.
 *
 * @param {Array} units from `buildTermUnits`
 * @returns {{1: Array, 2: Array, 3: Array} | null}
 */
export function divideUnits(units) {
  const list = Array.isArray(units) ? units : []
  if (list.length < TERMS.length) return null

  const share = list.length / TERMS.length
  const boundaries = topicBoundaries(list)

  let first = snapToTopicBoundary(Math.round(share), boundaries, share)
  let second = snapToTopicBoundary(Math.round(share * 2), boundaries, share)

  // Snapping moves the two cuts independently, so clamp afterwards: every
  // term keeps at least one unit however the boundaries happened to fall.
  first = Math.min(Math.max(first, 1), list.length - 2)
  second = Math.min(Math.max(second, first + 1), list.length - 1)

  return { 1: list.slice(0, first), 2: list.slice(first, second), 3: list.slice(second) }
}

/**
 * The tag text for a unit's parent topic.
 *
 * Strips the catalogue's own numbering ("Unit 1: Fractions" → "Fractions",
 * "7.1 The Human Body" → "The Human Body"): the tag sits beside a row that is
 * already in syllabus order, so the number is width spent saying nothing. The
 * topic list itself is untouched — this is a display name, and only for the
 * pill.
 */
export function topicTagLabel(topic) {
  return String(topic || '')
    .replace(/^\s*(unit|topic|chapter)\s*\d+\s*[:.\-–]\s*/i, '')
    .replace(/^\s*\d+(\.\d+)*\s*[:.\-–]?\s+/, '')
    .trim() || String(topic || '').trim()
}

/**
 * A term plan derived from the catalogue, in the same row shape as an authored
 * one (`gradeTermPlan`) so the screen renders both through one path.
 *
 * Rows carry no icon: the caller falls back to the subject's own icon, which
 * is honest. Inventing an emoji per sub-topic would be decoration presented as
 * curriculum, and 75 of them for Grade 7 Mathematics alone.
 *
 * @returns {Array<{term, title, strand, tone}>|null} null when the catalogue
 *   is too small to divide — the caller then shows the full list, as before.
 */
export function deriveTermPlan(topics, subtopicsOf) {
  const byTerm = divideUnits(buildTermUnits(topics, subtopicsOf))
  if (!byTerm) return null
  const rows = []
  for (const term of TERMS) {
    for (const unit of byTerm[term]) {
      rows.push({
        term,
        title: unit.title,
        strand: unit.parent ? topicTagLabel(unit.parent) : null,
        tone: TONES[unit.parentIndex % TONES.length],
      })
    }
  }
  return rows
}
