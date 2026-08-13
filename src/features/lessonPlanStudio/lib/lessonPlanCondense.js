/**
 * lessonPlanCondense — the post-generation length gate (§3.2).
 *
 * A word budget passed into a prompt is a request. This module is what turns it
 * into a promise: after the plan comes back, every budgeted cell is measured,
 * and the ones that overshot by more than the tolerance are sent back in ONE
 * cheap targeted call ("condense these to ≤ N words each, keep every distinct
 * action") rather than regenerating the whole plan and rolling the dice again on
 * the parts that were already right.
 *
 * Pure — no network, no React. The caller supplies the model call, so the same
 * logic is testable under plain `node` and reusable from a Cloud Function later.
 */

import { LENGTH_GATE_TOLERANCE, resolveLessonFormat } from '../../../utils/lessonPlanFormat.js'

/**
 * Words in a cell. Dash prefixes, bullet glyphs and numbering are stripped
 * first: "– Draw and label" is three words of content, not four.
 * @param {unknown} value
 * @returns {number}
 */
export function countWords(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value)
  return text
    .replace(/^[\s–—\-•*]+/gm, ' ')
    .replace(/^\s*\d+[.)]\s*/gm, ' ')
    .split(/\s+/)
    .filter(Boolean).length
}

/** Fragments (dash lines) in a cell. */
export function countFragments(value) {
  if (Array.isArray(value)) return value.filter((v) => String(v || '').trim()).length
  return String(value == null ? '' : value)
    .split(/\n|;\s*/)
    .map((s) => s.trim())
    .filter(Boolean).length
}

// The top-level fields a budget names, and where they live on the plan.
const TOP_LEVEL_FIELDS = ['rationale', 'lessonGoal', 'priorKnowledge', 'remedialWork', 'extensionActivity']

// The per-stage cells, and the budget key each one is measured against.
const STAGE_CELLS = [
  ['teacher', 'teacher'],
  ['pupils', 'pupils'],
  ['assessment', 'assessment'],
]

/**
 * Measure a plan against a format's word budgets.
 *
 * Returns every budgeted cell with its budget, its actual length and whether it
 * is over tolerance. Cells whose budget is `null` (No limit) are reported with
 * `budget: null` and `over: false` — they are still measured, because the page
 * badge and the studio's own diagnostics want the numbers even when nothing is
 * being enforced.
 *
 * @param {object} plan
 * @param {object} format  raw or resolved lesson format
 * @returns {{ cells: Array<object>, over: Array<object>, totalWords: number }}
 */
export function measurePlan(plan, format) {
  const f = resolveLessonFormat(format)
  const budgets = f.wordBudgets
  const p = plan && typeof plan === 'object' ? plan : {}
  const cells = []

  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in budgets)) continue
    const words = countWords(p[field])
    if (words === 0) continue
    cells.push({
      path: field,
      label: field,
      budget: budgets[field],
      words,
      fragments: countFragments(p[field]),
      maxFragments: null,
      text: String(p[field] || ''),
    })
  }

  const stages = Array.isArray(p.stages) ? p.stages : []
  stages.forEach((stage, index) => {
    const s = stage && typeof stage === 'object' ? stage : {}
    for (const [key, budgetKey] of STAGE_CELLS) {
      const words = countWords(s[key])
      if (words === 0) continue
      cells.push({
        path: `stages[${index}].${key}`,
        label: `${s.name || `Stage ${index + 1}`} — ${budgetKey}`,
        stageIndex: index,
        stageKey: key,
        budget: budgets[budgetKey],
        words,
        fragments: countFragments(s[key]),
        maxFragments: budgets.maxFragments ? budgets.maxFragments[budgetKey] ?? null : null,
        text: String(s[key] || ''),
      })
    }
  })

  for (const cell of cells) {
    // A budget of 0 means "omit this section entirely at this page budget" —
    // the section toggles, not the condense pass, are what remove it, so a
    // zero budget is never treated as an overshoot to spend a model call on.
    const enforced = typeof cell.budget === 'number' && cell.budget > 0
    cell.over = enforced && cell.words > Math.ceil(cell.budget * (1 + LENGTH_GATE_TOLERANCE))
    cell.overFragments =
      typeof cell.maxFragments === 'number' && cell.maxFragments > 0 && cell.fragments > cell.maxFragments
  }

  return {
    cells,
    over: cells.filter((c) => c.over || c.overFragments),
    totalWords: cells.reduce((sum, c) => sum + c.words, 0),
  }
}

/**
 * The repair prompt for the over-budget cells. One call, every cell in it,
 * answered as JSON keyed by the cell path so the splice is unambiguous.
 * @param {Array<object>} overCells
 * @returns {string}
 */
