'use strict';

// Unit tests for the pure half of resolvePaperAssetUrl: the path allow-list
// (a staff token must never token-ify an arbitrary bucket object) and the
// download-URL shape (must match what the client SDK's getDownloadURL()
// returns, since callers treat the two interchangeably).
//
// Run: node functions/teacherTools/paperAssetUrl.test.js

const assert = require('node:assert/strict');
const {isDeclaredPaperAssetPath, buildTokenedDownloadUrl} = require('./paperAssetUrlCore');

let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    failures.push({name, message: err.message});
  }
}

const PAPER = {
  pdfPath: 'papers/uidA/p1/paper-mock.pdf',
  markSchemePath: 'papers/uidA/p1/mark-scheme-mock.pdf',
  assets: [
    {path: 'papers/uidA/p1/assets/0-page1.jpg', role: 'paper'},
    {path: 'papers/uidA/p1/assets/1-ms.pdf', role: 'mark-scheme'},
  ],
};

test('accepts pdfPath, markSchemePath, and every assets[].path', () => {
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/paper-mock.pdf'), true);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/mark-scheme-mock.pdf'), true);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/assets/0-page1.jpg'), true);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/assets/1-ms.pdf'), true);
});

test('rejects any path the paper does not declare — no prefix or sibling tricks', () => {
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/assets/2-other.pdf'), false);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1'), false);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/'), false);
  // Prefix of a declared path is NOT the declared path.
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/paper-mock.pd'), false);
  // A completely unrelated bucket object.
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'users-backups/all.json'), false);
});

test('rejects garbage inputs (no throw, always false)', () => {
  assert.equal(isDeclaredPaperAssetPath(null, 'papers/x'), false);
  assert.equal(isDeclaredPaperAssetPath({}, 'papers/x'), false);
  assert.equal(isDeclaredPaperAssetPath(PAPER, ''), false);
  assert.equal(isDeclaredPaperAssetPath(PAPER, null), false);
  assert.equal(isDeclaredPaperAssetPath({assets: 'nope'}, 'papers/x'), false);
  assert.equal(isDeclaredPaperAssetPath({assets: [null, {noPath: true}]}, 'papers/x'), false);
});

test('buildTokenedDownloadUrl matches the client SDK URL shape', () => {
  const url = buildTokenedDownloadUrl('examsprepzambia.firebasestorage.app',
    'papers/uidA/p1/assets/0-page1.jpg', 'tok-123');
  assert.equal(url,
    'https://firebasestorage.googleapis.com/v0/b/examsprepzambia.firebasestorage.app/o/' +
    'papers%2FuidA%2Fp1%2Fassets%2F0-page1.jpg?alt=media&token=tok-123');
});

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed of ${pass + failures.length}`);
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
  process.exit(1);
}
console.log(`paperAssetUrl core: all ${pass} tests passed`);
