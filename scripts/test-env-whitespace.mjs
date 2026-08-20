/**
 * Guard: no VITE_* value may carry surrounding whitespace, and the runtime
 * trim that protects against one must stay wired.
 *
 * Behind this: a production build shipped with a trailing newline in
 * VITE_FIREBASE_API_KEY. Firebase Auth keys its persisted session by the API
 * key, so every session created during that build's lifetime was written under
 * `firebase:authUser:<key>\n:[DEFAULT]` and has been unreachable to every build
 * since. Nothing failed loudly — the key still worked; the users just appeared
 * to be signed out for no reason.
 *
 * Two halves, because either alone is defeatable:
 *   1. TEXT — every VITE_FIREBASE_* read in config.js goes through envValue().
 *      A behavioural test cannot see this (config.js imports the Firebase SDK
 *      and will not load under plain node), and deleting the trim is exactly
 *      how the bug returns.
 *   2. DATA — no committed dotenv file carries a whitespace-bearing VITE_*
 *      value. The trim is a safety net, not a licence to ship a malformed one.
 *
 * NOTE ON REACH: production values come from CI secrets, not a file, so half 2
 * cannot see the value that actually caused the incident. The runtime trim is
 * the real defence; this test is what keeps it in place.
 *
 * Run: node scripts/test-env-whitespace.mjs  (npm run test:env-whitespace)
 */
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envValue, hasSurroundingWhitespace } from '../src/firebase/envValue.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
const ok = (name, cond) => { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`) }

console.log('\nenvValue — trims, and distinguishes blank from absent')
ok('a trailing newline is stripped', envValue('AIzaSyABC\n') === 'AIzaSyABC')
ok('a leading space is stripped', envValue('  AIzaSyABC') === 'AIzaSyABC')
ok('an interior space is preserved', envValue(' a b ') === 'a b')
ok('a clean value is unchanged', envValue('AIzaSyABC') === 'AIzaSyABC')
ok('whitespace-only becomes undefined', envValue('   ') === undefined)
ok('empty becomes undefined', envValue('') === undefined)
ok('absent stays undefined', envValue(undefined) === undefined)
ok('null becomes undefined', envValue(null) === undefined)
ok('detects surrounding whitespace', hasSurroundingWhitespace('x\n') === true)
ok('and does not flag a clean value', hasSurroundingWhitespace('x') === false)

console.log('\nconfig.js — every VITE_FIREBASE_* read is trimmed')
const config = readFileSync(join(root, 'src/firebase/config.js'), 'utf8')
const reads = [...config.matchAll(/import\.meta\.env\.(VITE_FIREBASE_[A-Z0-9_]+)/g)]
ok('config.js reads at least one VITE_FIREBASE_* value', reads.length > 0)
const untrimmed = reads.filter((m) => {
  const before = config.slice(Math.max(0, m.index - 40), m.index)
  return !before.includes('envValue(')
}).map((m) => m[1])
ok(
  `all ${reads.length} VITE_FIREBASE_* reads go through envValue()`
    + (untrimmed.length ? ` — untrimmed: ${untrimmed.join(', ')}` : ''),
  untrimmed.length === 0,
)

console.log('\ncommitted dotenv files — no whitespace-bearing VITE_* values')
const envFiles = readdirSync(root).filter((f) => f.startsWith('.env'))
ok('there is at least one dotenv file to check', envFiles.length > 0)
let checked = 0
for (const file of envFiles) {
  for (const raw of readFileSync(join(root, file), 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.startsWith('VITE_')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq)
    // The line's own trailing newline is the separator, not part of the value;
    // what matters is whitespace INSIDE the assignment.
    const value = line.slice(eq + 1)
    checked += 1
    ok(`${file}: ${key} has no surrounding whitespace`, !hasSurroundingWhitespace(value))
  }
}
ok(`checked ${checked} VITE_* assignments across ${envFiles.length} file(s)`, checked > 0)

console.log(`\n✓ env-whitespace: ${passed} assertions passed`)
