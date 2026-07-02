/**
 * Tests for the pure Teacher Settings normalizers (no Firebase).
 *
 * Run: node src/utils/teacherSettingsCore.test.js
 */

import {
  normalizeTeacherProfile,
  normalizeTeaching,
  normalizeTeacherPreferences,
  normalizeAiPreferences,
  normalizeCurriculumDefaults,
  normalizeAdvancedPreferences,
  normalizeTimetable,
  timetableWeeklyLoad,
  PLAN_DETAIL_VALUES,
  MAX_PERIODS_PER_DAY,
} from './teacherSettingsCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('normalizeTeacherProfile')
{
  const p = normalizeTeacherProfile({
    phone: ' 097 1234567 ',
    tsNumber: 'TS/12345',
    qualification: 'diploma',
    yearsExperience: '12',
    languages: ['english', 'bemba', 'english', 'klingon'],
    bio: 'Passionate teacher.',
    photoUrl: 'https://x/y.webp',
  })
  assert(p.phone === '097 1234567', 'trims phone')
  assert(p.tsNumber === 'TS/12345', 'keeps TS number')
  assert(p.yearsExperience === 12, 'coerces numeric experience string')
  assert(p.languages.length === 2 && p.languages.includes('bemba'), 'dedupes + drops unknown languages')
  assert(p.photoUrl === 'https://x/y.webp', 'keeps photo url')

  const blank = normalizeTeacherProfile(undefined)
  assert(blank.phone === '' && blank.bio === '', 'undefined → blank strings')
  assert(blank.yearsExperience === null, 'undefined → null experience')
  assert(blank.languages.length === 0, 'undefined → empty languages')
  assert(normalizeTeacherProfile({ yearsExperience: -3 }).yearsExperience === null, 'negative experience → null')
  assert(normalizeTeacherProfile({ yearsExperience: 99 }).yearsExperience === null, 'out-of-range experience → null')
  assert(normalizeTeacherProfile({ bio: 'a'.repeat(2000) }).bio.length === 1000, 'caps bio length')
}

console.log('\nnormalizeTeaching')
{
  const t = normalizeTeaching({
    grades: ['G5', 'G6', 'G5'],
    subjects: ['mathematics', 'integrated_science'],
    streams: [' 5A ', '5B'],
    classTeacherOf: '5A',
    department: 'Sciences',
    weeklyLoadPeriods: '28',
  })
  assert(t.grades.length === 2, 'dedupes grades')
  assert(t.streams[0] === '5A', 'trims streams')
  assert(t.weeklyLoadPeriods === 28, 'coerces weekly load')

  const blank = normalizeTeaching(null)
  assert(Array.isArray(blank.grades) && blank.grades.length === 0, 'null → empty arrays')
  assert(blank.weeklyLoadPeriods === null, 'null → null weekly load')
  assert(normalizeTeaching({ weeklyLoadPeriods: 100 }).weeklyLoadPeriods === null, 'out-of-range load → null')
  assert(normalizeTeaching({ grades: 'G5' }).grades.length === 0, 'non-array grades → empty')
}

