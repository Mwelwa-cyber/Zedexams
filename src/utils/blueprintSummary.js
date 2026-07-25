/**
 * blueprintSummary — the paper's plan, in words a teacher reads.
 *
 * §3.1 asks for the plan to be shown "as a readable summary" before generation.
 * The blueprint object is a machine artefact: `bloomLevel: 'analyse'`,
 * `difficulty: 'challenge'`, `activitySupport: 'mapped'`. None of that belongs on
 * screen. This turns it into sentences — "20 questions worth 40 marks, about 28
 * minutes of work", "7 on Plants, 7 on Weather, 6 on Rocks", "6 need a picture" —
 * so the teacher can tell at a glance whether it is the paper they wanted.
 *
 * Pure: no React, no Firebase, no formatting library. Tested under plain `node`.
 */

/** Plain-language names for the four difficulty tiers. */
export const TIER_LABELS = {
  recall: 'Straight recall',
  understanding: 'Understanding and applying',
  analysis: 'Working things out',
  challenge: 'Hardest questions',
}

/** Plain-language names for the thinking (Bloom) levels. */
export const THINKING_LABELS = {
  remember: 'Remembering',
  understand: 'Understanding',
  apply: 'Applying',
  analyse: 'Analysing',
  analyze: 'Analysing',
  evaluate: 'Judging',
  create: 'Creating',
}

const TIER_ORDER = ['recall', 'understanding', 'analysis', 'challenge']

/** Every item across every section. */
export function planItems(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.sections)) return []
  return blueprint.sections.flatMap((s) => (Array.isArray(s.items) ? s.items : []))
}

/** "1 question" / "4 questions" — the pluralisation this file does a lot of. */
function count(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Join a list the way a person would: "a, b and c". */
export function listWords(values) {
  const list = values.filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/**
 * The one-line headline: what the paper is, how long it takes.
 *
 * The estimate is deliberately included even when it agrees with the duration —
 * a teacher deciding whether 40 marks fits a 30-minute lesson needs the number,
 * not just a warning when it is already too late.
 */
export function planHeadline(blueprint) {
  if (!blueprint) return ''
  const bits = [
    count(blueprint.itemCount || 0, 'question'),
    `${blueprint.totalMarks || 0} marks`,
  ]
  const est = Number(blueprint.estimatedMinutes)
  if (Number.isFinite(est) && est > 0) bits.push(`about ${est} minutes of work`)
  return bits.join(' · ')
}

/**
 * How the questions are spread over the chosen topics, most first.
 * Returns [{topic, questions, marks}].
 */
export function planTopicRows(blueprint) {
  const rows = new Map()
  for (const item of planItems(blueprint)) {
    const topic = String(item.topic || '').trim()
    if (!topic) continue
    const row = rows.get(topic) || { topic, questions: 0, marks: 0 }
    row.questions += 1
    row.marks += Number(item.marks) || 0
    rows.set(topic, row)
  }
  return [...rows.values()].sort((a, b) => b.questions - a.questions || a.topic.localeCompare(b.topic))
}

/**
 * The difficulty spread as rows a teacher can read, in ascending demand so it
 * reads like a ramp. Tiers with no questions are included at 0 — an empty row is
 * information ("nothing hard on this paper"), not noise.
 */
export function planDifficultyRows(blueprint) {
  const items = planItems(blueprint)
  const counts = {}
  for (const item of items) {
    const tier = String(item.difficulty || '').trim()
    if (!tier) continue
    counts[tier] = (counts[tier] || 0) + 1
  }
  const keys = [...TIER_ORDER, ...Object.keys(counts).filter((k) => !TIER_ORDER.includes(k))]
  const total = items.length || 1
  return keys.map((key) => ({
    key,
    label: TIER_LABELS[key] || key,
    questions: counts[key] || 0,
    percent: Math.round(((counts[key] || 0) / total) * 100),
  }))
}

/** The kinds of question on the paper, by name, most-used first. */
export function planActivityRows(blueprint) {
  const rows = new Map()
  for (const item of planItems(blueprint)) {
    const key = item.activityType || item.renderType || ''
    if (!key) continue
    const row = rows.get(key) || {
      key,
      label: item.activityLabel || key.replace(/_/g, ' '),
      questions: 0,
      limited: item.activitySupport === 'unsupported',
    }
    row.questions += 1
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => b.questions - a.questions)
}

/**
 * Notes worth reading before generating: the plan's own warnings (too many
 * topics for the question count, a paper longer than its duration, a section
 * dropped) plus the two facts a teacher acts on — how many questions will need a
 * picture, and how many are tied to a named syllabus outcome.
 */
export function planNotes(blueprint) {
  if (!blueprint) return []
  const items = planItems(blueprint)
  const notes = [...(Array.isArray(blueprint.warnings) ? blueprint.warnings : [])]
  const figures = items.filter((i) => i.figureRequired).length
  if (figures > 0) {
    notes.push(
      `${count(figures, 'question')} will need a picture or diagram — ` +
      'these are drawn for you, and you can replace any of them.',
    )
  }
  const withOutcome = items.filter((i) => String(i.learningOutcome || '').trim()).length
  if (items.length > 0 && withOutcome === 0) {
    notes.push(
      'The syllabus on file lists no learning outcomes for these topics, so the ' +
      'questions are planned against the topics themselves.',
    )
  } else if (withOutcome > 0 && withOutcome < items.length) {
    notes.push(
      `${withOutcome} of ${items.length} questions are tied to a named syllabus ` +
      'outcome; the rest are planned against their topic.',
    )
  }
  return notes
}

/**
 * Sections as headline rows. A band that does not print sections (Early
 * Childhood, lower primary) plans one unnamed run of questions, and showing
 * "Section: (blank)" for it would be worse than showing nothing — so an unnamed
 * single section returns no rows at all.
 */
export function planSectionRows(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.sections)) return []
  const sections = blueprint.sections
  if (sections.length === 1 && !sections[0].name && !sections[0].heading) return []
  return sections.map((s, i) => ({
    key: s.name || s.heading || `part-${i}`,
    label: s.heading || s.name || `Part ${i + 1}`,
    // Prefer the real items; fall back to the planned count for a section whose
    // items have not been laid out (a partially-formed plan should still say how
    // big the section is meant to be, not report it as empty).
    questions: (Array.isArray(s.items) ? s.items.length : 0) || Number(s.itemCount) || 0,
    marks: Number(s.marks) || 0,
    instructions: s.instructions || '',
  }))
}

