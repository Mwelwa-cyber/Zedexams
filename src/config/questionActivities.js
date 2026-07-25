/**
 * Question ACTIVITIES — what the teacher is setting — and the render structure
 * each one is currently carried by.
 *
 * These are two different things and must stay two different fields:
 *
 *   activityType  what the task IS      — "tracing", "picture_matching"
 *   renderType    how it is laid out    — "structured", "matching"
 *
 * Collapsing them loses information that cannot be recovered. A tracing task
 * stored only as `structured` is indistinguishable from a generic multi-part
 * question forever: the picker can't show what it was, analytics can't count
 * it, a teacher reopening the paper can't see what they asked for, and the
 * migration that adds real tracing layouts has nothing to migrate. So the
 * activity is preserved on the question and the render type is derived from it.
 *
 * `support` says how honestly the current renderers carry the activity:
 *
 *   native       the renderers lay this out AS ITSELF; activityType and
 *                renderType are the same thing
 *   mapped       faithfully carried by another structure — a "circle the right
 *                picture" task genuinely IS a multiple-choice question with
 *                image options, and prints correctly
 *   unsupported  no faithful layout yet. It is still generated, stored and
 *                printed — as a figure plus a work area — but the UI must say
 *                so rather than imply a finished worksheet experience
 *
 * The `unsupported` three (tracing, colouring, sorting) are what the Phase 4
 * rendering contract is for: stroke guides, closed-shape artwork to colour, and
 * grouped drop areas. Until then they are labelled, not hidden.
 *
 * Pure — no React, no Firebase. Mirrored to functions/ through the generated
 * functions/data/assessmentBands.json (see scripts/sync-assessment-bands.mjs).
 */

export const ACTIVITY_SUPPORT = {
  NATIVE: 'native',
  MAPPED: 'mapped',
  UNSUPPORTED: 'unsupported',
}

/**
 * Every activity the studio can ask for.
 *
 * `label` is what a teacher sees — the educational activity name, NEVER the
 * internal fallback renderer name. A teacher who picked "Tracing" must not be
 * shown "Structured".
 */
export const QUESTION_ACTIVITIES = [
  // ── Native: the eight structures the schema and all four renderers own ──
  { id: 'multiple_choice', label: 'Multiple choice', renderType: 'multiple_choice', support: 'native' },
  { id: 'true_false', label: 'True / False', renderType: 'true_false', support: 'native' },
  { id: 'short_answer', label: 'Short answer', renderType: 'short_answer', support: 'native' },
  { id: 'fill_blanks', label: 'Fill in the blank', renderType: 'fill_blanks', support: 'native' },
  { id: 'matching', label: 'Matching', renderType: 'matching', support: 'native' },
  { id: 'structured', label: 'Structured', renderType: 'structured', support: 'native' },
  { id: 'calculation', label: 'Calculation', renderType: 'calculation', support: 'native' },
  { id: 'essay', label: 'Essay / Composition', renderType: 'essay', support: 'native' },

  // ── Early years ──
  {
    id: 'picture_identification',
    label: 'Name the picture',
    renderType: 'short_answer',
    support: 'mapped',
    note: 'A figure with a short written or spoken answer.',
  },
  {
    id: 'circling',
    label: 'Circle the answer',
    renderType: 'multiple_choice',
    support: 'mapped',
    note: 'Really is a multiple-choice question — the learner rings the right option instead of writing a letter. Picture options where the task calls for them.',
  },
  {
    id: 'picture_matching',
    label: 'Match pictures',
    renderType: 'matching',
    support: 'mapped',
    note: 'Really is a matching question, with pictures in both columns.',
  },
  {
    id: 'counting',
    label: 'Counting',
    renderType: 'short_answer',
    support: 'mapped',
    note: 'A group of objects to count and a space for the number. Longer counting tasks render as structured work.',
  },
  {
    id: 'tracing',
    label: 'Tracing',
    renderType: 'structured',
    support: 'unsupported',
    note: 'Prints as a figure with a work area. Dotted stroke guides are not drawn yet.',
  },
  {
    id: 'colouring',
    label: 'Colouring',
    renderType: 'structured',
    support: 'unsupported',
    note: 'Prints as a figure with a work area. Closed-shape artwork made for colouring is not drawn yet.',
  },
  {
    id: 'sorting',
    label: 'Sorting',
    renderType: 'structured',
    support: 'unsupported',
    note: 'Prints as a figure with a work area. Labelled group boxes to sort into are not drawn yet.',
  },

  // ── Upper bands ──
  { id: 'diagram_labelling', label: 'Label a diagram', renderType: 'structured', support: 'mapped', note: 'A figure with numbered or lettered parts to name.' },
  { id: 'table_completion', label: 'Complete a table', renderType: 'structured', support: 'mapped', note: 'A table with cells left blank.' },
  { id: 'comprehension', label: 'Comprehension', renderType: 'short_answer', support: 'mapped', note: 'Questions answered from a passage in the same section.' },
  { id: 'multi_step_calculation', label: 'Multi-step calculation', renderType: 'calculation', support: 'mapped', note: 'A calculation with marks split across method and answer.' },
  { id: 'data_interpretation', label: 'Interpret data', renderType: 'structured', support: 'mapped', note: 'A table or chart with questions on it.' },
  { id: 'extended_response', label: 'Extended response', renderType: 'essay', support: 'mapped', note: 'A long written answer marked against stated criteria.' },
  { id: 'case_study', label: 'Case study', renderType: 'structured', support: 'mapped', note: 'A scenario with several questions on it.' },
  { id: 'graph_interpretation', label: 'Interpret a graph', renderType: 'structured', support: 'mapped', note: 'A graph to read values from.' },
  { id: 'practical', label: 'Practical', renderType: 'structured', support: 'mapped', note: 'A practical procedure marked against criteria.' },
]

