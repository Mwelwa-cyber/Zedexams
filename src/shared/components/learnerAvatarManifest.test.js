/**
 * The avatar manifest is data in two places on purpose — the delivered
 * `public/images/avatars/avatars.manifest.json` (the artwork's own record, which
 * arrives and is replaced with the art) and `learnerAvatarManifest.js` (the same
 * data in a form Vite and plain `node` both import without JSON-import
 * attributes). Two copies of anything drift, so this is the thing that stops it:
 * the module must equal the JSON field for field, every `file` must be a PNG
 * that exists, and every id the old sprite sheet could have written onto a live
 * profile must still resolve to a face.
 *
 * That last one is the reason this file is worth its length. The surfaces that
 * show an avatar (`LearnerHeader`, `Navbar`, the profile page) branch on the
 * profile field being TRUTHY, then hand the value here — so an id this module
 * cannot place does not fall back to an initial, it renders an empty circle.
 * A partial legacy map would therefore blank the avatar of every learner who
 * picked one before the art changed, silently, with no error anywhere.
 *
 * Run: npm run test:learner-avatars
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  AVATAR_MANIFEST,
  AVATARS,
  AVATAR_GROUPS,
  AVATAR_BASE,
  LEGACY_AVATAR_IDS,
  resolveAvatarId,
  getAvatar,
  avatarSrc,
  groupForGrade,
  groupsForGrade,
  avatarsInGroup,
} from './learnerAvatarManifest.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')
const ART_DIR = join(REPO, 'public', 'images', 'avatars')
const JSON_PATH = join(ART_DIR, 'avatars.manifest.json')

const tests = []
const test = (name, fn) => tests.push([name, fn])

/* ── The module and the delivered JSON are the same manifest ─────────────── */

test('the module matches the shipped avatars.manifest.json exactly', () => {
  const shipped = JSON.parse(readFileSync(JSON_PATH, 'utf8'))
  assert.deepEqual(
    JSON.parse(JSON.stringify(AVATAR_MANIFEST)),
    shipped,
    'learnerAvatarManifest.js and public/images/avatars/avatars.manifest.json disagree — ' +
    'edit both, or the picker will describe art that is not there',
  )
})

