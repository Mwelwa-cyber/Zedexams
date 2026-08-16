/**
 * Guards the path set that decides which `papers/` blobs are ORPHANS.
 *
 * scripts/audit-storage.mjs deletes orphans when run with
 * `--orphans --delete`, and a blob is an orphan precisely when no live
 * pastPapers doc claims it. So a path this function fails to return is a real
 * file destroyed — not a reporting inaccuracy.
 *
 * It shipped that way: the collector read `pdfPath` and `markSchemePath` only,
 * via a `.select()` projection, and never read `assets[]` — the array holding
 * every page of every SCANNED paper, which is the bulk of the archive and the
 * bulk of the bucket. `--min-age-days` is no backstop; it spares blobs younger
 * than a week and the archive is years old.
 *
 * Run: node scripts/test-paper-storage-paths.mjs
 */

import assert from 'node:assert'
import { paperStoragePaths } from './lib/paperStoragePaths.mjs'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('paper-storage-paths')

// ── the bug that shipped ────────────────────────────────────────────────────
const scanned = paperStoragePaths({
  assets: [
    { path: 'papers/admin1/p1/assets/0-page1.jpg' },
    { path: 'papers/admin1/p1/assets/1-page2.jpg' },
    { path: 'papers/admin1/p1/assets/2-page3.jpg' },
  ],
})
ok('every scanned page is claimed', scanned.paths.length === 3)
ok('a scanned page path is returned verbatim',
   scanned.paths.includes('papers/admin1/p1/assets/1-page2.jpg'))
ok('a well-formed asset list reports nothing unreadable', scanned.unreadable === 0)

// ── the shapes that coexist on real documents ───────────────────────────────
const both = paperStoragePaths({
  pdfPath: 'papers/admin1/p2/paper-x.pdf',
  markSchemePath: 'papers/admin1/p2/mark-scheme-x.pdf',
  assets: [{ path: 'papers/admin1/p2/assets/0-a.jpg' }],
})
ok('a paper can hold BOTH a pdf and assets', both.paths.length === 3)
ok('the pdf is still claimed', both.paths.includes('papers/admin1/p2/paper-x.pdf'))
ok('the mark scheme is still claimed',
   both.paths.includes('papers/admin1/p2/mark-scheme-x.pdf'))

// Pre-role-split rows used `storagePath`. Dropping support silently would
// re-open the same hole for the oldest — most irreplaceable — papers.
const legacy = paperStoragePaths({ assets: [{ storagePath: 'papers/a/p/assets/0-old.jpg' }] })
ok('the legacy storagePath shape is still claimed',
   legacy.paths.includes('papers/a/p/assets/0-old.jpg'))

// ── an entry we cannot parse must be COUNTED, never skipped ─────────────────
// Skipping it silently is the original bug in miniature: the blob drops out of
// the live set and becomes a deletion candidate with nobody told.
const broken = paperStoragePaths({
  assets: [{ path: 'papers/a/p/assets/0-ok.jpg' }, { role: 'paper' }, null],
})
ok('a parseable sibling is still claimed', broken.paths.length === 1)
ok('unparseable entries are counted, not dropped', broken.unreadable === 2)

// ── degenerate input must not throw mid-audit ───────────────────────────────
ok('a doc with no file fields yields nothing', paperStoragePaths({}).paths.length === 0)
ok('a null doc is empty rather than a crash', paperStoragePaths(null).paths.length === 0)
ok('a non-object doc is empty rather than a crash',
   paperStoragePaths('nonsense').paths.length === 0)
ok('assets that is not an array is ignored safely',
   paperStoragePaths({ assets: 'nope' }).paths.length === 0)

// ── the collector must never invent a path ──────────────────────────────────
// A fabricated path is harmless here (it just protects a blob that does not
// exist), but a non-string one would poison the Set membership test that
// decides deletion.
ok('every returned path is a string',
   both.paths.every((p) => typeof p === 'string'))

console.log(`\n─── paper-storage-paths · ${passed} passed ───`)
