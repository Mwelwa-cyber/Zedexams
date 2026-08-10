'use strict';

// Unit tests for the pure half of resolvePaperAssetUrl:
//   - the canonical-path guard (a staff token must never reach outside the
//     papers/ tree, by traversal or by encoding)
//   - the declared-path allow-list (and which file it says was served)
//   - the signed-URL expiry band (the credential must expire)
//   - the fallback audit event (must never carry a URL, token or object path)
//
// Run: node functions/teacherTools/paperAssetUrl.test.js

const assert = require('node:assert/strict');
const {
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
  FALLBACK_EVENT_KEYS,
  FALLBACK_EVENT_NAME,
  isValidPaperId,
  isCanonicalPaperAssetPath,
  classifyPaperAssetPath,
  isDeclaredPaperAssetPath,
  resolveSignedUrlExpiry,
  buildFallbackLogEvent,
} = require('./paperAssetUrlCore');

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

// ── the declared-path allow-list ────────────────────────────────────────────

test('accepts pdfPath, markSchemePath, and every assets[].path', () => {
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/paper-mock.pdf'), true);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/mark-scheme-mock.pdf'), true);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/assets/0-page1.jpg'), true);
  assert.equal(isDeclaredPaperAssetPath(PAPER, 'papers/uidA/p1/assets/1-ms.pdf'), true);
});

test('classifies which file was served, for the audit event', () => {
  assert.equal(classifyPaperAssetPath(PAPER, 'papers/uidA/p1/paper-mock.pdf'), 'pdf');
  assert.equal(classifyPaperAssetPath(PAPER, 'papers/uidA/p1/mark-scheme-mock.pdf'), 'markScheme');
  assert.equal(classifyPaperAssetPath(PAPER, 'papers/uidA/p1/assets/0-page1.jpg'), 'asset');
  assert.equal(classifyPaperAssetPath(PAPER, 'papers/uidA/p1/nope.pdf'), null);
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

// ── the canonical-path guard (traversal controls) ───────────────────────────

test('canonical guard accepts the real upload shapes', () => {
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/p1/paper-mock.pdf'), true);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/p1/assets/0-page1.jpg'), true);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/p1/figures/q1-abc123.jpg'), true);
});

test('canonical guard rejects traversal in every spelling', () => {
  assert.equal(isCanonicalPaperAssetPath('papers/../secrets/keys.json'), false);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/../../etc/passwd'), false);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/./p1/x.pdf'), false);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA//p1/x.pdf'), false);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/p1/x.pdf/'), false);
  // Percent-encoded separators and traversal — declared paths are never
  // encoded, so any % is an attempt to smuggle something past the check.
  assert.equal(isCanonicalPaperAssetPath('papers/uidA%2F..%2Fsecrets'), false);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/%2e%2e/x.pdf'), false);
  // Backslash separators.
  assert.equal(isCanonicalPaperAssetPath('papers\\uidA\\p1\\x.pdf'), false);
  // NUL truncation.
  assert.equal(isCanonicalPaperAssetPath('papers/uidA/p1/x.pdf\u0000.png'), false);
});

test('canonical guard rejects anything outside the papers/ tree', () => {
  assert.equal(isCanonicalPaperAssetPath('users-backups/all.json'), false);
  assert.equal(isCanonicalPaperAssetPath('/papers/uidA/p1/x.pdf'), false);
  assert.equal(isCanonicalPaperAssetPath('papersX/uidA/p1/x.pdf'), false);
  // The prefix alone is a folder, not an object.
  assert.equal(isCanonicalPaperAssetPath('papers/'), false);
  assert.equal(isCanonicalPaperAssetPath('papers/uidA'), false);
  // Garbage.
  assert.equal(isCanonicalPaperAssetPath(''), false);
  assert.equal(isCanonicalPaperAssetPath(null), false);
  assert.equal(isCanonicalPaperAssetPath('papers/' + 'a'.repeat(2000)), false);
});

test('the two guards are independent — declared does not imply canonical', () => {
  // A paper doc that (wrongly) declares an escaping path still fails the
  // shape check. This is the whole point of requiring both: the allow-list
  // trusts strings from Firestore, the canonical guard does not.
  const rogue = {pdfPath: 'papers/../users-backups/all.json'};
  assert.equal(isDeclaredPaperAssetPath(rogue, 'papers/../users-backups/all.json'), true);
  assert.equal(isCanonicalPaperAssetPath('papers/../users-backups/all.json'), false);
});

// ── the paper id addresses exactly one document ─────────────────────────────

test('paper id guard accepts ordinary Firestore document ids', () => {
  assert.equal(isValidPaperId('p1'), true);
  assert.equal(isValidPaperId('ecz-2019-g9-maths-p2'), true);
  assert.equal(isValidPaperId('aB3_-xY'), true);
});

