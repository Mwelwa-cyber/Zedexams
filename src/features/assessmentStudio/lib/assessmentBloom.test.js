/**
 * Tests for Bloom's-taxonomy analysis (no inference — explicit tags only).
 *
 * Run: node src/utils/assessmentBloom.test.js
 */

import { bloomLevel, analyzeBloom, BLOOM_LEVELS } from './assessmentBloom.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('bloomLevel')
{
  assert(bloomLevel({ bloom: 'apply' }) === 'apply', 'valid level returned')
  assert(bloomLevel({ bloom: 'ANALYZE' }) === 'analyze', 'case-insensitive')
  assert(bloomLevel({ bloom: 'synthesize' }) === '', 'invalid level → empty')
  assert(bloomLevel({}) === '', 'untagged → empty')
  assert(BLOOM_LEVELS.length === 6, 'six taxonomy levels')
}

console.log('\nanalyzeBloom — tallies + tagged/untagged split')
{
  const stats = analyzeBloom([
    { bloom: 'remember' },
    { bloom: 'understand' },
    { bloom: 'apply' },
    {},               // untagged
    { bloom: 'bogus' }, // invalid → untagged
  ])
  assert(stats.total === 5, 'counts total')
  assert(stats.tagged === 3, 'counts only valid tags')
  assert(stats.untagged === 2, 'untagged includes invalid tags')
  assert(stats.buckets.apply === 1 && stats.buckets.create === 0, 'per-level buckets')
  assert(stats.byBucket.remember.length === 1, 'byBucket drill-down')
}

console.log('\nanalyzeBloom — lower/higher order split')
{
  const stats = analyzeBloom([
    { bloom: 'remember' }, { bloom: 'understand' }, // lower
    { bloom: 'analyze' }, { bloom: 'create' },      // higher
  ])
  assert(stats.lowerOrder === 2, 'lower-order count (remember+understand)')
  assert(stats.higherOrder === 2, 'higher-order count (analyze+create)')
}

console.log('\nanalyzeBloom — verdicts')
{
  assert(analyzeBloom([]).verdict === 'No questions yet', 'empty')
  assert(analyzeBloom([{}, {}]).verdict === 'No cognitive levels tagged', 'none tagged')
  assert(analyzeBloom([{ bloom: 'apply' }, {}]).verdict === '1 question untagged', 'partial coverage flags untagged count')
  assert(analyzeBloom([{ bloom: 'remember' }, { bloom: 'understand' }]).verdict === 'All lower-order (recall / understand)', 'all lower-order')
  assert(analyzeBloom([{ bloom: 'evaluate' }, { bloom: 'create' }]).verdict === 'All higher-order — add some recall', 'all higher-order')
  assert(analyzeBloom([{ bloom: 'remember' }, { bloom: 'analyze' }]).verdict === 'Good spread of thinking skills', 'balanced spread')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentBloom tests passed.')
