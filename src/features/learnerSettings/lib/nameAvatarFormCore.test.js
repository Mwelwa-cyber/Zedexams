/**
 * Name & avatar form rules. The one worth reading twice is
 * "type and undo returns to clean" — a dirty FLAG cannot do that, only a
 * comparison against what is stored, and a Save bar that stays lit after the
 * child has restored the value is the bug this whole module exists to prevent.
 *
 * Run: npm run test:name-avatar-form
 */

import assert from 'node:assert/strict'

import {
  normaliseName,
  firstWordOf,
  previewName,
  formFromProfile,
  dirtyPatch,
  isDirty,
  canSave,
  avatarSelection,
} from './nameAvatarFormCore.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const profile = {
  displayName: 'Lydia Banda',
  preferredName: 'Lydia',
  avatarCharacter: 'questioner',
  avatarPhotoUrl: '',
  grade: 7,
  role: 'learner',
}

/* ── Normalising ─────────────────────────────────────────────────────────── */

test('names are trimmed and inner whitespace collapsed', () => {
  assert.equal(normaliseName('  Lydia   Banda '), 'Lydia Banda')
  assert.equal(normaliseName('\tLydia\n'), 'Lydia')
  assert.equal(normaliseName(''), '')
  assert.equal(normaliseName(null), '')
  assert.equal(normaliseName(undefined), '')
  assert.equal(normaliseName(42), '42')
})

test('firstWordOf takes only the first word', () => {
  assert.equal(firstWordOf('Lydia Banda'), 'Lydia')
  assert.equal(firstWordOf('  Chanda  '), 'Chanda')
  assert.equal(firstWordOf(''), '')
})

/* ── The public name ─────────────────────────────────────────────────────── */

test('the preview shows the preferred name when there is one', () => {
  assert.equal(previewName({ preferredName: 'Lydie', displayName: 'Lydia Banda' }), 'Lydie')
})

test('with no preferred name it shows the FIRST name, never the surname', () => {
  const shown = previewName({ preferredName: '', displayName: 'Lydia Banda' })
  assert.equal(shown, 'Lydia')
  assert.ok(!shown.includes('Banda'), 'a leaderboard row must not carry a surname')
})

test('with nothing at all the preview still has a name', () => {
  assert.equal(previewName({}), 'You')
  assert.equal(previewName(null), 'You')
  assert.equal(previewName({ preferredName: '   ', displayName: '  ' }), 'You')
})

/* ── Dirty ───────────────────────────────────────────────────────────────── */

test('a freshly loaded form is clean', () => {
  const baseline = formFromProfile(profile)
  assert.equal(isDirty(baseline, { ...baseline }), false)
  assert.deepEqual(dirtyPatch(baseline, { ...baseline }), {})
})

test('a form built from an empty profile is clean, not dirty', () => {
  const baseline = formFromProfile(null)
  assert.equal(isDirty(baseline, { ...baseline }), false)
})

test('changing one field makes only that field dirty', () => {
  const baseline = formFromProfile(profile)
  const patch = dirtyPatch(baseline, { ...baseline, preferredName: 'Lydie' })
  assert.deepEqual(patch, { preferredName: 'Lydie' })
})

test('typing and undoing returns the form to clean', () => {
  const baseline = formFromProfile(profile)
  let form = { ...baseline, preferredName: 'Lydiaa' }
  assert.equal(isDirty(baseline, form), true)
  form = { ...form, preferredName: 'Lydia' }
  assert.equal(isDirty(baseline, form), false, 'restoring the stored value must clear the save bar')
})

test('trailing whitespace alone is not a change', () => {
  const baseline = formFromProfile(profile)
  assert.equal(isDirty(baseline, { ...baseline, preferredName: 'Lydia  ' }), false)
  assert.equal(isDirty(baseline, { ...baseline, displayName: '  Lydia Banda' }), false)
})

test('the patch it produces is normalised, so the write is clean too', () => {
  const baseline = formFromProfile(profile)
  const patch = dirtyPatch(baseline, { ...baseline, displayName: '  Lydia   Mwansa  ' })
  assert.deepEqual(patch, { displayName: 'Lydia Mwansa' })
})

test('a photo data URL is compared raw, never trimmed', () => {
  const baseline = formFromProfile({ ...profile, avatarCharacter: '', avatarPhotoUrl: 'data:image/png;base64,AAA' })
  assert.equal(isDirty(baseline, { ...baseline }), false)
  const patch = dirtyPatch(baseline, { ...baseline, avatarPhotoUrl: 'data:image/png;base64,BBB' })
  assert.deepEqual(patch, { avatarPhotoUrl: 'data:image/png;base64,BBB' })
})

/* ── Save gating ─────────────────────────────────────────────────────────── */

test('save is inert until the form is dirty', () => {
  const baseline = formFromProfile(profile)
  assert.deepEqual(canSave(baseline, { ...baseline }), { ok: false, reason: 'clean' })
  assert.equal(canSave(baseline, { ...baseline, preferredName: 'Lydie' }).ok, true)
})

test('save is inert while a save is already running', () => {
  const baseline = formFromProfile(profile)
  const dirty = { ...baseline, preferredName: 'Lydie' }
  assert.deepEqual(canSave(baseline, dirty, { saving: true }), { ok: false, reason: 'saving' })
})

test('a full name is required, a preferred name is not', () => {
  const baseline = formFromProfile(profile)
  const noFull = canSave(baseline, { ...baseline, displayName: '   ' })
  assert.equal(noFull.ok, false)
  assert.match(noFull.reason, /full name/i)
  assert.equal(canSave(baseline, { ...baseline, preferredName: '' }).ok, true)
})

test('absurd lengths are refused with a sentence a child can act on', () => {
  const baseline = formFromProfile(profile)
  const longFull = canSave(baseline, { ...baseline, displayName: 'x'.repeat(81) })
  assert.equal(longFull.ok, false)
  assert.match(longFull.reason, /too long/i)
  const longPref = canSave(baseline, { ...baseline, preferredName: 'y'.repeat(25) })
  assert.equal(longPref.ok, false)
  assert.match(longPref.reason, /shorter/i)
  assert.equal(canSave(baseline, { ...baseline, preferredName: 'y'.repeat(24) }).ok, true)
})

/* ── One face at a time ──────────────────────────────────────────────────── */

test('picking a character clears any uploaded photo', () => {
  assert.deepEqual(avatarSelection('character', 'eagle'), {
    avatarCharacter: 'eagle', avatarPhotoUrl: '',
  })
})

test('uploading a photo clears the chosen character', () => {
  assert.deepEqual(avatarSelection('photo', 'data:image/png;base64,AAA'), {
    avatarCharacter: '', avatarPhotoUrl: 'data:image/png;base64,AAA',
  })
})

test('clearing removes both, so no surface can show a stale face', () => {
  assert.deepEqual(avatarSelection('none'), { avatarCharacter: '', avatarPhotoUrl: '' })
})

/* ── Runner ──────────────────────────────────────────────────────────────── */

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}
console.log(`\nname & avatar form: ${tests.length - failed}/${tests.length} passed`)
if (failed) {
  throw new Error(`${failed} name-avatar-form test(s) failed`)
}
