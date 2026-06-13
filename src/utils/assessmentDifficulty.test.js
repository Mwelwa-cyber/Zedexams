/**
 * Tests for difficulty bucketing + balance analysis.
 *
 * Run: node src/utils/assessmentDifficulty.test.js
 */

import {
  difficultyBucket, analyzeDifficulty, isExplicitDifficulty,
} from './assessmentDifficulty.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('difficultyBucket — explicit tag wins')
{
  assert(difficultyBucket({ difficulty: 'easy', type: 'essay', marks: 10 }) === 'easy', 'explicit easy overrides what would infer as hard')
  assert(difficultyBucket({ difficulty: 'hard', type: 'mcq', marks: 1 }) === 'hard', 'explicit hard overrides what would infer as easy')
  assert(difficultyBucket({ difficulty: 'MEDIUM', type: 'mcq', marks: 1 }) === 'medium', 'tag is case-insensitive')
  assert(difficultyBucket({ difficulty: 'tricky', type: 'mcq', marks: 1 }) === 'easy', 'unknown tag falls back to inference')
}

console.log('\ndifficultyBucket — inference when untagged')
{
  assert(difficultyBucket({ type: 'mcq', marks: 1 }) === 'easy', 'mcq 1 mark → easy')
  assert(difficultyBucket({ type: 'mcq', marks: 3 }) === 'medium', 'mcq 3 marks → medium')
  assert(difficultyBucket({ type: 'mcq', marks: 5 }) === 'hard', 'mcq 5 marks → hard')
  assert(difficultyBucket({ type: 'essay', marks: 6 }) === 'hard', 'essay → hard')
  assert(difficultyBucket({ type: 'short_answer', marks: 2 }) === 'medium', 'short answer <4 → medium')
  assert(difficultyBucket({ type: 'diagram', marks: 5 }) === 'hard', 'diagram ≥4 → hard')
  assert(difficultyBucket({}) === 'easy', 'no type/marks defaults to mcq/1 → easy')
}

console.log('\nisExplicitDifficulty')
{
  assert(isExplicitDifficulty({ difficulty: 'hard' }) === true, 'valid tag is explicit')
  assert(isExplicitDifficulty({ difficulty: '' }) === false, 'empty is not explicit')
  assert(isExplicitDifficulty({}) === false, 'missing is not explicit')
  assert(isExplicitDifficulty({ difficulty: 'spicy' }) === false, 'invalid value is not explicit')
}

console.log('\nanalyzeDifficulty')
{
  const stats = analyzeDifficulty([
    { type: 'mcq', marks: 1 },                 // easy (inferred)
    { type: 'mcq', marks: 1, difficulty: 'hard' }, // hard (tagged)
    { type: 'essay', marks: 6 },               // hard (inferred)
    { type: 'mcq', marks: 3 },                 // medium (inferred)
  ])
  assert(stats.total === 4, 'counts total')
  assert(stats.buckets.easy === 1 && stats.buckets.medium === 1 && stats.buckets.hard === 2, 'buckets tally correctly')
  assert(stats.tagged === 1, 'counts explicitly-tagged questions')
  assert(stats.byBucket.hard.length === 2, 'byBucket groups questions')
  assert(stats.target.easy === 0.4, 'exposes the target mix')
}

console.log('\nanalyzeDifficulty — verdicts')
{
  assert(analyzeDifficulty([]).verdict === 'No questions yet', 'empty paper verdict')
  assert(analyzeDifficulty([{ type: 'mcq', marks: 1 }]).verdict === 'No hard challenge', 'all-easy → no hard challenge')
  assert(analyzeDifficulty([{ type: 'essay', marks: 6 }]).verdict === 'No easy openers', 'all-hard → no easy openers')
  const mixed = analyzeDifficulty([
    { type: 'mcq', marks: 1 }, { type: 'mcq', marks: 1 },
    { type: 'mcq', marks: 3 }, { type: 'essay', marks: 6 },
  ])
  assert(mixed.verdict === 'Looks balanced', 'a spread with easy+medium+hard looks balanced')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentDifficulty tests passed.')
