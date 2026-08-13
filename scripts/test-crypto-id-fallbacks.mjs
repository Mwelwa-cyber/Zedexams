// scripts/test-crypto-id-fallbacks.mjs
//
// The id minters that were moved off Math.random (#2318) each fall back in
// three tiers: crypto.randomUUID → crypto.getRandomValues → no Web Crypto at
// all. The third tier is the one that bites, because the obvious spelling of
// it is silently wrong:
//
//     const bytes = crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(3))
//                                           : new Uint8Array(3)   // ← zeroes
//
// An un-filled Uint8Array is all zeroes, so the "random" suffix is the
// constant `000000` and every id minted in the same millisecond is identical
// while still LOOKING random. That is strictly worse than the Math.random it
// replaced, which was at least unique — weak randomness became silent
// duplicate-identity corruption.
//
// Two checks, because neither catches the other's failure:
//   1. Behavioural, in a child process with no `crypto` global at all — the
//      only honest way to exercise tier 3, since this process has one.
//   2. A source scan, for the minters that cannot be imported bare (Firebase
//      and React imports), where behaviour cannot be reached from a script.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

console.log('\ncrypto id fallbacks')

// ── 1. Behavioural: no Web Crypto at all ────────────────────────────────────
// Run in a child so deleting the global cannot leak into the rest of the suite.
test('blankStudyBlocks() mints distinct ids with no Web Crypto', () => {
  const child = `
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    const { blankStudyBlocks } = await import('./src/features/notes/lib/studyBlocks.js')
    const ids = blankStudyBlocks().map(b => b.id)
    process.stdout.write(JSON.stringify({ total: ids.length, unique: new Set(ids).size }))
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', child], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  const { total, unique } = JSON.parse(out)
  assert.ok(total >= 2, `expected several default blocks, got ${total}`)
  assert.strictEqual(
    unique,
    total,
    `blankStudyBlocks() produced ${unique} distinct ids across ${total} blocks — ` +
      'the no-crypto fallback is contributing a constant, so these ids collide as React keys',
  )
})

// ── 2. Source scan: the minters a script cannot import ──────────────────────
// `classRoster.js` pulls in Firebase and `AdminNoteEditor.jsx` is a React page,
// so tier 3 is unreachable from here. Assert the shape instead: a
// `new Uint8Array(n)` that is NOT the argument to getRandomValues is a
// zero-filled buffer being read as if it held entropy.
const MINTERS = [
  'src/utils/classRoster.js',
  'src/utils/visitorId.js',
  'src/features/notes/lib/studyBlocks.js',
  'src/features/notes/pages/AdminNoteEditor.jsx',
]

for (const file of MINTERS) {
  test(`${file} never reads an un-filled Uint8Array`, () => {
    const src = readFileSync(file, 'utf8')
    const offenders = []
    // Every `new Uint8Array(...)` occurrence, checked for an enclosing
    // getRandomValues( on the same line — the only legitimate use here.
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trim()
      // Prose describing the bug names the offending expression — this very
      // file's fix comments do. Skip comment lines or the guard flags the
      // explanation of what it is guarding against.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (!line.includes('new Uint8Array(')) return
      if (line.includes('getRandomValues(new Uint8Array(')) return
      offenders.push(`${i + 1}: ${trimmed}`)
    })
    assert.deepStrictEqual(
      offenders,
      [],
      'un-filled Uint8Array read as entropy — it is all zeroes, so the id suffix ' +
        `is a constant:\n      ${offenders.join('\n      ')}`,
    )
  })
}

if (process.exitCode) {
  console.error('\n✗ crypto id fallbacks — FAILED\n')
} else {
  console.log(`\n✓ crypto id fallbacks — ${passed} tests passed\n`)
}