test('every avatar file exists on disk', () => {
  for (const avatar of AVATARS) {
    const path = join(ART_DIR, avatar.file.replace(/^avatars\//, ''))
    assert.ok(existsSync(path), `missing artwork for "${avatar.id}": ${path}`)
  }
})

test('avatarSrc builds a served path under the public base', () => {
  for (const avatar of AVATARS) {
    const src = avatarSrc(avatar)
    assert.ok(src.startsWith(AVATAR_BASE), `${avatar.id} -> ${src}`)
    assert.ok(src.endsWith('.png'), `${avatar.id} -> ${src}`)
    assert.ok(!src.includes('avatars/avatars/'), `doubled segment: ${src}`)
  }
  assert.equal(avatarSrc(null), null)
  assert.equal(avatarSrc({}), null)
})

/* ── Shape ───────────────────────────────────────────────────────────────── */

test('ids are unique and every avatar belongs to a declared group', () => {
  const ids = AVATARS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate avatar id')
  const groupIds = new Set(AVATAR_GROUPS.map((g) => g.id))
  for (const a of AVATARS) {
    assert.ok(groupIds.has(a.group), `"${a.id}" is in unknown group "${a.group}"`)
  }
  for (const g of AVATAR_GROUPS) {
    assert.ok(avatarsInGroup(g.id).length > 0, `group "${g.id}" has no avatars`)
  }
})

test('every avatar has a real name, never a file-order label', () => {
  for (const a of AVATARS) {
    assert.ok(a.name && a.name.trim().length >= 3, `"${a.id}" has no usable name`)
    assert.ok(
      !/^\d+[.)]/.test(a.name.trim()),
      `"${a.id}" is named "${a.name}" — children pick by personality, not by number`,
    )
  }
})

test('no grade is claimed by two groups', () => {
  const seen = new Map()
  for (const g of AVATAR_GROUPS) {
    for (const grade of g.grades) {
      assert.ok(!seen.has(grade), `grade ${grade} is in both "${seen.get(grade)}" and "${g.id}"`)
      seen.set(grade, g.id)
    }
  }
})

/* ── Legacy ids: total, fixed, and never a wrong face ────────────────────── */

// The sixteen ids the retired sprite sheet wrote onto profiles. Frozen here
// rather than imported, because the source of truth for what is IN THE FIELD is
// history, not the current code — deleting the old module must not shrink this.
const OLD_SPRITE_IDS = [
  'ruby', 'finn', 'mia', 'kai',
  'leo', 'aria', 'theo', 'ella',
  'sam', 'lily', 'zoe', 'max',
  'nia', 'eli', 'jude', 'tara',
]

test('every id the old sprite sheet could have stored still resolves', () => {
  const known = new Set(AVATARS.map((a) => a.id))
  for (const old of OLD_SPRITE_IDS) {
    const resolved = resolveAvatarId(old)
    assert.ok(resolved, `legacy id "${old}" resolves to nothing — that learner's avatar goes blank`)
    assert.ok(known.has(resolved), `legacy id "${old}" resolves to unknown "${resolved}"`)
    assert.ok(getAvatar(old)?.name, `legacy id "${old}" has no renderable record`)
  }
})

test('the legacy map covers exactly the old set and adds nothing', () => {
  assert.deepEqual(
    Object.keys(LEGACY_AVATAR_IDS).sort(),
    [...OLD_SPRITE_IDS].sort(),
    'the legacy map has drifted from the ids the old sprite sheet used',
  )
})

test('resolution is stable — the same old id always lands on the same face', () => {
  for (const old of OLD_SPRITE_IDS) {
    assert.equal(resolveAvatarId(old), resolveAvatarId(old))
    assert.equal(resolveAvatarId(old), LEGACY_AVATAR_IDS[old])
  }
})

test('an unknown id resolves to null rather than a default face', () => {
  for (const junk of ['', null, undefined, 'nope', '   ', 'QUESTIONER']) {
    assert.equal(resolveAvatarId(junk), null, `"${junk}" should not resolve`)
    assert.equal(getAvatar(junk), null)
  }
})

test('a current id resolves to itself', () => {
  for (const a of AVATARS) {
    assert.equal(resolveAvatarId(a.id), a.id)
    assert.equal(getAvatar(a.id).name, a.name)
  }
})

/* ── Group ordering: the learner's own group opens the picker ────────────── */

test('a grade opens on its own group', () => {
  assert.equal(groupForGrade(7), 'junior')
  assert.equal(groupForGrade('Grade 7'), 'junior')
  assert.equal(groupForGrade(4), 'junior')
  assert.equal(groupForGrade(9), 'junior')
  assert.equal(groupForGrade(10), 'senior')
  assert.equal(groupForGrade(12), 'senior')
  assert.equal(groupsForGrade(11)[0].id, 'senior')
  assert.equal(groupsForGrade(7)[0].id, 'junior')
})

test('an unknown grade opens on the first group, and still offers every one', () => {
  for (const grade of [null, undefined, '', 'nursery', 99]) {
    assert.equal(groupForGrade(grade), AVATAR_GROUPS[0].id, `grade ${grade}`)
    assert.equal(groupsForGrade(grade).length, AVATAR_GROUPS.length)
  }
})

test('reordering never drops a group — a learner may pick any avatar', () => {
  for (const grade of [4, 7, 10, 12, null]) {
    const ordered = groupsForGrade(grade)
    assert.deepEqual(
      ordered.map((g) => g.id).sort(),
      AVATAR_GROUPS.map((g) => g.id).sort(),
      `grade ${grade} lost a group`,
    )
  }
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
console.log(`\nlearner avatars: ${tests.length - failed}/${tests.length} passed`)
if (failed) {
  throw new Error(`${failed} learner-avatar test(s) failed`)
}