test('paper id guard rejects a slash — traversal in a DOCUMENT path', () => {
  // `pastPapers/${paperId}` with a slash addresses a different depth of the
  // tree than the paper the caller named.
  assert.equal(isValidPaperId('p1/sub/doc'), false);
  assert.equal(isValidPaperId('../users/uidA'), false);
  assert.equal(isValidPaperId('p1/'), false);
  assert.equal(isValidPaperId('/p1'), false);
});

test('paper id guard rejects ids Firestore itself refuses', () => {
  assert.equal(isValidPaperId('.'), false);
  assert.equal(isValidPaperId('..'), false);
  assert.equal(isValidPaperId('__name__'), false);
  assert.equal(isValidPaperId(''), false);
  assert.equal(isValidPaperId(null), false);
  assert.equal(isValidPaperId('a'.repeat(1501)), false);
  assert.equal(isValidPaperId('p1' + String.fromCharCode(1) + 'x'), false);
});

// ── the signed URL must actually expire ─────────────────────────────────────

test('expiry defaults to 10 minutes and stays inside the agreed band', () => {
  const now = 1_700_000_000_000;
  assert.equal(resolveSignedUrlExpiry(now), now + 10 * 60 * 1000);
  assert.equal(DEFAULT_TTL_SECONDS, 600);
  assert.ok(DEFAULT_TTL_SECONDS >= MIN_TTL_SECONDS && DEFAULT_TTL_SECONDS <= MAX_TTL_SECONDS);
  assert.equal(MIN_TTL_SECONDS, 300);
  assert.equal(MAX_TTL_SECONDS, 900);
});

test('expiry refuses a TTL outside the band rather than clamping it', () => {
  const now = 1_700_000_000_000;
  assert.throws(() => resolveSignedUrlExpiry(now, 24 * 60 * 60), /between/);
  assert.throws(() => resolveSignedUrlExpiry(now, 60), /between/);
  assert.throws(() => resolveSignedUrlExpiry(now, 0), /between/);
  assert.throws(() => resolveSignedUrlExpiry(now, NaN), /between/);
  assert.throws(() => resolveSignedUrlExpiry(0), /positive/);
});

// ── the audit event must not become a credential leak ───────────────────────

test('fallback event carries exactly the declared keys', () => {
  const event = buildFallbackLogEvent({
    callerUid: 'uidA',
    callerRole: 'admin',
    emailVerified: true,
    paperId: 'p1',
    assetKind: 'pdf',
    ttlSeconds: DEFAULT_TTL_SECONDS,
  });
  assert.deepEqual(Object.keys(event).sort(), [...FALLBACK_EVENT_KEYS].sort());
  assert.equal(event.event, FALLBACK_EVENT_NAME);
  assert.equal(event.callerRole, 'admin');
  assert.equal(event.emailVerified, true);
  assert.equal(event.assetKind, 'pdf');
});

test('fallback event never carries a URL, token or object path', () => {
  // Built with every sensitive value in scope as an extra field: the builder
  // must drop them. This is the regression that matters — someone adding
  // `url` "just for debugging" turns every log line into a live credential.
  const event = buildFallbackLogEvent({
    callerUid: 'uidA',
    callerRole: 'admin',
    emailVerified: true,
    paperId: 'p1',
    assetKind: 'pdf',
    ttlSeconds: DEFAULT_TTL_SECONDS,
    url: 'https://storage.googleapis.com/bkt/papers/uidA/p1/paper.pdf?X-Goog-Signature=deadbeef',
    token: 'tok-123',
    path: 'papers/uidA/p1/paper-mock.pdf',
    metadata: {size: 1024, contentType: 'application/pdf'},
  });
  const serialised = JSON.stringify(event);
  for (const secret of ['storage.googleapis.com', 'X-Goog-Signature', 'deadbeef',
    'tok-123', 'paper-mock.pdf', 'contentType']) {
    assert.ok(!serialised.includes(secret),
      `event leaked ${secret}: ${serialised}`);
  }
  assert.ok(!('url' in event) && !('token' in event) && !('path' in event));
});

test('fallback event is JSON-serialisable with no undefined holes', () => {
  const event = buildFallbackLogEvent({});
  assert.equal(typeof JSON.stringify(event), 'string');
  for (const key of FALLBACK_EVENT_KEYS) {
    assert.notEqual(event[key], undefined, `${key} must never be undefined`);
  }
  assert.equal(event.emailVerified, false, 'unknown verification is not "verified"');
});

if (failures.length) {
  console.log(`\n✗ ${failures.length} failed of ${pass + failures.length}`);
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
  process.exit(1);
}
console.log(`paperAssetUrl core: all ${pass} tests passed`);