/**
 * Everything the confirmation screen needs, in one call.
 *
 * `ready` is false for a missing or empty plan; the caller shows its own
 * "we could not plan this one — generate anyway?" state rather than an empty
 * summary that looks like a plan for a paper with no questions.
 */
export function summarizePlan(blueprint) {
  const items = planItems(blueprint)
  return {
    ready: Boolean(blueprint) && items.length > 0,
    headline: planHeadline(blueprint),
    itemCount: items.length,
    totalMarks: Number(blueprint?.totalMarks) || 0,
    durationMinutes: Number(blueprint?.durationMinutes) || 0,
    estimatedMinutes: Number(blueprint?.estimatedMinutes) || 0,
    sections: planSectionRows(blueprint),
    topics: planTopicRows(blueprint),
    difficulty: planDifficultyRows(blueprint),
    activities: planActivityRows(blueprint),
    notes: planNotes(blueprint),
  }
}

/**
 * The difficulty presets offered on the confirmation screen.
 *
 * A teacher adjusting the spread should not be typing four percentages that have
 * to add to 100 — they should be saying "make it harder". Each preset is a weight
 * map; buildPaperBlueprint normalises it, so the weights need not sum to
 * anything in particular.
 *
 * `null` weights mean "whatever this level normally does" — the band's own
 * default, which is the right answer often enough to be the default here too.
 */
export const DIFFICULTY_PRESETS = [
  {
    id: 'band',
    label: 'Usual for this level',
    hint: 'The spread this grade normally gets',
    weights: null,
  },
  {
    id: 'gentler',
    label: 'Gentler',
    hint: 'More straight recall, fewer hard questions',
    weights: { recall: 0.5, understanding: 0.35, analysis: 0.12, challenge: 0.03 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'An even ramp from recall to challenge',
    weights: { recall: 0.3, understanding: 0.4, analysis: 0.2, challenge: 0.1 },
  },
  {
    id: 'harder',
    label: 'More demanding',
    hint: 'Fewer recall questions, more working things out',
    weights: { recall: 0.15, understanding: 0.35, analysis: 0.3, challenge: 0.2 },
  },
]

/** The preset with this id, or the 'band' default. */
export function presetById(id) {
  return DIFFICULTY_PRESETS.find((p) => p.id === id) || DIFFICULTY_PRESETS[0]
}
