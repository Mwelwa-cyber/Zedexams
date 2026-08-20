"use strict";

/**
 * Guardian consent — tokens, pages, and the decision handler.
 *
 * The link in a guardian's message is a bearer credential that can approve a
 * child's account or DELETE it. The tests below are written against the ways
 * that goes wrong in the field, not the happy path:
 *
 *   • a mail scanner or link prefetcher following every URL in the message
 *   • a leaked/backed-up Firestore collection handing over live links
 *   • a double-tap on a slow connection producing two decisions
 *   • a child's typed name reaching an HTML page unescaped
 *
 * Plain `node` script. Run: node functions/guardianConsent/guardianConsent.test.js
 */

const assert = require("node:assert");
const {
  mintToken, tokenDocId, isWellFormedToken, expiryFrom, buildConsentLinks, TOKEN_TTL_DAYS,
} = require("./consentTokens");
const {
  buildConsentEmail, buildConsentWhatsAppText, buildConsentPreview, safeName, PREVIEW_LINK,
} = require("./consentMessages");
const {
  esc, renderDecisionPage, renderApprovedPage, renderDeclinedPage, renderOutcomePage,
} = require("./consentPages");

// The handler pulls in firebase-functions; skip that half on a root-deps run
// (repo convention — see visitorTrackingHandler.test.js).
let mod = null;
try {
  require.resolve("firebase-functions/v2/https");
  mod = require("./index");
} catch (_e) { /* handler tests skipped below */ }

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

