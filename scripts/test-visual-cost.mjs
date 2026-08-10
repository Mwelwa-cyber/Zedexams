/**
 * Tests for the Visual Studio image-cost aggregator (pure).
 */
import assert from 'node:assert'
import { estimateCost, aggregateImageCosts } from '../src/features/visualStudio/lib/visualCostReportCore.js'

// estimateCost maps provider strings to a price; unknown → default.
assert.equal(estimateCost('recraft-v3'), 0.04)
assert.equal(estimateCost('gpt-image-1'), 0.06)
assert.equal(estimateCost('openai'), 0.06)
assert.equal(estimateCost('nano-banana-pro'), 0.05)
assert.equal(estimateCost('kie'), 0.05)
assert.equal(estimateCost('mystery'), 0.04)
assert.equal(estimateCost(''), 0.04)

const logs = [
  { uid: 'a', generator: 'recraft-v3' },
  { uid: 'a', generator: 'recraft-v3' },
  { uid: 'b', generator: 'gpt-image-1' },
  { uid: 'b', provider: 'kie' },
  null, // tolerated
]
const agg = aggregateImageCosts(logs)
assert.equal(agg.total, 4)
// 2*0.04 + 0.06 + 0.05 = 0.19
assert.equal(agg.totalCost, 0.19)

// byGenerator sorted by count desc; recraft has 2.
assert.equal(agg.byGenerator[0].generator, 'recraft-v3')
assert.equal(agg.byGenerator[0].count, 2)
assert.equal(agg.byGenerator[0].cost, 0.08)

// byTeacher: a and b each have 2.
const teacherA = agg.byTeacher.find((t) => t.uid === 'a')
assert.equal(teacherA.count, 2)
assert.equal(teacherA.cost, 0.08)
const teacherB = agg.byTeacher.find((t) => t.uid === 'b')
assert.equal(teacherB.count, 2)
assert.equal(teacherB.cost, 0.11)

// Empty input → zeroes, no throw.
const empty = aggregateImageCosts([])
assert.equal(empty.total, 0)
assert.equal(empty.totalCost, 0)
assert.deepEqual(empty.byGenerator, [])

console.log('✓ visual-cost tests passed')
