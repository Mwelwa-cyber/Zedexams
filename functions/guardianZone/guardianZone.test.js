/**
 * guardianZoneCore — the crypto half of the Guardian Zone.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites"). CommonJS,
 * matching the module it tests and the rest of functions/.
 *
 * The handlers themselves are not exercised here: they need firebase-functions,
 * which the root-deps CI run does not install, so the file skips that half the
 * way guardianConsent.test.js does. What IS covered is everything a bug would
 * be silent in — a hash that always matches, a code generator with a bias, a
 * name that can restructure the email it lands in.
 */

const assert = require("node:assert/strict");
const {
  mintSalt,
  hashPin,
  verifyPin,
  mintSetupCode,
  hashSetupCode,
  verifySetupCode,
  buildPinSetupEmail,
  safeName,
} = require("./guardianZoneCore");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("\nguardianZoneCore");

// ── PIN hashing ───────────────────────────────────────────────────────────

test("the right PIN verifies and the wrong one does not", () => {
  const salt = mintSalt();
  const hash = hashPin("4821", salt);
  assert.equal(verifyPin("4821", salt, hash), true);
  assert.equal(verifyPin("4822", salt, hash), false);
  assert.equal(verifyPin("", salt, hash), false);
});

test("the salt is what makes two identical PINs differ on disk", () => {
  // Without this, one leaked hash would identify every account using that PIN,
  // and the four popular PINs would be a rainbow table of one row each.
  const a = hashPin("4821", mintSalt());
  const b = hashPin("4821", mintSalt());
  assert.notEqual(a, b);
});

test("a PIN does not verify against another account's salt", () => {
  const hash = hashPin("4821", mintSalt());
  assert.equal(verifyPin("4821", mintSalt(), hash), false);
});

test("a missing or malformed stored hash refuses rather than throws", () => {
  // A half-written document must read as "wrong PIN", not as a crash that
  // takes the whole callable down — and certainly not as a pass.
  const salt = mintSalt();
  for (const stored of [undefined, null, "", "zzzz", 12345, {}]) {
    assert.equal(verifyPin("4821", salt, stored), false, `stored=${String(stored)}`);
  }
});

test("salts are unique per call", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) seen.add(mintSalt());
  assert.equal(seen.size, 50);
});

// ── setup codes ───────────────────────────────────────────────────────────

test("a setup code is always six digits", () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(mintSetupCode(), /^\d{6}$/);
  }
});

test("setup codes are not obviously biased", () => {
  // Rejection sampling rather than `% 1000000`. This will not catch a subtle
  // bias — nothing cheap would — but it does catch the two failures that
  // actually happen: a constant, and a generator stuck in one decade.
  const codes = new Set();
  const firstDigits = new Set();
  for (let i = 0; i < 400; i += 1) {
    const code = mintSetupCode();
    codes.add(code);
    firstDigits.add(code[0]);
  }
  assert.ok(codes.size > 390, `expected near-unique codes, got ${codes.size}/400`);
  assert.ok(firstDigits.size >= 8, `expected a spread of leading digits, got ${firstDigits.size}`);
});

test("the right code verifies and the wrong one does not", () => {
  const salt = mintSalt();
  const hash = hashSetupCode("418293", salt);
  assert.equal(verifySetupCode("418293", salt, hash), true);
  assert.equal(verifySetupCode("418294", salt, hash), false);
  assert.equal(verifySetupCode("418293", mintSalt(), hash), false);
});

test("a malformed stored code hash refuses rather than throws", () => {
  const salt = mintSalt();
  for (const stored of [undefined, null, "", "nothex", 7]) {
    assert.equal(verifySetupCode("418293", salt, stored), false, `stored=${String(stored)}`);
  }
});

// ── the email ─────────────────────────────────────────────────────────────

test("the email carries the code and says what it unlocks", () => {
  const {subject, text} = buildPinSetupEmail({
    childName: "Milton",
    code: "418293",
    ttlMinutes: 15,
  });
  assert.ok(subject.includes("418293"));
  assert.ok(text.includes("418293"));
  assert.ok(/Milton/.test(text));
  // The whole reason a guardian does not forward the code to the child who
  // asked for it is that the message says not to.
  assert.ok(/do not share/i.test(text));
  assert.ok(/15 minutes/.test(text));
});

test("a child's typed name cannot restructure the message", () => {
  // The name is learner-supplied text on its way into a message we send a
  // third party. A newline in it is a forged line — or, in some senders, a
  // forged header.
  const {text} = buildPinSetupEmail({
    childName: "Milton\nBcc: attacker@example.com\r\nX: y",
    code: "418293",
    ttlMinutes: 15,
  });
  assert.ok(!text.includes("\nBcc:"), "a newline survived into the body");
  assert.ok(text.includes("Milton Bcc: attacker@example.com X: y"));
});

test("a missing name degrades to a neutral phrase", () => {
  assert.equal(safeName(undefined), "your child");
  assert.equal(safeName("   "), "your child");
  assert.equal(safeName(42), "your child");
});

test("a very long name is capped", () => {
  assert.equal(safeName("x".repeat(500)).length, 60);
});

// ── the handlers, when the runtime has them ───────────────────────────────

let handlers = null;
try {
  handlers = require("./index");
} catch (err) {
  if (!/firebase-functions|firebase-admin|Cannot find module/.test(String(err && err.message))) throw err;
}

if (!handlers) {
  console.log("\nguardianZone handlers: skipped — firebase-functions not installed (root-deps run).");
} else {
  test("the guardian's address is masked before it reaches the child's screen", () => {
    // The child is holding the phone. "We sent it to m•••••@gmail.com" is
    // enough for a parent to recognise their own inbox and not enough for the
    // child to read the address off the screen.
    const masked = handlers.maskEmail("mahenga@gmail.com");
    assert.ok(masked.startsWith("m"));
    assert.ok(masked.endsWith("@gmail.com"));
    assert.ok(!masked.includes("mahenga"));
  });

  test("masking survives a value that is not an address", () => {
    assert.equal(handlers.maskEmail("+260971234567"), "your guardian's email");
  });

  test("every callable this module exports is wired", () => {
    for (const name of [
      "guardianZoneStatus",
      "requestGuardianPinSetup",
      "setGuardianPin",
      "verifyGuardianPin",
      "setGuardianControls",
    ]) {
      assert.ok(handlers[name], `${name} is missing`);
    }
  });
}

console.log(`\nguardianZone: ${passed} passed`);
