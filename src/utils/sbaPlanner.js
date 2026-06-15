/**
 * SBA Year Planner logic — pure helpers for tracking each official ECZ task
 * through its lifecycle (Planned → Administered → Marked) against the
 * per-grade blueprint. UI lives in SbaYearPlanner.jsx; the maths is here so a
 * plain `node` test can cover it (scripts/test-sba-planner.mjs).
 *
 * Side-effect free (imports only the pure config/sba taxonomy).
 */

import { getSbaBlueprint } from '../config/sba.js'

/**
 * The lifecycle stages an SBA task moves through. Only `marked` counts as
 * complete (the task has contributed marks the teacher can submit).
 */
export const SBA_TASK_STATUSES = [
  { value: 'not_started',  label: 'Not started',  short: '—',   tone: 'slate' },
  { value: 'planned',      label: 'Planned',      short: 'P',   tone: 'amber' },
  { value: 'administered', label: 'Administered', short: 'A',   tone: 'sky' },
  { value: 'marked',       label: 'Marked',       short: '✓',   tone: 'green' },
]

export const SBA_STATUS_VALUES = SBA_TASK_STATUSES.map((s) => s.value)
export const DEFAULT_SBA_STATUS = 'not_started'

const STATUS_BY_VALUE = Object.fromEntries(SBA_TASK_STATUSES.map((s) => [s.value, s]))

/** Normalise an arbitrary value to a known status (defaults to not_started). */
export function normalizeSbaStatus(value) {
  return STATUS_BY_VALUE[value] ? value : DEFAULT_SBA_STATUS
}

/** The next status in the cycle — used by the click-to-advance chips. */
export function nextSbaStatus(value) {
  const idx = SBA_STATUS_VALUES.indexOf(normalizeSbaStatus(value))
  return SBA_STATUS_VALUES[(idx + 1) % SBA_STATUS_VALUES.length]
}

/**
 * Summarise progress over a set of blueprint columns given a {columnKey:
 * status} map. Returns the per-status counts, the number marked (complete),
 * the total, and the percent complete (rounded, 0–100).
 */
export function summarizeSbaPlan(columns = [], statuses = {}) {
  const counts = { not_started: 0, planned: 0, administered: 0, marked: 0 }
  for (const c of columns) {
    const st = normalizeSbaStatus(statuses[c.key])
    counts[st] += 1
  }
  const total = columns.length
  const done = counts.marked
  return {
    total,
    counts,
    done,
    remaining: total - done,
    percentComplete: total ? Math.round((done / total) * 100) : 0,
  }
}

/**
 * Group a blueprint's columns by their `group` band (Term 1 / Listening &
 * Speaking / …) and attach a per-group progress summary. Convenience wrapper
 * used by the planner to render grouped sections with their own progress.
 */
export function buildSbaPlan(subject, grade, statuses = {}) {
  const blueprint = getSbaBlueprint(subject, grade)
  if (!blueprint) return null
  const groups = []
  for (const col of blueprint.columns) {
    let g = groups.find((x) => x.group === col.group)
    if (!g) { g = { group: col.group, columns: [] }; groups.push(g) }
    g.columns.push(col)
  }
  for (const g of groups) {
    g.summary = summarizeSbaPlan(g.columns, statuses)
    g.maxMarks = g.columns.reduce((s, c) => s + c.max, 0)
  }
  return {
    subject,
    grade,
    total: blueprint.total,
    groups,
    summary: summarizeSbaPlan(blueprint.columns, statuses),
  }
}