(async () => {
  console.log("consentTokens");

  await test("tokens are unguessable and well-formed", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const t = mintToken();
      assert.ok(isWellFormedToken(t), `${t} should be well formed`);
      assert.ok(!seen.has(t), "tokens must not repeat");
      seen.add(t);
    }
  });

  await test("the raw token is never the document id", () => {
    // The uploaded reference used `consentRequests/{token}`, which means a
    // read of that collection — a mis-scoped rule, a backup, a support export
    // — hands over the ability to approve or DELETE any pending child's
    // account. The id must be a hash, and must not contain the token.
    const t = mintToken();
    const id = tokenDocId(t);
    assert.notStrictEqual(id, t);
    assert.ok(!id.includes(t));
    assert.match(id, /^[a-f0-9]{64}$/);
  });

  await test("hashing is stable, so a link keeps working", () => {
    const t = mintToken();
    assert.strictEqual(tokenDocId(t), tokenDocId(t));
  });

  await test("malformed tokens are rejected before any database read", () => {
    for (const bad of ["", "abc", "../../etc/passwd", "z".repeat(64), "A".repeat(64),
      mintToken() + "x", null, undefined, 42, {}]) {
      assert.strictEqual(isWellFormedToken(bad), false, `${JSON.stringify(bad)} must be refused`);
    }
  });

  await test("links carry the token and a distinct decline route", () => {
    const t = mintToken();
    const {approveUrl, declineUrl} = buildConsentLinks("https://zedexams.com/consent", t);
    assert.ok(approveUrl.includes(t));
    assert.ok(declineUrl.includes("decline=1"));
    assert.notStrictEqual(approveUrl, declineUrl);
  });

  await test("expiry is the stated 7 days", () => {
    const now = new Date("2026-07-29T00:00:00Z");
    const exp = expiryFrom(now);
    assert.strictEqual(TOKEN_TTL_DAYS, 7);
    assert.strictEqual(Math.round((exp - now) / 86400000), 7);
  });

  console.log("\nconsentMessages");

  const links = {approveUrl: "https://z.test/consent?token=a", declineUrl: "https://z.test/consent?token=a&decline=1"};

  await test("the email offers BOTH decisions", () => {
    // A message that only offers "approve" is not asking a question, and the
    // guardian who did not expect it is the one the flow exists to catch.
    const {text} = buildConsentEmail({childName: "Chanda", ...links, expiryDays: 7});
    assert.ok(text.includes(links.approveUrl), "approve link missing");
    assert.ok(text.includes(links.declineUrl), "decline link missing");
  });

  await test("the email tells the guardian what we hold and how to delete it", () => {
    // Consent obtained without saying what is collected is not consent.
    const {text} = buildConsentEmail({childName: "Chanda", ...links, expiryDays: 7});
    for (const required of ["quiz and exam results", "zedexams.com/delete-account", "zedexams.com/privacy"]) {
      assert.ok(text.includes(required), `email must mention ${required}`);
    }
    assert.ok(/do not show advertising/i.test(text));
  });

  await test("the WhatsApp message keeps the decline route despite being short", () => {
    const t = buildConsentWhatsAppText({childName: "Chanda", ...links});
    assert.ok(t.includes(links.declineUrl), "decline must never be the thing trimmed for length");
    assert.ok(t.length < 700, "should stay readable in WhatsApp");
  });

  await test("every link in the WhatsApp message ends its line", () => {
    // WhatsApp linkifies up to the next whitespace. These lines were joined
    // with "" until WhatsApp became the default channel, which glued
    // `Not expected...` onto the end of the approve URL and produced a link
    // whose token was several words long — dead on arrival, and invisible to
    // a test that only asks whether the message CONTAINS the approve URL.
    const links = buildConsentLinks("https://zedexams.com/consent", mintToken());
    const text = buildConsentWhatsAppText({childName: "Chanda", ...links});
    for (const url of [links.approveUrl, links.declineUrl]) {
      const at = text.indexOf(url);
      assert.ok(at >= 0, "link missing");
      const after = text.slice(at + url.length, at + url.length + 1);
      assert.ok(after === "" || after === "\n", `"${after}" must not extend the link`);
    }
  });

  await test("the child's preview IS the message the guardian will receive", () => {
    // A preview assembled by a second function is a preview that can drift,
    // and the point of showing it is that a mistyped digit is otherwise
    // invisible to everyone. So it is the same builder, with the token
    // elided — a placeholder rather than a real link, because minting one
    // for a message nobody has agreed to send yet mints a live credential.
    const wa = buildConsentPreview({channel: "whatsapp", childName: "Lydia"});
    assert.strictEqual(wa.body, buildConsentWhatsAppText({
      childName: "Lydia", approveUrl: PREVIEW_LINK, declineUrl: PREVIEW_LINK,
    }));
    const email = buildConsentPreview({channel: "email", childName: "Lydia"});
    const real = buildConsentEmail({
      childName: "Lydia", approveUrl: PREVIEW_LINK, declineUrl: PREVIEW_LINK, expiryDays: 7,
    });
    assert.strictEqual(email.subject, real.subject);
    assert.strictEqual(email.body, real.text);
    for (const preview of [wa, email]) {
      assert.ok(!/token=/.test(preview.body), "a preview must never carry a live token");
      assert.ok(/remove the account|did not expect/i.test(preview.body),
          "the child must see that the grown-up can say no");
    }
  });

  await test("a missing child name degrades to a neutral phrase", () => {
    assert.strictEqual(safeName(""), "your child");
    assert.strictEqual(safeName(null), "your child");
    assert.strictEqual(safeName("  Chanda  "), "Chanda");
    assert.strictEqual(safeName("x".repeat(500)).length, 60);
  });

  console.log("\nconsentPages");

  await test("a child's typed name cannot inject HTML", () => {
    // The name is typed at signup and rendered by a Cloud Function with no
    // framework escaping for us.
    const evil = '<img src=x onerror="alert(1)">';
    const html = renderDecisionPage({childName: evil, token: "a".repeat(64), actionUrl: "https://z.test/consent"});
    assert.ok(!html.includes("<img src=x"), "raw tag reached the page");
    assert.ok(html.includes("&lt;img"), "expected escaped output");
  });

  await test("the token cannot break out of its attribute", () => {
    const html = renderDecisionPage({
      childName: "Chanda",
      token: '"><script>alert(1)</script>',
      actionUrl: "https://z.test/consent",
    });
    assert.ok(!html.includes("<script>alert(1)</script>"));
  });

  await test("esc covers every dangerous character", () => {
    assert.strictEqual(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  });

  await test("both decisions are POST forms, never links", () => {
    // If approve were a GET, every mail scanner following URLs in the message
    // would approve accounts — and the same mechanism offers decline, which
    // deactivates and schedules deletion.
    const html = renderDecisionPage({childName: "Chanda", token: "a".repeat(64), actionUrl: "https://z.test/consent"});
    const forms = html.match(/<form[^>]*method="POST"/gi) || [];
    assert.strictEqual(forms.length, 2, "expected an approve form and a decline form");
    assert.ok(!/href="[^"]*decline=1/.test(html), "decline must not be a followable link on this page");
  });

  await test("the decision page states what is restricted until approval", () => {
    const html = renderDecisionPage({childName: "Chanda", token: "a".repeat(64), actionUrl: "https://z.test/consent"});
    assert.ok(/leaderboard/i.test(html), "the page must name what approval unlocks");
    assert.ok(/purchase/i.test(html), "…and that buying is restricted until then");
    assert.ok(/delete-account/.test(html));
  });

  await test("approving requires saying you are the guardian; declining does not", () => {
    // The tick is what makes the hand-the-phone-over route honest: it skips
    // the message, not the question. Decline carries no box on purpose —
    // the person who did NOT expect this message is exactly the one who may
    // not be a guardian, and making them claim to be one before they can say
    // "this wasn't me" would turn the safety route into the harder of the two.
    const html = renderDecisionPage({childName: "Chanda", token: "t", actionUrl: "/consent"});
    const forms = html.split("<form").slice(1);
    const approve = forms.find((f) => /value="approve"/.test(f));
    const decline = forms.find((f) => /value="decline"/.test(f));
    assert.ok(/name="confirm"[^>]*value="yes"/.test(approve), "approve needs the confirmation");
    assert.ok(/required/.test(approve), "and the browser should ask for it too");
    assert.ok(!/name="confirm"/.test(decline), "decline must stay the easier route");
  });

  await test("every outcome page tells the guardian what to do next", () => {
    // "Invalid link" alone is a dead end for someone trying to do the right
    // thing. Each failure names the next step.
    for (const kind of ["invalid", "expired", "used", "unconfirmed", "error"]) {
      const html = renderOutcomePage(kind);
      assert.ok(/Resend|contact us|support@zedexams\.com|try the link again|tick the box/i.test(html),
          `${kind} page gives the guardian no next step`);
    }
  });

  await test("an unknown outcome renders the error page rather than crashing", () => {
    assert.ok(renderOutcomePage("nonsense").includes("Something went wrong"));
  });

  await test("result pages are noindex", () => {
    for (const html of [renderApprovedPage({childName: "Chanda"}), renderDeclinedPage(), renderOutcomePage("used")]) {
      assert.ok(html.includes('name="robots" content="noindex,nofollow"'));
    }
  });

  if (!mod) {
    console.log("\nguardianConsent handler: skipped — firebase-functions not installed (root-deps run).");
    console.log(`\nguardianConsent: ${passed} passed`);
    return;
  }

  console.log("\napplyDecision + handler");

  const {applyDecision, handleConsent} = mod;

  // Firestore stand-in with a real single-shot transaction.
  function fakeDb({record, user = {firstName: "Chanda"}} = {}) {
    const state = {record: record ? {...record} : null, user: user ? {...user} : null, writes: []};
    const userRef = {id: "u1", __kind: "user"};
    const docRef = {id: "hash", __kind: "request"};
    const db = {
      collection: () => ({doc: () => docRef}),
      doc: () => userRef,
      runTransaction: async (fn) => fn({
        get: async (ref) => ref.__kind === "request" ?
          {exists: !!state.record, data: () => state.record} :
          {exists: !!state.user, data: () => state.user},
        set: (ref, data) => {
          state.writes.push({ref: ref.__kind, data});
          if (ref.__kind === "user") state.user = {...state.user, ...data};
        },
        update: (ref, data) => {
          state.writes.push({ref: ref.__kind, data});
          if (ref.__kind === "request") state.record = {...state.record, ...data};
        },
      }),
      __state: state,
    };
    return db;
  }

  const live = () => ({uid: "u1", used: false, expiresAt: new Date(Date.now() + 86400000)});

  await test("approving grants consent and records evidence", async () => {
    const db = fakeDb({record: {...live(), clickIp: "1.2.3.4", clickUserAgent: "UA"}});
    const r = await applyDecision(db, {id: "hash", __kind: "request"}, "approve");
    assert.strictEqual(r.outcome, "approved");
    const userWrite = db.__state.writes.find((w) => w.ref === "user");
    assert.strictEqual(userWrite.data.guardian.consentStatus, "granted");
    // The evidence record is what would be shown to a regulator or to Google
    // on appeal to demonstrate a guardian actually approved.
    assert.strictEqual(userWrite.data.guardian.evidence.ip, "1.2.3.4");
    assert.strictEqual(userWrite.data.guardian.evidence.tokenId, "hash");
  });

  await test("declining suspends the account immediately", async () => {
    // The guardian is told the account is deactivated, so it has to be.
    const db = fakeDb({record: live()});
    const r = await applyDecision(db, {id: "hash", __kind: "request"}, "decline");
    assert.strictEqual(r.outcome, "declined");
    const userWrite = db.__state.writes.find((w) => w.ref === "user");
    assert.strictEqual(userWrite.data.guardian.consentStatus, "denied");
    assert.strictEqual(userWrite.data.suspended, true);
    assert.ok(userWrite.data.scheduledDeletionAt instanceof Date);
  });

  await test("a token can only be spent once", async () => {
    const db = fakeDb({record: live()});
    const first = await applyDecision(db, {id: "hash", __kind: "request"}, "approve");
    const second = await applyDecision(db, {id: "hash", __kind: "request"}, "decline");
    assert.strictEqual(first.outcome, "approved");
    // The second click must NOT be able to flip an approved account to denied.
    assert.strictEqual(second.outcome, "used");
  });

  await test("an expired token decides nothing", async () => {
    const db = fakeDb({record: {uid: "u1", used: false, expiresAt: new Date(Date.now() - 1000)}});
    const r = await applyDecision(db, {id: "hash", __kind: "request"}, "approve");
    assert.strictEqual(r.outcome, "expired");
    assert.strictEqual(db.__state.writes.length, 0);
  });

  await test("a request whose user is gone decides nothing", async () => {
    const db = fakeDb({record: live(), user: null});
    const r = await applyDecision(db, {id: "hash", __kind: "request"}, "approve");
    assert.strictEqual(r.outcome, "invalid");
  });

  await test("a record with no usable expiry is invalid, not eternal", async () => {
    const db = fakeDb({record: {uid: "u1", used: false, expiresAt: "soon"}});
    assert.strictEqual((await applyDecision(db, {id: "hash", __kind: "request"}, "approve")).outcome, "invalid");
  });

  // ── handler-level ──
  function fakeRes() {
    return {
      statusCode: null, body: null, headers: {}, headersSent: false,
      set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      send(b) { this.body = b; this.headersSent = true; return this; },
    };
  }
  const fakeReq = (over = {}) => ({
    method: "GET", query: {}, body: {}, ip: "1.2.3.4",
    get: () => "", ...over,
  });
  const deps = (db) => ({db, applyCors: () => {}, enforceRateLimit: async () => ({allowed: true})});

  await test("a GET never decides anything", async () => {
    // This is the mail-scanner case: a prefetcher follows the URL in the
    // message. It must render, not approve.
    const db = fakeDb({record: live()});
    db.collection = () => ({doc: () => ({
      id: "hash", __kind: "request",
      get: async () => ({exists: true, data: () => db.__state.record}),
      update: async () => {},
    })});
    db.doc = () => ({get: async () => ({exists: true, data: () => ({firstName: "Chanda"})})});
    const res = fakeRes();
    await handleConsent(fakeReq({query: {token: "a".repeat(64)}}), res, deps(db));
    assert.strictEqual(res.statusCode, 200);
    assert.ok(/Approve Chanda's account\?/.test(res.body), "expected the decision page");
    assert.strictEqual(db.__state.record.used, false, "a GET must not consume the token");
  });

  await test("a malformed token is refused without touching the database", async () => {
    let touched = false;
    const db = {collection: () => { touched = true; return {doc: () => ({})}; }};
    const res = fakeRes();
    await handleConsent(fakeReq({query: {token: "nope"}}), res, deps(db));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(touched, false);
  });

  await test("a POST with no valid decision changes nothing", async () => {
    const db = fakeDb({record: live()});
    const res = fakeRes();
    await handleConsent(
        fakeReq({method: "POST", body: {token: "a".repeat(64), decision: "maybe"}}), res, deps(db));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(db.__state.writes.length, 0);
  });

  await test("an approve POST without the guardian confirmation decides nothing", async () => {
    // `required` on the checkbox is a courtesy to the person reading the
    // page; a POST does not have to come from our page. Refusing here is the
    // enforcement, and it fails CLOSED — nothing is written.
    const db = fakeDb({record: live()});
    const res = fakeRes();
    await handleConsent(
        fakeReq({method: "POST", body: {token: "a".repeat(64), decision: "approve"}}),
        res, deps(db));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(db.__state.writes.length, 0);
    assert.ok(/parent or guardian/i.test(res.body));
  });

  await test("declining still needs no confirmation", async () => {
    const db = fakeDb({record: live()});
    const res = fakeRes();
    await handleConsent(
        fakeReq({method: "POST", body: {token: "a".repeat(64), decision: "decline"}}),
        res, deps(db));
    assert.strictEqual(res.statusCode, 200);
    const userWrite = db.__state.writes.find((w) => w.ref === "user");
    assert.strictEqual(userWrite.data.guardian.consentStatus, "denied");
  });

  await test("an approve POST with the confirmation grants consent", async () => {
    const db = fakeDb({record: live()});
    const res = fakeRes();
    await handleConsent(
        fakeReq({method: "POST", body: {token: "a".repeat(64), decision: "approve", confirm: "yes"}}),
        res, deps(db));
    assert.strictEqual(res.statusCode, 200);
    const userWrite = db.__state.writes.find((w) => w.ref === "user");
    assert.strictEqual(userWrite.data.guardian.consentStatus, "granted");
  });

  await test("handing the phone over writes the same record as the emailed link", async () => {
    // The whole promise of the same-device route: it skips the message, not
    // the audit trail. One field differs, and it differs on purpose — a
    // record that could not tell the two apart would be less useful, not
    // more trustworthy.
    const linked = fakeDb({record: {...live(), channel: "email", clickIp: "1.2.3.4", clickUserAgent: "UA"}});
    const here = fakeDb({record: {...live(), channel: "same_device", clickIp: "1.2.3.4", clickUserAgent: "UA"}});
    await applyDecision(linked, {id: "hash", __kind: "request"}, "approve");
    await applyDecision(here, {id: "hash", __kind: "request"}, "approve");

    const a = linked.__state.writes.find((w) => w.ref === "user").data.guardian;
    const b = here.__state.writes.find((w) => w.ref === "user").data.guardian;
    assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort());
    assert.deepStrictEqual(Object.keys(a.evidence).sort(), Object.keys(b.evidence).sort());
    assert.strictEqual(a.consentStatus, b.consentStatus);
    assert.strictEqual(b.evidence.tokenId, a.evidence.tokenId);
    assert.strictEqual(a.evidence.via, "link");
    assert.strictEqual(b.evidence.via, "same_device");
  });

  await test("pages carrying a token are not cached and leak no referrer", async () => {
    const db = fakeDb({record: live()});
    db.collection = () => ({doc: () => ({
      id: "hash", __kind: "request",
      get: async () => ({exists: true, data: () => db.__state.record}),
      update: async () => {},
    })});
    db.doc = () => ({get: async () => ({exists: true, data: () => ({firstName: "Chanda"})})});
    const res = fakeRes();
    await handleConsent(fakeReq({query: {token: "a".repeat(64)}}), res, deps(db));
    assert.match(res.headers["Cache-Control"], /no-store/);
    assert.strictEqual(res.headers["Referrer-Policy"], "no-referrer");
  });

  await test("a database failure shows a recoverable page, not a stack trace", async () => {
    const db = {collection: () => { throw new Error("firestore down"); }};
    const res = fakeRes();
    await handleConsent(fakeReq({query: {token: "a".repeat(64)}}), res, deps(db));
    assert.strictEqual(res.statusCode, 500);
    assert.ok(/support@zedexams\.com/.test(res.body));
    assert.ok(!/firestore down/.test(res.body));
  });

  console.log(`\nguardianConsent: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
