"use strict";

// Plain-node assertion tests for the pure family-portal helpers.
// Run with `npm run test:family-portal` (or `node functions/familyPortalCore.test.js`).

const assert = require("assert");
const {
  FAMILY_CODE_ALPHABET,
  FAMILY_CODE_LENGTH,
  FAMILY_CODE_TTL_HOURS,
  FAMILY_CODE_TTL_DAYS,
  ONE_HOUR_MS,
  describeCodeForLearner,
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

test("familyCodeStatus classifies invalid / revoked / used / expired / ok", () => {
  const now = 1_000_000;
  assert.strictEqual(familyCodeStatus(null, now), "invalid");
  assert.strictEqual(familyCodeStatus({ revokedAt: 123 }, now), "revoked");
  assert.strictEqual(familyCodeStatus({ usedAt: 123, expiresAtMs: now + 1 }, now), "used");
  assert.strictEqual(familyCodeStatus({ expiresAtMs: now - 1 }, now), "expired");
  assert.strictEqual(familyCodeStatus({ expiresAtMs: now + 1 }, now), "ok");
});

test("a code with NO readable expiry is expired, not a permanent credential", () => {
  // This used to read as "ok (never-expiring)". A doc with no expiry is what
  // a corrupt or hand-edited record looks like, and reading it as valid makes
  // it a standing grant over a child's account — the one failure here that
  // would never announce itself.
  const now = 1_000_000;
  assert.strictEqual(familyCodeStatus({}, now), "expired");
  assert.strictEqual(familyCodeStatus({ expiresAt: "not a date" }, now), "expired");
  assert.strictEqual(familyCodeStatus({ expiresAtMs: NaN }, now), "expired");
});

test("a code burns on use even while it is still inside its window", () => {
  const now = 1_000_000;
  assert.strictEqual(familyCodeStatus({ usedAt: 5, expiresAtMs: now + 999_999 }, now), "used");
});

test("used outranks expired, so a parent is told the truth about which", () => {
  // "Expired" would send them back to the child for a replacement they do
  // not need — somebody already redeemed it.
  const now = 1_000_000;
  assert.strictEqual(familyCodeStatus({ usedAt: 5, expiresAtMs: now - 1 }, now), "used");
});

test("revoked outranks used — the child's own act is the reason they are owed", () => {
  const now = 1_000_000;
  assert.strictEqual(familyCodeStatus({ revokedAt: 1, usedAt: 2 }, now), "revoked");
});

test("the 48-hour TTL is what the module actually declares", () => {
  assert.strictEqual(FAMILY_CODE_TTL_HOURS, 48);
  assert.strictEqual(FAMILY_CODE_TTL_DAYS, 2);
});

test("describeCodeForLearner counts down in hours while the code is live", () => {
  const now = 1_000_000;
  const live = describeCodeForLearner({ expiresAtMs: now + 5 * ONE_HOUR_MS }, now);
  assert.strictEqual(live.live, true);
  assert.strictEqual(live.status, "ok");
  assert.match(live.message, /5 hours/);

  const soon = describeCodeForLearner({ expiresAtMs: now + 60_000 }, now);
  assert.match(soon.message, /less than an hour/i);
});

test("describeCodeForLearner and the redeem path agree on what is dead", () => {
  // A code the panel shows as live but the callable refuses is how a child
  // reads a dead code down a phone line to a parent.
  const now = 1_000_000;
  for (const doc of [{}, { usedAt: 1 }, { revokedAt: 1 }, { expiresAtMs: now - 1 }]) {
    const shown = describeCodeForLearner(doc, now);
    const wouldRedeem = familyCodeStatus(doc, now) === "ok";
    assert.strictEqual(shown.live, wouldRedeem);
  }
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
  assert.match(familyCodeStatusMessage("used"), /already been used/i);
  assert.match(familyCodeStatusMessage("invalid"), /not valid/i);
  assert.strictEqual(familyCodeStatusMessage("ok"), "");
});

test("parentLinkId is deterministic and idempotent-friendly", () => {
  assert.strictEqual(parentLinkId("parentA", "childB"), "parentA_childB");
  // order matters — parent first, child second
  assert.notStrictEqual(parentLinkId("a", "b"), parentLinkId("b", "a"));
});

console.log(`\n${passed} assertions passed.`);
