/**
 * Inbound JSON vetting for the HTTP POST endpoints
 * (SECURITY_ENDPOINT_AUDIT.md §4.5).
 *
 * Half of this file tests the guard. The other half tests WHERE IT IS NOT
 * APPLIED, which is the half that matters: three surfaces would break under a
 * blanket rule, and "apply it everywhere for consistency" is the obvious,
 * plausible, wrong change for a later reader to make. Each exclusion is pinned
 * here with the reason, so undoing one fails a test instead of failing a user.
 */
"use strict";

const assert = require("node:assert");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {
  isJsonContentType,
  vetJsonRequest,
  enforceJsonRequest,
  DEFAULT_MAX_BODY_BYTES,
} = require("./httpRequestGuard");

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  console.log("  ok  " + label);
  passed++;
}
const read = (p) => readFileSync(path.join(__dirname, p), "utf8");

console.log("httpRequestGuard — what counts as JSON");

ok("plain application/json is JSON", isJsonContentType("application/json"));
ok("a charset parameter is still JSON — rejecting it would be the bug",
    isJsonContentType("application/json; charset=utf-8"));
ok("case and padding do not matter", isJsonContentType("  APPLICATION/JSON  "));
ok("the +json suffix tree is JSON", isJsonContentType("application/merge-patch+json"));
ok("form-encoded is NOT JSON", !isJsonContentType("application/x-www-form-urlencoded"));
ok("text/plain is NOT JSON", !isJsonContentType("text/plain"));
ok("multipart is NOT JSON", !isJsonContentType("multipart/form-data; boundary=x"));
ok("a missing Content-Type is NOT JSON", !isJsonContentType(undefined));
ok("application/jsonp is not smuggled in by prefix", !isJsonContentType("application/jsonp"));

console.log("\nhttpRequestGuard — verdicts");

ok("a well-formed small JSON POST passes",
    vetJsonRequest({contentType: "application/json", contentLength: "512"}).reject === false);

{
  const v = vetJsonRequest({contentType: "text/plain", contentLength: "10"});
  ok("a non-JSON body is refused with 415", v.reject && v.status === 415 && v.reason === "content-type");
}

{
  const v = vetJsonRequest({contentType: "application/json", contentLength: String(DEFAULT_MAX_BODY_BYTES + 1)});
  ok("an oversized declared body is refused with 413", v.reject && v.status === 413 && v.reason === "too-large");
}

ok("exactly at the cap is allowed, not off-by-one rejected",
    vetJsonRequest({contentType: "application/json", contentLength: String(DEFAULT_MAX_BODY_BYTES)}).reject === false);

// A chunked request sends no Content-Length. Treating "absent" as oversized
// would reject every one of them — absence of a claim is not a claim of size.
ok("a missing Content-Length is not treated as oversized",
    vetJsonRequest({contentType: "application/json", contentLength: undefined}).reject === false);
ok("an unparseable Content-Length is not treated as oversized",
    vetJsonRequest({contentType: "application/json", contentLength: "banana"}).reject === false);

// Content-type is checked FIRST: a caller sending a huge form body should be
// told the type is wrong, which is the thing they can actually fix.
ok("content-type is reported before size",
    vetJsonRequest({contentType: "text/plain", contentLength: "99999999"}).reason === "content-type");

console.log("\nhttpRequestGuard — the Express wrapper");

{
  const calls = [];
  const res = {
    status(s) { calls.push(["status", s]); return this; },
    json(b) { calls.push(["json", b]); return this; },
  };
  const req = {get: (h) => (h.toLowerCase() === "content-type" ? "text/plain" : undefined)};
  const handled = enforceJsonRequest(req, res, {label: "t"});
  ok("the wrapper reports that it responded", handled === true);
  ok("...with a 415", calls.some(([k, v]) => k === "status" && v === 415));

  const okReq = {get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : "10")};
  ok("a good request is not intercepted", enforceJsonRequest(okReq, {status: () => {}}, {label: "t"}) === false);
}

console.log("\nWHERE IT IS APPLIED");

for (const [file, label] of [
  ["tts.js", "apiTextToSpeech"],
  ["httpSurfaceHandlers.js", "apiAiChat"],
  ["accountDeletionRequests.js", "apiRequestAccountDeletion"],
]) {
  const src = read(file);
  ok(`${label} vets its body`,
      src.includes("enforceJsonRequest") && src.includes(label));
}
ok("the two SSE stream endpoints vet their body (shared factory)",
    /enforceJsonRequest\(req, res, \{label: `api\$\{tool\}`\}\)/.test(read("index.js")));

console.log("\nWHERE IT IS DELIBERATELY NOT APPLIED — do not 'fix' these");

{
  // 1. Guardian consent takes an HTML form POST from the guardian's email link.
  //    Asserting JSON would break consent for every under-age signup.
  const pages = read("guardianConsent/consentPages.js");
  ok("the consent page really does post an HTML form (the reason for the exclusion)",
      /<form method="POST"/.test(pages));
  ok("guardian consent does NOT vet for JSON",
      !read("guardianConsent/index.js").includes("enforceJsonRequest"));
}

{
  // 2/3. The provider webhooks set their own headers and are gated by an HMAC
  //      signature, which already makes a forged body unusable. A Content-Type
  //      assertion adds nothing and hands a provider a way to break payments.
  ok("lencoWebhook does NOT vet for JSON",
      !read("paymentHandlers.js").includes("enforceJsonRequest"));
  ok("lencoWebhook still verifies its signature — the actual gate",
      read("paymentHandlers.js").includes("verifyWebhookSignature"));
  ok("apiWhatsAppWebhook still verifies its signature",
      read("httpSurfaceHandlers.js").includes("verifyInboundSignature"));
}

{
  // 4. apiTrackVisit is a best-effort beacon whose handler is documented to
  //    never surface an error to the visitor; a 415 would contradict that.
  const vt = read("visitorTracking.js");
  ok("apiTrackVisit does NOT vet for JSON", !vt.includes("enforceJsonRequest"));
  ok("...and its never-error contract is still stated in the source",
      /must NEVER surface an error/.test(vt));
}

console.log("\n" + passed + " passed");
