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
  assert(n.schoolLogoUrl === '', 'missing logo url → blank string')
  assert(n.defaultDuration === 90, 'coerces numeric duration string')
  assert(n.defaultCoverInstructions === 'Answer ALL questions.', 'keeps instructions')

  const blank = normalizeSchoolProfile(undefined)
  assert(blank.schoolName === '', 'undefined → blank strings')
  assert(blank.defaultDuration === null, 'undefined → null numerics')
  assert(normalizeSchoolProfile({ defaultDuration: -5 }).defaultDuration === null, 'non-positive duration → null')
  assert(normalizeSchoolProfile({ defaultDuration: 'abc' }).defaultDuration === null, 'non-numeric duration → null')
  assert(normalizeSchoolProfile({ schoolName: 'a'.repeat(500) }).schoolName.length === 200, 'caps name length')
}

console.log('\nnormalizeSchoolProfile — school identity + branding fields')
{
  const n = normalizeSchoolProfile({
    emisNumber: ' 8012345 ',
    province: 'Lusaka',
    district: 'Chongwe',
    schoolType: 'government_primary',
    address: 'Plot 5, Great East Road',
    department: 'Sciences',
    motto: 'Knowledge is light',
    footerText: 'Generated with ZedExams',
    resourceLevel: 'basic',
    schoolLogoUrl: 'https://x/logo.png',
    schoolLogoPath: 'user-branding/u1/school-logo.png',
    teacherSignatureUrl: 'https://x/sig.png',
    schoolStampUrl: 'https://x/stamp.png',
    letterheadUrl: 'https://x/head.png',
  })
  assert(n.emisNumber === '8012345', 'trims EMIS number')
  assert(n.province === 'Lusaka', 'keeps province')
  assert(n.district === 'Chongwe', 'keeps district')
  assert(n.schoolType === 'government_primary', 'keeps school type')
  assert(n.motto === 'Knowledge is light', 'keeps motto')
  assert(n.resourceLevel === 'basic', 'keeps valid resource level')
  assert(n.schoolLogoUrl === 'https://x/logo.png', 'keeps logo url')
  assert(n.schoolLogoPath === 'user-branding/u1/school-logo.png', 'keeps logo path')
  assert(n.teacherSignatureUrl === 'https://x/sig.png', 'keeps signature url')
  assert(n.schoolStampUrl === 'https://x/stamp.png', 'keeps stamp url')
  assert(n.letterheadUrl === 'https://x/head.png', 'keeps letterhead url')

  assert(normalizeSchoolProfile({ resourceLevel: 'luxury' }).resourceLevel === '', 'unknown resource level → blank')
  assert(normalizeSchoolProfile({}).resourceLevel === '', 'missing resource level → blank (studios use own default)')
  assert(normalizeSchoolProfile({ motto: 'a'.repeat(400) }).motto.length === 160, 'caps motto length')
  assert(normalizeSchoolProfile({}).emisNumber === '', 'missing EMIS → blank')
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
    schoolLogoUrl: 'https://x/logo.png',
    motto: 'Knowledge is light',
    emisNumber: '8012345',
  }
  const out = applySchoolProfileDefaults(fresh, profile)
  assert(out.schoolName === 'Twatasha Primary', 'seeds school name')
  assert(out.duration === 90, 'profile duration overrides the system default 60')
  assert(out.coverInstructions.startsWith('Write your name.'), 'seeds cover instructions')
  assert(out.schoolLogoUrl === 'https://x/logo.png', 'seeds school logo url')
  assert(out.motto === 'Knowledge is light', 'seeds motto')
  assert(out.emisNumber === '8012345', 'seeds EMIS number')

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

  // Extended branding fields flow through with the same form-wins semantics.
  const d = brandingForAiPaper(
    { schoolName: '', motto: 'Typed motto' },
    { schoolName: 'Profile School', schoolLogoUrl: 'https://x/logo.png', motto: 'Profile motto' },
    null,
  )
  assert(d.schoolLogoUrl === 'https://x/logo.png', 'blank logo falls back to profile')
  assert(d.motto === 'Typed motto', 'typed motto wins over profile')
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
