/**
 * Newsletter signup (audit C6).
 *
 * Single callable: subscribeToNewsletter({ email, source? }) — public,
 * no auth required. Builds a `newsletterSubscribers/{lowerCaseEmail}`
 * collection that the team can later export into Buttondown / Mailchimp
 * / Beehiiv when they're ready to actually send. Today the value is
 * just keeping the list growing; a missing collection costs us
 * compounding subscribers we'd never get back.
 *
 * Why a Cloud Function instead of a direct client write:
 *   - The collection has to allow unauthenticated writes (it's a
 *     marketing-page form), but a publicly-writable Firestore
 *     collection is an obvious abuse vector. Routing through a
 *     callable lets us enforce email format, dedupe, honeypot, and
 *     rate limit before the write ever happens.
 *   - Dedupe is critical: re-subscribing the same email shouldn't
 *     bump createdAt or look like fresh signal in growth dashboards.
 *
 * Anti-spam:
 *   - Honeypot field `companyWebsite` — bots fill every field; humans
 *     never see it (form input is `hidden` + `tabindex=-1` + name
 *     evocative of common spam targets). Any non-empty value silently
 *     drops the request without writing.
 *   - Per-IP cap: 3 successful signups per 24h per IPv4 (tracked in
 *     newsletterSignupRateLimit/{ip-day}).
 *   - Email validation: RFC 5321 length + a permissive regex.
 *
 * What's NOT in this PR:
 *   - Double opt-in / confirmation email. The MVP is just a list
 *     builder; double opt-in lands when we pick a sending platform.
 *   - Unsubscribe link. Same — surfaces with the sending platform.
 *
 * Reading / exporting:
 *   - Admin SDK reads the collection from /admin (future feature).
 *   - Manual export: Firebase console → Firestore → newsletterSubscribers
 *     → "Export" or via gcloud firestore export.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const REGION = "us-central1";
const COLLECTION = "newsletterSubscribers";
const RATE_LIMIT_COLLECTION = "newsletterSignupRateLimit";
const MAX_PER_IP_PER_DAY = 3;
const MAX_EMAIL_LEN = 254;            // RFC 5321
const MAX_SOURCE_LEN = 64;
const ALLOWED_SOURCES = new Set([
  "marketing-footer",
  "marketing-hero",
  "blog-footer",
  "unknown",
]);

// Permissive RFC 5322-ish — rejects the obviously broken without
// false-rejecting unusual-but-valid (foo+bar@…, foo.bar@…, etc.).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normaliseEmail(raw) {
  return String(raw || "").trim().toLowerCase().slice(0, MAX_EMAIL_LEN);
}

function todayKey(date = new Date()) {
  // YYYY-MM-DD in UTC — bucket per civil day so a steady stream of
  // signups from one IP doesn't sneak past the cap by spanning midnight.
  return date.toISOString().slice(0, 10);
}

/**
 * Public subscribe callable.
 *
 * Inputs (all optional except email):
 *   - email: required, trimmed + lowercased + length-capped
 *   - source: which surface the signup came from (e.g.
 *             "marketing-footer"); defaults to "unknown"
 *   - companyWebsite: honeypot — any non-empty value drops silently
 *
 * Returns:
 *   - { ok: true, alreadySubscribed?: boolean } on success / dedupe
 *
 * Throws HttpsError for genuinely-bad input. Rate-limit and honeypot
 * hits return `{ ok: true }` so a bot doesn't get a useful signal.
 */
const subscribeToNewsletter = onCall({
  region: REGION,
  timeoutSeconds: 20,
  memory: "256MiB",
}, async (request) => {
  // Honeypot — bots fill the field; we silently no-op.
  if (request.data?.companyWebsite) {
    return {ok: true, alreadySubscribed: false};
  }

  const email = normaliseEmail(request.data?.email);
  if (!email || !EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN) {
    throw new HttpsError(
        "invalid-argument",
        "Please enter a valid email address.",
    );
  }

  let source = String(request.data?.source || "unknown").trim().slice(0, MAX_SOURCE_LEN);
  if (!ALLOWED_SOURCES.has(source)) source = "unknown";

  const db = admin.firestore();
  const ip = String(request.rawRequest?.ip || "unknown").slice(0, 64);

  // Per-IP daily cap (best-effort — IPv6 + corporate NATs share IPs,
  // but cheap clients all agree on a single IP and that's what we're
  // protecting against).
  if (ip !== "unknown") {
    const rlKey = `${ip}_${todayKey()}`;
    const rlRef = db.collection(RATE_LIMIT_COLLECTION).doc(rlKey);
    const rlSnap = await rlRef.get().catch(() => null);
    const count = rlSnap?.exists ? (rlSnap.data()?.count || 0) : 0;
    if (count >= MAX_PER_IP_PER_DAY) {
      // Same as honeypot — bot doesn't get a useful "you got rate
      // limited" hint. Real humans hitting this cap usually means
      // something genuinely odd; we accept it falls through silently.
      return {ok: true, alreadySubscribed: false};
    }
    // Increment the counter best-effort. A failed increment doesn't
    // block the signup.
    rlRef.set({
      ip,
      day: todayKey(),
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true}).catch((err) => {
      console.warn("[subscribeToNewsletter] rate-limit write failed", err);
    });
  }

  // Dedupe: doc id is the email, so set+merge does the right thing.
  const ref = db.collection(COLLECTION).doc(email);
  const existing = await ref.get();
  if (existing.exists) {
    // Touch lastSeenAt so we know the email is still in active use.
    ref.update({
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenSource: source,
    }).catch((err) => {
      console.warn("[subscribeToNewsletter] lastSeenAt update failed", err);
    });
    return {ok: true, alreadySubscribed: true};
  }

  await ref.set({
    email,
    source,
    ip,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    confirmed: false,    // reserve for future double-opt-in
    unsubscribedAt: null,
  });

  return {ok: true, alreadySubscribed: false};
});

module.exports = {subscribeToNewsletter};
