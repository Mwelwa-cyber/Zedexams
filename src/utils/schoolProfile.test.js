/**
 * Tests for the pure School Profile helpers (no Firebase).
 *
 * Run: node src/utils/schoolProfile.test.js
 */

import {
  normalizeSchoolProfile,
  isEmptySchoolProfile,
  applySchoolProfileDefaults,
  brandingForAiPaper,
  brandingFromPapers,
} from './schoolProfile.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('normalizeSchoolProfile')
{
  const n = normalizeSchoolProfile({
    schoolName: '  Twatasha Primary  ',
    defaultDuration: '90',
    defaultCoverInstructions: 'Answer ALL questions.',
  })
  assert(n.schoolName === 'Twatasha Primary', 'trims school name')
  assert(n.schoolLogoUrl === undefined, 'no logo url in normalised shape')
  assert(n.defaultDuration === 90, 'coerces numeric duration string')
  assert(n.defaultCoverInstructions === 'Answer ALL questions.', 'keeps instructions')

  const blank = normalizeSchoolProfile(undefined)
  assert(blank.schoolName === '', 'undefined → blank strings')
  assert(blank.defaultDuration === null, 'undefined → null numerics')
  assert(normalizeSchoolProfile({ defaultDuration: -5 }).defaultDuration === null, 'non-positive duration → null')
  assert(normalizeSchoolProfile({ defaultDuration: 'abc' }).defaultDuration === null, 'non-numeric duration → null')
  assert(normalizeSchoolProfile({ schoolName: 'a'.repeat(500) }).schoolName.length === 200, 'caps name length')
}

console.log('\nisEmptySchoolProfile')
{
  assert(isEmptySchoolProfile(null) === true, 'null is empty')
  assert(isEmptySchoolProfile({}) === true, 'blank object is empty')
  assert(isEmptySchoolProfile({ schoolName: 'X' }) === false, 'name makes it non-empty')
  assert(isEmptySchoolProfile({ defaultDuration: 60 }) === false, 'duration makes it non-empty')
}

console.log('\napplySchoolProfileDefaults — profile wins on a fresh paper')
{
  const fresh = { schoolName: '', duration: 60, coverInstructions: '' }
  const profile = {
    schoolName: 'Twatasha Primary',
    defaultDuration: 90,
    defaultCoverInstructions: 'Write your name.\nAnswer ALL questions.',
  }
  const out = applySchoolProfileDefaults(fresh, profile)
  assert(out.schoolName === 'Twatasha Primary', 'seeds school name')
  assert(out.duration === 90, 'profile duration overrides the system default 60')
  assert(out.coverInstructions.startsWith('Write your name.'), 'seeds cover instructions')

  // No profile → form unchanged.
  const same = applySchoolProfileDefaults(fresh, null)
  assert(same === fresh, 'null profile returns the form untouched')

  // Profile with blanks → keep the form's existing values, never wipe them.
  const partial = applySchoolProfileDefaults(
    { schoolName: 'Kept', duration: 45, coverInstructions: 'Keep me' },
    { schoolName: '', defaultDuration: null, defaultCoverInstructions: '' },
  )
  assert(partial.schoolName === 'Kept', 'blank profile name does not wipe form name')
  assert(partial.duration === 45, 'blank profile duration keeps form duration')
  assert(partial.coverInstructions === 'Keep me', 'blank profile instructions keep form instructions')
}

console.log('\nbrandingForAiPaper — form wins, then profile, then recent papers')
{
  const profile = { schoolName: 'Profile School' }
  const recent = { schoolName: 'Recent School' }

  // Teacher already typed a name on the paper → keep it.
  const a = brandingForAiPaper({ schoolName: 'Typed' }, profile, recent)
  assert(a.schoolName === 'Typed', 'form name wins when set')

  // Blank form name → fall back to profile.
  const a2 = brandingForAiPaper({ schoolName: '' }, profile, recent)
  assert(a2.schoolName === 'Profile School', 'blank name falls back to profile')

  // No profile → fall back to recent-paper branding.
  const b = brandingForAiPaper({ schoolName: '' }, null, recent)
  assert(b.schoolName === 'Recent School', 'recent name used when no profile')

  // Nothing anywhere → blank string, never undefined.
  const c = brandingForAiPaper({}, null, null)
  assert(c.schoolName === '', 'empty everywhere → blank')
}

console.log('\nbrandingFromPapers — newest-first migration source')
{
  const papers = [
    { schoolName: '', duration: 0 },          // newest, blank
    { schoolName: 'Newer School', duration: 90 },
    { schoolName: 'Older School', duration: 60 },
  ]
  const b = brandingFromPapers(papers)
  assert(b.schoolName === 'Newer School', 'picks most-recent non-blank name')
  assert(b.defaultDuration === 90, 'picks most-recent positive duration')

  assert(brandingFromPapers([]) === null, 'no papers → null')
  assert(brandingFromPapers([{ duration: 60 }]) === null, 'duration-only papers → null (no brand)')
}

console.log('')
if (failures > 0) {
  console.error(`✗ ${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('✓ all school-profile helper tests passed')