const BY_ID = new Map(QUESTION_ACTIVITIES.map((a) => [a.id, a]))

/** Every activity id — the vocabulary a band's `questionTypes` draws from. */
export const ACTIVITY_IDS = QUESTION_ACTIVITIES.map((a) => a.id)

/** The eight structures the schema validates and the renderers lay out. */
export const RENDER_TYPES = [...new Set(QUESTION_ACTIVITIES.map((a) => a.renderType))]

export function activity(id) {
  return BY_ID.get(String(id || '')) || null
}

/** Teacher-facing name for an activity — never the fallback renderer's name. */
export function activityLabel(id) {
  return activity(id)?.label || String(id || '')
}

/** The render structure an activity is carried by ('tracing' → 'structured'). */
export function renderTypeFor(id) {
  return activity(id)?.renderType || String(id || '')
}

/** 'native' | 'mapped' | 'unsupported' — unknown ids report 'unsupported'. */
export function supportFor(id) {
  return activity(id)?.support || ACTIVITY_SUPPORT.UNSUPPORTED
}

/** True when the activity has no faithful layout yet and must be labelled. */
export function isLimitedSupport(id) {
  return supportFor(id) === ACTIVITY_SUPPORT.UNSUPPORTED
}

/**
 * Convert activity ids to the deduped render types the generator may emit.
 * Anything already a render type passes through.
 */
export function toRenderTypes(ids) {
  const out = []
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const mapped = renderTypeFor(id)
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

/**
 * Normalise a stored question's activity identity.
 *
 * A question saved before activities existed carries only its render type; that
 * IS its activity (it was authored as a plain structured/MCQ question), so it
 * reads back unchanged. A question whose stored activityType is not in the
 * registry falls back to its render type rather than being dropped — an
 * unrecognised label must never make a saved question unopenable.
 *
 * @returns {{activityType: string, renderType: string, support: string}}
 */
export function resolveQuestionActivity({ activityType, type } = {}) {
  const stored = String(activityType || '').trim()
  const renderType = String(type || '').trim()
  const known = activity(stored)
  if (known) {
    return { activityType: known.id, renderType: known.renderType, support: known.support }
  }
  const fallback = activity(renderType)
  return {
    activityType: fallback ? fallback.id : renderType,
    renderType,
    support: fallback ? fallback.support : ACTIVITY_SUPPORT.UNSUPPORTED,
  }
}
