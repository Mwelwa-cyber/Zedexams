"use strict";

/**
 * Unit tests for the vision-API image-URL allow-list (SSRF guard shared by Qix
 * + Vex). Plain `node` assertion script (run via `npm run test:trusted-image`).
 */

const assert = require("node:assert");
const {isTrustedImageUrl} = require("./trustedImageHost");

let pass = 0;
function ok(cond, msg) {
  assert.strictEqual(cond, true, msg);
  pass++;
  console.log(`  ok  ${msg}`);
}

// Trusted — our own Firebase Storage surfaces.
ok(isTrustedImageUrl("https://firebasestorage.googleapis.com/v0/b/x/o/y.png?alt=media"), "firebasestorage.googleapis.com allowed");
ok(isTrustedImageUrl("https://storage.googleapis.com/examsprepzambia.firebasestorage.app/x.png"), "storage.googleapis.com allowed");
ok(isTrustedImageUrl("https://examsprepzambia.firebasestorage.app/x.png"), ".firebasestorage.app suffix allowed");
ok(isTrustedImageUrl("https://examsprepzambia.appspot.com/x.png"), ".appspot.com suffix allowed");

// Blocked — SSRF / exfil vectors.
ok(isTrustedImageUrl("http://firebasestorage.googleapis.com/x.png") === false, "http (non-TLS) blocked even on a trusted host");
ok(isTrustedImageUrl("https://169.254.169.254/latest/meta-data/") === false, "cloud metadata IP blocked");
ok(isTrustedImageUrl("http://169.254.169.254/") === false, "metadata over http blocked");
ok(isTrustedImageUrl("https://localhost/x.png") === false, "localhost blocked");
ok(isTrustedImageUrl("https://evil.com/x.png") === false, "arbitrary host blocked");
ok(isTrustedImageUrl("https://firebasestorage.googleapis.com.evil.com/x.png") === false, "look-alike host (suffix spoof) blocked");
ok(isTrustedImageUrl("https://evil.appspot.com.attacker.net/x.png") === false, "suffix-in-the-middle spoof blocked");
ok(isTrustedImageUrl("file:///etc/passwd") === false, "file:// blocked");
ok(isTrustedImageUrl("") === false, "empty string blocked");
ok(isTrustedImageUrl(null) === false, "null blocked");
ok(isTrustedImageUrl("not a url") === false, "garbage blocked");
ok(isTrustedImageUrl("data:image/png;base64,AAAA") === false, "data: URI blocked");

console.log(`\n─── ${pass} assertions · all passed ───`);
