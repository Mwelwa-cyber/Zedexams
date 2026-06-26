/**
 * Unit tests for src/utils/sbaPlanner.js — the SBA Year Planner progress logic.
 *
 * Run: node scripts/test-sba-planner.mjs
 */

import assert from 'node:assert'
import {
  SBA_TASK_STATUSES,
  SBA_STATUS_VALUES,
  normalizeSbaStatus,
  nextSbaStatus,
  summarizeSbaPlan,
  buildSbaPlan,
} from '../src/utils/sbaPlanner.js'
import { getSbaBlueprint } from '../src/config/sba.js'

let passed = 0
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`) }
function eq(name, a, b) { assert.strictEqual(a, b, `${name} (got ${a}, expected ${b})`); passed += 1; console.log(`  ok  ${name}`) }

console.log('sbaPlanner — status model')
eq('four statuses', SBA_TASK_STATUSES.length, 4)
eq('marked is last', SBA_STATUS_VALUES[3], 'marked')
eq('unknown → not_started', normalizeSbaStatus('bogus'), 'not_started')
eq('cycle not_started → planned', nextSbaStatus('not_started'), 'planned')
eq('cycle planned → administered', nextSbaStatus('planned'), 'administered')
eq('cycle administered → marked', nextSbaStatus('administered'), 'marked')
eq('cycle marked → not_started (wraps)', nextSbaStatus('marked'), 'not_started')
eq('cycle from unknown starts at planned', nextSbaStatus('xyz'), 'planned')

console.log('sbaPlanner — summarizeSbaPlan')
{
  const cols = getSbaBlueprint('mathematics', 'G5').columns // 12 tasks
  const empty = summarizeSbaPlan(cols, {})
  eq('total 12', empty.total, 12)
  eq('none done', empty.done, 0)
  eq('0% complete', empty.percentComplete, 0)
  eq('remaining 12', empty.remaining, 12)
  eq('all not_started', empty.counts.not_started, 12)

  // Mark 6 of 12 as marked, 3 administered, 3 planned.
  const statuses = {}
  cols.forEach((c, i) => {
    statuses[c.key] = i < 6 ? 'marked' : i < 9 ? 'administered' : 'planned'
  })
  const s = summarizeSbaPlan(cols, statuses)
  eq('6 marked', s.counts.marked, 6)
  eq('3 administered', s.counts.administered, 3)
  eq('3 planned', s.counts.planned, 3)
  eq('done = 6', s.done, 6)
  eq('50% complete', s.percentComplete, 50)
  eq('remaining 6', s.remaining, 6)
}

console.log('sbaPlanner — rounding of percent')
{
  const cols = getSbaBlueprint('english', 'G5').columns // 18 tasks
  const statuses = {}
  cols.forEach((c, i) => { if (i < 6) statuses[c.key] = 'marked' }) // 6/18 = 33.33%
  eq('6/18 → 33%', summarizeSbaPlan(cols, statuses).percentComplete, 33)
}

console.log('sbaPlanner — buildSbaPlan groups + per-group progress')
{
  const plan = buildSbaPlan('english', 'G5', {})
  ok('plan built', plan !== null)
  eq('three term groups', plan.groups.length, 3)
  eq('each term has 6 tasks', plan.groups.every((g) => g.columns.length === 6) ? 6 : -1, 6)
  eq('year total 180', plan.total, 180)
  ok('each group has a summary', plan.groups.every((g) => g.summary && typeof g.summary.percentComplete === 'number'))
  ok('each group reports max marks', plan.groups.every((g) => g.maxMarks === 60))

  // CTS groups by component, not term.
  const cts = buildSbaPlan('creative_and_technology_studies', 'G5', {})
  eq('CTS has 3 component groups', cts.groups.length, 3)
  ok('CTS group is Expressive Arts', cts.groups.some((g) => g.group === 'Expressive Arts'))

  // Unknown combo → null.
  ok('unknown subject → null', buildSbaPlan('history', 'G5') === null)
}

console.log(`\n✓ sbaPlanner — all ${passed} assertions passed.`)
