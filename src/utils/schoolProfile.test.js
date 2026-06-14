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
    schoolLogoUrl: ' https://x/logo.jpg ',
    schoolLogoTransform: { width: 120 },
    defaultDuration: '90',
    defaultCoverInstructions: 'Answer ALL questions.',
  })
  assert(n.schoolName === 'Twatasha Primary', 'trims school name')
  assert(n.schoolLogoUrl === 'https://x/logo.jpg', 'trims logo url')
  assert(n.schoolLogoTransform && n.schoolLogoTransform.width === 120, 'keeps transform object')
  assert(n.defaultDuration === 90, 'coerces numeric duration string')
  assert(n.defaultCoverInstructions === 'Answer ALL questions.', 'keeps instructions')

  const blank = normalizeSchoolProfile(undefined)
  assert(blank.schoolName === '' && blank.schoolLogoUrl === '', 'undefined → blank strings')
  assert(blank.defaultDuration === null && blank.schoolLogoTransform === null, 'undefined → null numerics/objects')
  assert(normalizeSchoolProfile({ defaultDuration: -5 }).defaultDuration === null, 'non-positive duration → null')
  assert(normalizeSchoolProfile({ defaultDuration: 'abc' }).defaultDuration === null, 'non-numeric duration → null')
  assert(normalizeSchoolProfile({ schoolLogoTransform: 'x' }).schoolLogoTransform === null, 'non-object transform → null')
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
  const fresh = { schoolName: '', schoolLogoUrl: '', schoolLogoTransform: null, duration: 60, coverInstructions: '' }
  const profile = {
    schoolName: 'Twatasha Primary',
    schoolLogoUrl: 'https://x/logo.jpg',
    schoolLogoTransform: { width: 140 },
    defaultDuration: 90,
    defaultCoverInstructions: 'Write your name.\nAnswer ALL questions.',
  }
  const out = applySchoolProfileDefaults(fresh, profile)
  assert(out.schoolName === 'Twatasha Primary', 'seeds school name')
  assert(out.schoolLogoUrl === 'https://x/logo.jpg', 'seeds logo url')
  assert(out.schoolLogoTransform.width === 140, 'seeds logo transform')
  assert(out.duration === 90, 'profile duration overrides the system default 60')
  assert(out.coverInstructions.startsWith('Write your name.'), 'seeds cover instructions')

  // No profile → form unchanged.
  const same = applySchoolProfileDefaults(fresh, null)
  assert(same === fresh, 'null profile returns the form untouched')

  // Profile with blanks → keep the form's existing values, never wipe them.
  const partial = applySchoolProfileDefaults(
    { schoolName: 'Kept', duration: 45, coverInstructions: 'Keep me', schoolLogoUrl: '' },
    { schoolName: '', defaultDuration: null, defaultCoverInstructions: '' },
  )
  assert(partial.schoolName === 'Kept', 'blank profile name does not wipe form name')
  assert(partial.duration === 45, 'blank profile duration keeps form duration')
  assert(partial.coverInstructions === 'Keep me', 'blank profile instructions keep form instructions')
}

console.log('\nbrandingForAiPaper — form wins, then profile, then recent papers')
{
  const profile = { schoolName: 'Profile School', schoolLogoUrl: 'p-logo.jpg' }
  const recent = { schoolName: 'Recent School', schoolLogoUrl: 'r-logo.jpg' }

  // Teacher already typed a name on the paper → keep it.
  const a = brandingForAiPaper({ schoolName: 'Typed', schoolLogoUrl: '' }, profile, recent)
  assert(a.schoolName === 'Typed', 'form name wins when set')
  assert(a.schoolLogoUrl === 'p-logo.jpg', 'blank logo falls back to profile')

  // No profile → fall back to recent-paper branding.
  const b = brandingForAiPaper({ schoolName: '', schoolLogoUrl: '' }, null, recent)
  assert(b.schoolName === 'Recent School', 'recent name used when no profile')
  assert(b.schoolLogoUrl === 'r-logo.jpg', 'recent logo used when no profile')

  // Nothing anywhere → blank strings, never undefined.
  const c = brandingForAiPaper({}, null, null)
  assert(c.schoolName === '' && c.schoolLogoUrl === '', 'empty everywhere → blanks')
  assert(c.schoolLogoTransform === null, 'transform defaults to null')
}

console.log('\nbrandingFromPapers — newest-first migration source')
{
  const papers = [
    { schoolName: '', schoolLogoUrl: '', duration: 0 },          // newest, blank
    { schoolName: 'Newer School', schoolLogoUrl: '', duration: 90 },
    { schoolName: 'Older School', schoolLogoUrl: 'old-logo.jpg', duration: 60 },
  ]
  const b = brandingFromPapers(papers)
  assert(b.schoolName === 'Newer School', 'picks most-recent non-blank name')
  assert(b.schoolLogoUrl === 'old-logo.jpg', 'picks most-recent non-blank logo')
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
