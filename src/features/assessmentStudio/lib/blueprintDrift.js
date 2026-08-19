/**
 * Compare a paper against the blueprint it was generated from.
 *
 * This is the §3.4 inversion. The studio's four analysis tools used to be
 * DISCOVERY: they looked at a finished paper and reported what they could not
 * find — "no cognitive levels tagged yet", "0/5 strands covered", "1 easy · 0
 * medium · 0 hard". A teacher could read that and still have no idea what the
 * paper was supposed to be, because nothing had ever said.
 *
 * With a blueprint there IS a stated intent, so the same tools become
 * VERIFICATION: they report DRIFT from what was planned. "Analysis: planned 4,
 * got 2" is actionable in a way that "2 analysis questions" never was.
 *
 * Falls back cleanly: a paper with no blueprint (hand-built, imported, or
 * generated before this existed) reports `hasBlueprint: false` and the callers
 * keep their existing discovery behaviour. Nothing here requires a blueprint to
 * be useful.
 *
 * Pure — no React, no Firebase.
 */

import { normalizeBloomLevel } from './assessmentBloom.js'

/** The blueprint's difficulty tiers, in ascending demand. */
export const DIFFICULTY_TIERS = ['recall', 'understanding', 'analysis', 'challenge']

const TIER_LABELS = {
  recall: 'Recall',
  understanding: 'Understanding',
  analysis: 'Analysis',
  challenge: 'Challenge',
}

/** Studio easy/medium/hard → blueprint tier, so a hand-tagged question compares. */
const STUDIO_DIFFICULTY_TO_TIER = {
  easy: 'recall',
  medium: 'understanding',
  hard: 'analysis',
}

/** The tier on a question, from either vocabulary; '' when untagged. */
export function questionTier(question) {
  const raw = String(question?.difficulty || '').trim().toLowerCase()
  if (!raw) return ''
  if (DIFFICULTY_TIERS.includes(raw)) return raw
  return STUDIO_DIFFICULTY_TO_TIER[raw] || ''
}

/** Every planned item, flattened out of the blueprint's sections. */
export function blueprintItems(blueprint) {
  const sections = Array.isArray(blueprint?.sections) ? blueprint.sections : []
  return sections.flatMap((s) => (Array.isArray(s.items) ? s.items : []))
}

/**
 * Count occurrences of `key(x)` across a list, skipping empty keys.
 *
 * A null-prototype accumulator, because the keys are teacher-authored topic
 * and skill labels and a plain `{}` mis-handles two of them: a topic literally
 * named `__proto__` was DROPPED from the count (the write sets the prototype
 * instead of a property, so the label vanished from the drift report), and one
 * named `constructor` came back as the string
 * "function Object() { [native code] }1" where the caller expects a number,
 * which then sorts and subtracts as garbage. `Object.create(null)` inherits
 * nothing, so every label is just a key. (CodeQL #85.)
 */
function tally(list, key) {
  const out = Object.create(null)
  for (const entry of list) {
    const k = key(entry)
    if (!k) continue
    out[k] = (out[k] || 0) + 1
  }
  return out
}

/**
 * Turn a planned-vs-actual tally into a drift list, worst gap first.
 * A key present in either side appears, so an UNPLANNED category shows up too —
 * a paper that grew an extra topic has drifted just as much as one that lost one.
 */
function driftRows(planned, actual, labels = {}) {
  const keys = [...new Set([...Object.keys(planned), ...Object.keys(actual)])]
  return keys
    .map((key) => {
      const want = planned[key] || 0
      const got = actual[key] || 0
      return {
        key,
        label: labels[key] || key,
        planned: want,
        actual: got,
        delta: got - want,
        // 'unplanned' reads differently from 'short' in the UI: one is content
        // that should not be there, the other content that is missing.
        status: got === want ? 'met' : (want === 0 ? 'unplanned' : (got < want ? 'short' : 'over')),
      }
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label))
}

/**
 * Compare a paper's questions against its blueprint.
 *
 * @param {object} args
 * @param {object|null} args.blueprint the blueprint saved with the paper
 * @param {Array} args.questions       the paper's questions, studio shape
 * @returns {{
 *   hasBlueprint: boolean,
 *   itemCount: {planned: number, actual: number, delta: number},
 *   marks: {planned: number, actual: number, delta: number, reconciles: boolean},
 *   topics: Array, bloom: Array, difficulty: Array, outcomes: object,
 *   figures: {planned: number, actual: number, missing: number},
 *   summary: string,
 *   onPlan: boolean,
 * }}
 */
