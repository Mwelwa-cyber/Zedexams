/**
 * Guardian pay link — the one piece of the old parent app that survives.
 *
 * The logged-in parent app (the approval feed, child detail, family sharing,
 * the weekly report) was retired in stages in 2026-10: the screens in 4b-1,
 * the callables behind them in 4b-2. Only `resolveGuardianPayLink` remains,
 * because `/guardian-unlock` needs it and a guardian paying from an emailed
 * link has no account to authorise anything with. The directory keeps its
 * name because `functions/index.js` and the functions manifest address it.
 */

const {getFirestore} = require("firebase-admin/firestore");
const {
  enforceRateLimit,
  standardBuckets,
  resolveClientIp,
} = require("../rateLimit");

const REQUESTS = "guardianRequests";

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Resolve the token in a guardian's pay link.
 *
 * `requestGuardianUnlock` mails every guardian a link to
 * /guardian-unlock?t=<raw token>, and the raw token is never stored —
 * `guardianRequests`' doc id is its sha256. So the landing page cannot
 * look anything up without asking the server to hash it.
 *
 * UNAUTHENTICATED on purpose: the guardian who receives that email may
 * have no ZedExams account at all, and a link that demands a sign-in
 * before it will say what it is about is a link people close. What it
 * returns is bounded to what the email they are holding already told
 * them — the child's first name and the plan quoted — and it requires a
 * 32-byte secret to return anything. It grants nothing; paying still
 * goes through the authorised checkout.
 */
async function resolveGuardianPayLink(request) {
  const rawToken = String(request.data?.token || "").trim();
  if (!rawToken) return {valid: false, reason: "missing"};

  const db = getFirestore();

  // Unauthenticated by design (see the header) — and every call with a
  // token-shaped string reaches two Firestore reads before it can reject.
  // The 32-byte secret makes guessing infeasible, but that is a DISCLOSURE
  // argument and says nothing about cost; the sibling unauthenticated
  // callable, assessRecaptcha, caps itself per source IP for exactly this
  // reason and this one did not.
  //
  // The cap answers with the same shape a bad token gets, rather than
  // throwing: a guardian who has just opened a link from their email should
  // never see an error page because somebody else hammered the endpoint, and
  // "we could not resolve this link" is already a state the landing page
  // renders. A limiter that is itself unwell must not block a real guardian,
  // so it fails open.
  try {
    const ip = request.rawRequest ? resolveClientIp(request.rawRequest) : "unknown";
    const rl = await enforceRateLimit(
        db,
        standardBuckets({action: "guardian-pay-link", ip, ipPerMin: 30}),
    );
    if (!rl.allowed) return {valid: false, reason: "rate-limited"};
  } catch (_rlErr) { /* fail open — a limiter fault must not close a real link */ }

  const requestId = require("node:crypto")
      .createHash("sha256").update(rawToken).digest("hex");

  const snap = await db.collection(REQUESTS).doc(requestId).get();
  if (!snap.exists) return {valid: false, reason: "unknown"};
  const record = snap.data() || {};

  const expiresAt = toMillis(record.expiresAt);
  if (expiresAt != null && expiresAt <= Date.now()) return {valid: false, reason: "expired"};
  if (record.status === "paid") return {valid: false, reason: "already-paid", requestId};
  if (record.status !== "sent") return {valid: false, reason: "withdrawn"};

  const childSnap = await db.collection("users").doc(record.uid).get();
  const child = childSnap.exists ? (childSnap.data() || {}) : {};

  return {
    valid: true,
    requestId,
    childUid: record.uid,
    // First name only. The email said this much; the surname is not
    // needed to decide and is not offered.
    childFirstName: child.firstName || (child.displayName || "").split(" ")[0] || "your child",
    planId: record.planId || null,
    priceZMW: Number.isFinite(Number(record.priceZMW)) ? Number(record.priceZMW) : null,
    feature: record.feature || null,
  };
}

module.exports = {resolveGuardianPayLink};
