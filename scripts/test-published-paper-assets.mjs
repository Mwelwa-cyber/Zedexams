#!/usr/bin/env node
/**
 * scripts/test-published-paper-assets.mjs  →  npm run test:published-paper-assets
 *
 * The guard that stops a published past paper from losing its last file.
 *
 * The bug: publish() refuses to go live with no assets, but handleRemoveAsset()
 * had no matching check, so removing the last file from a LIVE paper left it in
 * the archive with nothing to open. At least one paper reached that state in
 * production.
 *
 * The cases that matter here are the two that a naive `assets.length === 1`
 * check gets wrong, in opposite directions:
 *   - a legacy paper whose source is `pdfPath` is readable with assets empty,
 *     so its removals must NOT be blocked;
 *   - a paper whose last remaining asset is the mark scheme is blank, so that
 *     removal MUST be blocked even though the array is not about to be empty.
 */
import assert from 'node:assert/strict'
import {
  canRemovePaperAsset,
  hasReadablePaperSource,
  isPublishedWithoutReadableSource,
  paperRoleAssets,
  PUBLISHED_PAPER_NEEDS_A_FILE,
} from '../src/features/adminPastPapers/lib/publishedPaperAssets.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}`)
    throw err
  }
}

const paperAsset = (over = {}) => ({ path: 'papers/a/1/assets/0-p.pdf', contentType: 'application/pdf', ...over })
const markScheme = (over = {}) => paperAsset({ role: 'mark-scheme', path: 'papers/a/1/assets/1-ms.pdf', ...over })

// ── the reported bug ────────────────────────────────────────────────
test('removing the last asset from a PUBLISHED paper is refused', () => {
  const verdict = canRemovePaperAsset({ status: 'published', assets: [paperAsset()] }, 0)
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.message, PUBLISHED_PAPER_NEEDS_A_FILE)
})

test('the refusal names the two ways out instead of only saying no', () => {
  // The wording is the remedy: an admin who is told "no" and nothing else
  // reaches for the Firebase console, which is how papers get edited into
  // states the app cannot produce.
  assert.match(PUBLISHED_PAPER_NEEDS_A_FILE, /unpublish/i)
  assert.match(PUBLISHED_PAPER_NEEDS_A_FILE, /replace/i)
})

test('a DRAFT may be emptied — that is how a wrong upload is replaced', () => {
  assert.equal(canRemovePaperAsset({ status: 'draft', assets: [paperAsset()] }, 0).allowed, true)
})

test('a published paper with two files may still lose one', () => {
  assert.equal(
    canRemovePaperAsset({ status: 'published', assets: [paperAsset(), paperAsset({ path: 'b' })] }, 0).allowed,
    true,
  )
})

// ── the case a length check would wrongly BLOCK ─────────────────────
test('a legacy pdfPath paper may lose its last asset — it still renders', () => {
  // Both readers prefer pdfPath over assets, so this paper is fine empty.
  // Blocking here would refuse a legitimate edit on much of the old archive.
  const verdict = canRemovePaperAsset(
    { status: 'published', pdfPath: 'papers/a/1/paper.pdf', assets: [paperAsset()] },
    0,
  )
  assert.equal(verdict.allowed, true)
})

test('an empty-string pdfPath is not a source', () => {
  assert.equal(canRemovePaperAsset({ status: 'published', pdfPath: '', assets: [paperAsset()] }, 0).allowed, false)
})

// ── the case a length check would wrongly ALLOW ─────────────────────
test('removing the only PAPER asset is refused when a mark scheme remains', () => {
  // assets.length goes 2 → 1, so a count-based guard permits this. The learner
  // gets a blank preview: the readers exclude mark schemes from the paper view.
  const verdict = canRemovePaperAsset({ status: 'published', assets: [paperAsset(), markScheme()] }, 0)
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.message, PUBLISHED_PAPER_NEEDS_A_FILE)
})

test('the mark scheme itself may be removed while the paper remains', () => {
  assert.equal(canRemovePaperAsset({ status: 'published', assets: [paperAsset(), markScheme()] }, 1).allowed, true)
})

// ── readable-source classification (shared with the repair script) ──
test('an asset with no role counts as the paper', () => {
  // `role` post-dates the first uploads; splitAssetsByRole reads absence as
  // the paper, and this must agree with it or old papers read as broken.
  assert.equal(paperRoleAssets([{ path: 'x' }]).length, 1)
  assert.equal(hasReadablePaperSource({ assets: [{ path: 'x' }] }), true)
})

test('hasReadablePaperSource is false only when nothing would render', () => {
  assert.equal(hasReadablePaperSource({ assets: [] }), false)
  assert.equal(hasReadablePaperSource({ assets: [markScheme()] }), false)
  assert.equal(hasReadablePaperSource({ assets: [], pdfPath: 'p.pdf' }), true)
  assert.equal(hasReadablePaperSource(null), false)
})

test('non-array assets do not throw', () => {
  // Firestore documents are not schema-enforced; a bad write must classify,
  // not crash the repair script mid-sweep.
  assert.equal(hasReadablePaperSource({ assets: 'nope' }), false)
  assert.equal(canRemovePaperAsset({ status: 'published', assets: undefined }, 0).allowed, false)
})

test('isPublishedWithoutReadableSource selects exactly the broken population', () => {
  assert.equal(isPublishedWithoutReadableSource({ status: 'published', assets: [] }), true)
  assert.equal(isPublishedWithoutReadableSource({ status: 'published', assets: [markScheme()] }), true)
  // Not broken: a draft with no files is simply unfinished, and the repair
  // script must not touch it.
  assert.equal(isPublishedWithoutReadableSource({ status: 'draft', assets: [] }), false)
  assert.equal(isPublishedWithoutReadableSource({ status: 'archived', assets: [] }), false)
  assert.equal(isPublishedWithoutReadableSource({ status: 'published', pdfPath: 'p.pdf', assets: [] }), false)
})

console.log(`✓ published-paper asset guard — ${passed} assertions passed`)