export function buildCondensePrompt(overCells) {
  const items = overCells.map((c) => ({
    id: c.path,
    maxWords: c.budget,
    ...(typeof c.maxFragments === 'number' && c.maxFragments > 0 ? { maxLines: c.maxFragments } : {}),
    text: c.text,
  }))
  return [
    'Condense each cell of a Zambian teacher\'s lesson plan below to fit its word limit.',
    '',
    'Rules:',
    '- Preserve EVERY distinct action. Never drop a step, a question, a material or an expected answer — shorten the wording, do not shorten the lesson.',
    '- Write in point form the way a teacher writes in a plan book: sentence fragments, imperative voice, no subject pronouns, no restating the stage name or the lesson context.',
    '- Keep each line on its own line. Where maxLines is given, merge related actions until the cell has at most that many lines.',
    '- Keep Zambian English spelling and any bracketed expected answers.',
    '',
    'Return ONLY a JSON object mapping each id to its condensed text. No markdown fences, no commentary.',
    '',
    JSON.stringify(items, null, 2),
  ].join('\n')
}

/**
 * Splice condensed text back into a plan.
 *
 * Every untouched object is returned reference-identical, so a caller can tell
 * by identity which stages the gate actually rewrote — and a React preview does
 * not re-render the whole document because one cell changed.
 *
 * @param {object} plan
 * @param {Record<string, string>} condensed  path → new text
 * @returns {object} a new plan (or the same one when nothing applied)
 */
export function applyCondensed(plan, condensed) {
  if (!plan || typeof plan !== 'object') return plan
  const map = condensed && typeof condensed === 'object' ? condensed : {}
  const keys = Object.keys(map).filter((k) => String(map[k] || '').trim())
  if (keys.length === 0) return plan

  const next = { ...plan }
  let touchedTop = false
  const stageEdits = new Map()

  for (const key of keys) {
    const value = String(map[key]).trim()
    const stageMatch = /^stages\[(\d+)\]\.(teacher|pupils|assessment)$/.exec(key)
    if (stageMatch) {
      const index = Number(stageMatch[1])
      if (!stageEdits.has(index)) stageEdits.set(index, {})
      stageEdits.get(index)[stageMatch[2]] = value
      continue
    }
    if (TOP_LEVEL_FIELDS.includes(key)) {
      next[key] = value
      touchedTop = true
    }
  }

  if (stageEdits.size > 0 && Array.isArray(plan.stages)) {
    next.stages = plan.stages.map((stage, index) => {
      const edit = stageEdits.get(index)
      if (!edit) return stage
      const merged = { ...stage, ...edit }
      // Keep both field families in step — planShape's contract is that the
      // preview's string fields and the exporters' array fields say the same
      // thing. Rewriting only the string half is exactly how a condensed plan
      // would preview short and export long.
      if (edit.teacher != null) merged.teacherActivities = splitLines(edit.teacher)
      if (edit.pupils != null) merged.learnerActivities = splitLines(edit.pupils)
      if (edit.assessment != null) merged.assessmentCriteria = splitLines(edit.assessment)
      return merged
    })
  } else if (!touchedTop) {
    return plan
  }

  return next
}

function splitLines(value) {
  return String(value == null ? '' : value)
    .split(/\n|;\s*/)
    .map((s) => s.replace(/^[\s–—-]+/, '').trim())
    .filter(Boolean)
}

/**
 * Parse a condense response. Tolerates the fenced-JSON the models sometimes
 * emit despite being asked not to; returns {} rather than throwing, because a
 * malformed repair must leave the plan the teacher already has on screen alone.
 * @param {string} raw
 * @returns {Record<string, string>}
 */
export function parseCondenseResponse(raw) {
  const text = String(raw == null ? '' : raw)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v
      else if (Array.isArray(v)) out[k] = v.map((x) => String(x || '').trim()).filter(Boolean).join('\n')
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Run the gate: measure, and if anything overshot, repair it through `callModel`.
 *
 * `callModel(prompt)` returns the raw model text. Any failure — a throw, a
 * malformed reply, an empty map — resolves to the ORIGINAL plan with
 * `repaired: false`. A length gate that loses a teacher's plan because the
 * repair call timed out is worse than one that leaves it a page long.
 *
 * @param {object} plan
 * @param {object} format
 * @param {(prompt: string) => Promise<string>} callModel
 * @returns {Promise<{ plan: object, repaired: boolean, measured: object, error: string | null }>}
 */
export async function runLengthGate(plan, format, callModel) {
  const measured = measurePlan(plan, format)
  if (measured.over.length === 0 || typeof callModel !== 'function') {
    return { plan, repaired: false, measured, error: null }
  }
  try {
    const raw = await callModel(buildCondensePrompt(measured.over))
    const condensed = parseCondenseResponse(raw)
    const next = applyCondensed(plan, condensed)
    return { plan: next, repaired: next !== plan, measured, error: null }
  } catch (err) {
    return {
      plan,
      repaired: false,
      measured,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
