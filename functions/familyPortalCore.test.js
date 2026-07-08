"use strict";

// Plain-node assertion tests for the pure family-portal helpers.
// Run with `npm run test:family-portal` (or `node functions/familyPortalCore.test.js`).

const assert = require("assert");
const {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  normalizeFamilyCode,
  isValidFamilyCode,
  randomFamilyCode,
  familyCodeStatus,
  familyCodeStatusMessage,
  parentLinkId,
} = require("./familyPortalCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("familyPortalCore");

test("normalizeFamilyCode uppercases and strips punctuation/spaces", () => {
  assert.strictEqual(normalizeFamilyCode("ab7k-mn2p"), "AB7KMN2P");
  assert.strictEqual(normalizeFamilyCode("  AB7K MN2P  "), "AB7KMN2P");
  assert.strictEqual(normalizeFamilyCode("ab7k.mn2p"), "AB7KMN2P");
});

test("normalizeFamilyCode drops chars outside the alphabet (0/O/1/I/L)", () => {
  // O, 0, I, 1, L are not in the alphabet — they get stripped, not mapped.
  assert.strictEqual(normalizeFamilyCode("A0O1ILB2"), "AB2");
  assert.strictEqual(normalizeFamilyCode(""), "");
  assert.strictEqual(normalizeFamilyCode(null), "");
  assert.strictEqual(normalizeFamilyCode(undefined), "");
});

test("isValidFamilyCode requires exactly FAMILY_CODE_LENGTH chars", () => {
  assert.strictEqual(isValidFamilyCode("AB7KMN2P"), true);
  assert.strictEqual(isValidFamilyCode("AB7KMN2"), false); // too short
  assert.strictEqual(isValidFamilyCode("AB7KMN2PQ"), false); // too long
  assert.strictEqual(isValidFamilyCode(""), false);
  assert.strictEqual(isValidFamilyCode(null), false);
});

test("randomFamilyCode maps injected bytes onto the alphabet, right length", () => {
  const bytes = (n) => Array.from({ length: n }, (_, i) => i); // 0,1,2,...
  const code = randomFamilyCode(bytes);
  assert.strictEqual(code.length, FAMILY_CODE_LENGTH);
  assert.strictEqual(code, "ABCDEFGH"); // alphabet[0..7]
  // every char is in the alphabet
  for (const ch of code) assert.ok(FAMILY_CODE_ALPHABET.includes(ch));
});

test("randomFamilyCode wraps bytes larger than the alphabet via modulo", () => {
  const alen = FAMILY_CODE_ALPHABET.length;
  const bytes = () => new Array(FAMILY_CODE_LENGTH).fill(alen); // wraps to index 0
  assert.strictEqual(randomFamilyCode(bytes), FAMILY_CODE_ALPHABET[0].repeat(FAMILY_CODE_LENGTH));
});

test("familyCodeStatus classifies invalid / revoked / expired / ok", () => {
  const now = 1_000_000;
  assert.strictEqual(familyCodeStatus(null, now), "invalid");
  assert.strictEqual(familyCodeStatus({ revokedAt: 123 }, now), "revoked");
  assert.strictEqual(familyCodeStatus({ expiresAtMs: now - 1 }, now), "expired");
  assert.strictEqual(familyCodeStatus({ expiresAtMs: now + 1 }, now), "ok");
  // no expiry set → treated as ok (never-expiring)
  assert.strictEqual(familyCodeStatus({}, now), "ok");
});

test("familyCodeStatus reads a Firestore-style Timestamp expiresAt", () => {
  const now = 1_000_000;
  const expired = { expiresAt: { toMillis: () => now - 1 } };
  const live = { expiresAt: { toMillis: () => now + 1 } };
  assert.strictEqual(familyCodeStatus(expired, now), "expired");
  assert.strictEqual(familyCodeStatus(live, now), "ok");
});

test("revoked takes precedence over expiry", () => {
  const now = 1_000_000;
  assert.strictEqual(
      familyCodeStatus({ revokedAt: 1, expiresAtMs: now + 10_000 }, now),
      "revoked",
  );
});

test("familyCodeStatusMessage gives a friendly line per non-ok status", () => {
  assert.match(familyCodeStatusMessage("revoked"), /turned off/i);
  assert.match(familyCodeStatusMessage("expired"), /expired/i);
  assert.match(familyCodeStatusMessage("invalid"), /not valid/i);
  assert.strictEqual(familyCodeStatusMessage("ok"), "");
});

test("parentLinkId is deterministic and idempotent-friendly", () => {
  assert.strictEqual(parentLinkId("parentA", "childB"), "parentA_childB");
  // order matters — parent first, child second
  assert.notStrictEqual(parentLinkId("a", "b"), parentLinkId("b", "a"));
});

console.log(`\n${passed} assertions passed.`);
