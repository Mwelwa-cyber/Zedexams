/**
 * Tests for the pure teacher-defaults → studio-seed derivations (no Firebase).
 *
 * Run: node src/utils/teacherDefaults.test.js
 */

import {
  curriculumSeedFromProfile,
  lessonStudioSeed,
  aiPrefsPromptLines,
  preferredDifficulty,
  teachingCounts,
} from './teacherDefaults.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('curriculumSeedFromProfile')
{
  const seed = curriculumSeedFromProfile({
    teacherPreferences: {
      curriculum: { curriculum: 'previous', grade: 'G7', subject: 'mathematics' },
    },
  })
  assert(seed.curriculum === 'previous', 'carries curriculum')
  assert(seed.grade === 'G7', 'carries server-ready grade')
  assert(seed.subject === 'mathematics', 'carries subject slug')

  assert(curriculumSeedFromProfile(null) === null, 'no profile → null')
  assert(curriculumSeedFromProfile({}) === null, 'no prefs → null')
  assert(
    curriculumSeedFromProfile({ teacherPreferences: { curriculum: { curriculum: 'cbc' } } }) === null,
    'curriculum alone (no grade/subject) → null — nothing worth seeding',
  )
  const gradeOnly = curriculumSeedFromProfile({
    teacherPreferences: { curriculum: { grade: 'G5' } },
  })
  assert(gradeOnly && gradeOnly.grade === 'G5' && gradeOnly.curriculum === 'cbc', 'grade alone seeds with default curriculum')

  // AI Memory off → no auto-seeding, even with saved defaults.
  assert(
    curriculumSeedFromProfile({
      teacherPreferences: {
        ai: { rememberLastUsed: false },
        curriculum: { grade: 'G5', subject: 'mathematics' },
      },
    }) === null,
    'rememberLastUsed=false disables the curriculum seed',
  )
}

console.log('\nlessonStudioSeed')
{
  const seed = lessonStudioSeed(
    {
      teacherPreferences: {
        ai: { teachingLanguage: 'bemba', planDetail: 'detailed', include: { reflection: false } },
      },
    },
    { resourceLevel: 'low' },
  )
  assert(seed.medium === 'Bemba', 'maps language value → studio label')
  assert(seed.detail === 'detailed', 'carries non-default detail')
  assert(seed.includeLessonEvaluation === false, 'reflection off → evaluation off')
  assert(seed.resources === 'low', 'carries school resource level')

  const blank = lessonStudioSeed(null, null)
  assert(blank.medium === '', 'default language → no medium seed (studio keeps English)')
  assert(blank.detail === '', 'default detail → no seed (studio keeps standard)')
  assert(blank.includeLessonEvaluation === true, 'default reflection → evaluation on')
  assert(blank.resources === '', 'no school profile → no resources seed')

  const memoryOff = lessonStudioSeed(
    { teacherPreferences: { ai: { rememberLastUsed: false, teachingLanguage: 'bemba', planDetail: 'detailed' } } },
    { resourceLevel: 'low' },
  )
  assert(memoryOff.medium === '' && memoryOff.detail === '' && memoryOff.resources === '', 'memory off → no studio seeding')
}

console.log('\naiPrefsPromptLines')
{
  const defaults = aiPrefsPromptLines(null)
  assert(defaults.length === 1, 'defaults → only the English-variant line')
  assert(defaults[0].includes('British English'), 'defaults to British English')

  const american = aiPrefsPromptLines({
    teacherPreferences: { ai: { preferredEnglish: 'american' } },
  })
  assert(american[0].includes('American English'), 'american preference switches the line')

  const lines = aiPrefsPromptLines({
    teacherPreferences: {
      ai: {
        include: {
          competencies: false, specificOutcomes: true, teachingAids: false,
          homework: false, exercises: true, reflection: false,
        },
      },
    },
  })
  assert(lines.some((l) => l.includes('competencies')), 'competencies off → exclusion line')
  assert(lines.some((l) => l.includes('homework')), 'homework off → exclusion line')
  assert(lines.some((l) => l.includes('teaching/learning aids')), 'aids off → exclusion line')
  assert(lines.some((l) => l.includes('reflection')), 'reflection off → exclusion line')
  assert(!lines.some((l) => l.includes('outcomes')), 'outcomes on → no line')
  assert(!lines.some((l) => l.includes('exercises')), 'exercises on → no line')
  assert(lines.every((l) => l.startsWith('- ')), 'lines use the studio prompt bullet style')

  // Order stability — same input, same order (prompt caching friendliness).
  const again = aiPrefsPromptLines({
    teacherPreferences: {
      ai: {
        include: {
          competencies: false, specificOutcomes: true, teachingAids: false,
          homework: false, exercises: true, reflection: false,
        },
      },
    },
  })
  assert(JSON.stringify(lines) === JSON.stringify(again), 'output is deterministic')
}

console.log('\npreferredDifficulty')
{
  const profile = {
    teacherPreferences: { ai: { homeworkDifficulty: 'easy', assessmentDifficulty: 'hard' } },
  }
  assert(preferredDifficulty(profile, 'homework') === 'easy', 'homework difficulty')
  assert(preferredDifficulty(profile, 'assessment') === 'hard', 'assessment difficulty')
  assert(preferredDifficulty(null, 'assessment') === 'mixed', 'unset → mixed')
  assert(
    preferredDifficulty({ teacherPreferences: { ai: { assessmentDifficulty: 'impossible' } } }, 'assessment') === 'mixed',
    'unknown stored value → mixed',
  )
  assert(
    preferredDifficulty(
      { teacherPreferences: { ai: { rememberLastUsed: false, assessmentDifficulty: 'hard' } } },
      'assessment',
    ) === 'mixed',
    'memory off → difficulty falls back to mixed',
  )
}

console.log('\nteachingCounts')
{
  const counts = teachingCounts({
    teaching: { grades: ['G5', 'G6'], subjects: ['mathematics', 'english', 'integrated_science'], streams: ['5A', '5B', '6A'] },
  })
  assert(counts.classes === 3, 'streams count as classes when present')
  assert(counts.subjects === 3, 'subject count')

  const noStreams = teachingCounts({ teaching: { grades: ['G5', 'G6'], subjects: [] } })
  assert(noStreams.classes === 2, 'falls back to grades when no streams')
  assert(teachingCounts(null).classes === 0, 'no profile → zero')
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('✓ all teacher-defaults tests passed')
