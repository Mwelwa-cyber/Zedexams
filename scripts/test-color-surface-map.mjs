/**
 * Every SURFACE pattern in scripts/audit-hardcoded-colors.mjs must still match
 * a real file.
 *
 * WHY THIS EXISTS
 * ---------------
 * That map decides which themed container each hard-coded colour renders
 * inside, which is what decides how it gets fixed. Its patterns are PATHS, and
 * the file's own comment already names the failure mode: *"A regex naming a
 * path that no longer exists matches nothing and drops the surface out of the
 * audit silently."*
 *
 * Knowing about a hazard is not the same as being protected from it. On
 * 2026-08-14 two migrations moved `src/components/games/` and the quiz runtime,
 * and the `.force-light-theme` row — which named both by path — silently
 * stopped matching anything at all. The audit kept running, kept printing a
 * total, and reported an entire learner surface as `other`. Nothing went red;
 * the first migration had already merged before a review bot noticed on the
 * second. That is the fifth path-classified ledger in Phase 4 to break this
 * way, and the first with no guard behind it.
 *
 * So the rule is mechanical now: a pattern that matches zero files is a FAILURE
 * rather than a quiet zero. The fix when this fires is to repoint the pattern
 * at where the code moved — never to delete the row, which would drop the
 * surface for good.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK
 * -------------------------------------
 * That every file lands in the RIGHT surface. A pattern can match something and
 * still be wrong, and no cheap check can tell "these ten files are the games
 * hub" from "these ten files are anything else". This catches the failure that
 * is both silent and total; misclassification is at least visible in the
 * audit's own output.
 *
 * Plain-node test, auto-discovered by scripts/run-all-tests.mjs.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT = 'scripts/audit-hardcoded-colors.mjs'
const source = readFileSync(join(root, AUDIT), 'utf8')

/* ── 1. Pull the SURFACE rows out of the audit ────────────────────────── */

const block = source.match(/const SURFACE = \[([\s\S]*?)\n\]/)
assert.ok(
  block,
  `could not find the SURFACE array in ${AUDIT}. If it was renamed or ` +
  'restructured, teach this guard about the new shape rather than deleting it — ' +
  'the whole point is that a surface cannot fall out of the audit unnoticed.',
)

// Each row is `[/regex/, 'label'],`. The regex may contain escaped slashes, so
// match up to the last `/` before the comma rather than the first.
const rows = [...block[1].matchAll(/^\s*\[(\/.*\/)\s*,\s*'([^']+)'\s*\],\s*$/gm)]
  .map(([, re, label]) => ({ label, re: new RegExp(re.slice(1, -1)) }))

assert.ok(
  rows.length >= 6,
  `parsed only ${rows.length} SURFACE rows from ${AUDIT}; the file has more. ` +
  'The parser has drifted — fix it, because a row this guard cannot see is a ' +
  'row it cannot protect.',
)

/* ── 2. Every pattern must match at least one file that exists ────────── */

const EXTS = ['.js', '.jsx', '.css']
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(relative(root, full).split('\\').join('/'))
  }
  return out
}
const files = walk(join(root, 'src'))

const dead = rows.filter(({ re }) => !files.some((f) => re.test(f)))
assert.equal(
  dead.length, 0,
  'SURFACE pattern(s) in ' + AUDIT + ' match no file on disk:\n' +
  dead.map(({ label, re }) => `  ${re}  →  '${label}'`).join('\n') +
  '\n\nThe code they classify moved. REPOINT the pattern at its new path — do ' +
  'not delete the row, or that surface leaves the audit permanently and its ' +
  "hard-coded colours are reported as 'other'.",
)

/* ── 3. The guard must be able to fail ────────────────────────────────── */

// A guard whose failure path is never exercised is a guard nobody has seen
// work. This is the same reasoning test:paper-golden applies to its leak check.
const impossible = /^src\/components\/thisDirectoryDoesNotExist\//
assert.ok(
  !files.some((f) => impossible.test(f)),
  'the negative control matched a real file — rename the probe directory',
)

console.log(
  `✓ colour-audit surface map — ${rows.length} patterns, all matching real files ` +
  `(${files.length} scanned)`,
)