export function compareToBlueprint({ blueprint = null, questions = [] } = {}) {
  const items = blueprintItems(blueprint)
  const actual = Array.isArray(questions) ? questions : []

  if (!blueprint || items.length === 0) {
    return {
      hasBlueprint: false,
      itemCount: { planned: 0, actual: actual.length, delta: actual.length },
      marks: { planned: 0, actual: sumMarks(actual), delta: 0, reconciles: true },
      topics: [], bloom: [], difficulty: [],
      outcomes: { planned: 0, covered: 0, missing: [] },
      figures: { planned: 0, actual: 0, missing: 0 },
      summary: '',
      onPlan: false,
    }
  }

  const plannedMarks = items.reduce((n, i) => n + (Number(i.marks) || 0), 0)
  const actualMarks = sumMarks(actual)

  const topics = driftRows(
    tally(items, (i) => String(i.topic || '').trim()),
    tally(actual, (q) => String(q?.topic || '').trim()),
  )
  const bloom = driftRows(
    tally(items, (i) => normalizeBloomLevel(i.bloomLevel)),
    tally(actual, (q) => normalizeBloomLevel(q?.bloom) || normalizeBloomLevel(q?.bloomLevel)),
  )
  const difficulty = driftRows(
    tally(items, (i) => questionTier(i)),
    tally(actual, (q) => questionTier(q)),
    TIER_LABELS,
  )

  // Outcomes: which planned learning outcomes the paper actually assesses. Only
  // outcomes the blueprint carried are counted — an outcome the syllabus never
  // gave was never planned, so its absence is not drift.
  const plannedOutcomes = [...new Set(
    items.map((i) => String(i.learningOutcome || '').trim()).filter(Boolean),
  )]
  const actualOutcomes = new Set(
    actual.map((q) => String(q?.learningOutcome || '').trim()).filter(Boolean),
  )
  const missingOutcomes = plannedOutcomes.filter((o) => !actualOutcomes.has(o))

  const plannedFigures = items.filter((i) => i.figureRequired).length
  const actualFigures = actual.filter((q) => hasFigure(q)).length

  const marksReconcile = plannedMarks === actualMarks
  const countMatches = items.length === actual.length
  const onPlan = marksReconcile && countMatches &&
    topics.every((r) => r.status === 'met') &&
    difficulty.every((r) => r.status === 'met')

  return {
    hasBlueprint: true,
    itemCount: {
      planned: items.length, actual: actual.length, delta: actual.length - items.length,
    },
    marks: {
      planned: plannedMarks, actual: actualMarks,
      delta: actualMarks - plannedMarks, reconciles: marksReconcile,
    },
    topics,
    bloom,
    difficulty,
    outcomes: {
      planned: plannedOutcomes.length,
      covered: plannedOutcomes.length - missingOutcomes.length,
      missing: missingOutcomes,
    },
    figures: {
      planned: plannedFigures,
      actual: actualFigures,
      missing: Math.max(0, plannedFigures - actualFigures),
    },
    summary: buildSummary({
      items, actual, marksReconcile, plannedMarks, actualMarks, topics, difficulty,
    }),
    onPlan,
  }
}

function sumMarks(questions) {
  return questions.reduce((n, q) => n + (Number(q?.marks) || 0), 0)
}

/** Does this question carry a figure of any kind? */
function hasFigure(question) {
  return Boolean(
    question?.imageUrl ||
    question?.imageDiagram?.libraryKey ||
    (Array.isArray(question?.optionMedia) &&
      question.optionMedia.some((m) => m && (m.imageUrl || m.diagram))),
  )
}

/** One line a teacher can act on, naming the biggest deviation first. */
function buildSummary({
  items, actual, marksReconcile, plannedMarks, actualMarks, topics, difficulty,
}) {
  if (actual.length === 0) return 'Nothing to check yet — the paper is empty.'
  const problems = []
  if (actual.length !== items.length) {
    problems.push(
      `${actual.length} question${actual.length === 1 ? '' : 's'} where the plan had ${items.length}`,
    )
  }
  if (!marksReconcile) {
    problems.push(`${actualMarks} marks where the plan had ${plannedMarks}`)
  }
  const shortTopics = topics.filter((r) => r.status === 'short')
  if (shortTopics.length > 0) {
    problems.push(
      `${shortTopics.length} topic${shortTopics.length === 1 ? '' : 's'} under-covered`,
    )
  }
  const unplannedTopics = topics.filter((r) => r.status === 'unplanned')
  if (unplannedTopics.length > 0) {
    problems.push(
      `${unplannedTopics.length} topic${unplannedTopics.length === 1 ? '' : 's'} not in the plan`,
    )
  }
  const tierDrift = difficulty.filter((r) => r.status !== 'met')
  if (tierDrift.length > 0) problems.push('difficulty spread has shifted')

  if (problems.length === 0) return 'Matches the plan.'
  return `${problems.join(' · ')}.`
}