console.log('\nnormalizeTeacherPreferences')
{
  const prefs = normalizeTeacherPreferences({
    ai: {
      planDetail: 'detailed',
      teachingLanguage: 'nyanja',
      preferredEnglish: 'american',
      homeworkDifficulty: 'hard',
      include: { homework: false },
    },
    curriculum: { curriculum: 'previous', grade: 'G7', subject: 'mathematics', academicYear: '2026', term: 'Term 2' },
    advanced: { defaultDownloadFormat: 'both', autosave: false },
  })
  assert(prefs.ai.planDetail === 'detailed', 'keeps valid detail')
  assert(prefs.ai.teachingLanguage === 'nyanja', 'keeps valid language')
  assert(prefs.ai.preferredEnglish === 'american', 'keeps english variant')
  assert(prefs.ai.homeworkDifficulty === 'hard', 'keeps homework difficulty')
  assert(prefs.ai.assessmentDifficulty === 'mixed', 'missing assessment difficulty → mixed')
  assert(prefs.ai.include.homework === false, 'keeps explicit include=false')
  assert(prefs.ai.include.exercises === true, 'missing include flag → true')
  assert(prefs.curriculum.curriculum === 'previous', 'keeps previous curriculum')
  assert(prefs.curriculum.term === 'Term 2', 'keeps term')
  assert(prefs.advanced.defaultDownloadFormat === 'both', 'keeps export format')
  assert(prefs.advanced.autosave === false, 'keeps autosave=false')

  const blank = normalizeTeacherPreferences(undefined)
  assert(blank.ai.planDetail === 'standard', 'default detail = standard')
  assert(PLAN_DETAIL_VALUES.includes(blank.ai.planDetail), 'default detail is a studio value')
  assert(blank.ai.teachingLanguage === 'english', 'default language = english')
  assert(blank.ai.preferredEnglish === 'british', 'default english = british')
  assert(blank.ai.rememberLastUsed === true, 'default rememberLastUsed = true')
  assert(blank.curriculum.curriculum === 'cbc', 'default curriculum = cbc')
  assert(blank.curriculum.grade === '', 'default grade blank')
  assert(blank.advanced.defaultDownloadFormat === 'pdf', 'default export = pdf')

  assert(normalizeAiPreferences({ planDetail: 'ultra' }).planDetail === 'standard', 'unknown detail → standard')
  assert(normalizeAiPreferences({ teachingLanguage: 'french' }).teachingLanguage === 'english', 'unknown language → english')
  assert(normalizeCurriculumDefaults({ curriculum: 'ib' }).curriculum === 'cbc', 'unknown curriculum → cbc')
  assert(normalizeAdvancedPreferences({ defaultDownloadFormat: 'xls' }).defaultDownloadFormat === 'pdf', 'unknown format → pdf')
}

console.log('\nnormalizeTimetable')
{
  const t = normalizeTimetable({
    periodMinutes: '45',
    days: {
      mon: [
        { start: '08:00', end: '08:45', subject: 'mathematics', grade: 'G5' },
        { start: 'nope', end: '', subject: '', grade: '', label: '' }, // empty after cleaning → dropped
      ],
      tue: [{ subject: 'english', grade: 'G5' }],
      sat: [{ subject: 'club' }], // weekend ignored
    },
  })
  assert(t.periodMinutes === 45, 'coerces period minutes')
  assert(t.days.mon.length === 1, 'drops empty entries')
  assert(t.days.mon[0].start === '08:00', 'keeps valid start time')
  assert(t.days.tue.length === 1 && t.days.tue[0].start === '', 'invalid/missing time → blank')
  assert(t.days.wed.length === 0, 'missing day → empty list')
  assert(!('sat' in t.days), 'weekend days are not stored')

  const over = normalizeTimetable({
    days: { mon: Array.from({ length: 20 }, (_, i) => ({ subject: `s${i}` })) },
  })
  assert(over.days.mon.length === MAX_PERIODS_PER_DAY, 'caps periods per day')

  const blank = normalizeTimetable(undefined)
  assert(blank.periodMinutes === 40, 'default period = 40 min')
  assert(blank.days.fri.length === 0, 'blank timetable has empty days')
  assert(normalizeTimetable({ periodMinutes: 0 }).periodMinutes === 40, 'zero minutes → default')
}

console.log('\ntimetableWeeklyLoad')
{
  const load = timetableWeeklyLoad({
    days: {
      mon: [{ subject: 'a' }, { subject: 'b' }],
      wed: [{ subject: 'c' }],
    },
  })
  assert(load === 3, 'counts entries across the week')
  assert(timetableWeeklyLoad(undefined) === 0, 'blank timetable → 0')
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('✓ all teacher-settings core tests passed')
