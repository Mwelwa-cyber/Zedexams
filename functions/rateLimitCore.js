"use strict";

// Pure, dependency-free helpers for the Firestore-backed request rate
// limiter. Split out (the *Core.js convention used across this codebase)
// so the window math, doc-id hygiene, and client-IP parsing test under
// plain `node` with no firebase-admin / firebase-functions import. The
// Firestore-touching layer lives in rateLimit.js.

// Firestore doc-id segments can't contain "/", can't be "." or "..", and
// have a 1500-byte ceiling. uids are trusted, but forwarded IPs and the
// action label flow into ids on the public endpoints, so scrub anything
// that could break the id or smuggle a path segment.
function sanitizeKeyPart(value, maxLength = 200) {
  const scrubbed = String(value == null ? "" : value)
    .replace(/[/\\]/g, "_")
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .replace(/^\.+/, "_") // "." / ".." are reserved ids; kill leading dots
    .slice(0, maxLength);
  return scrubbed || "unknown";
}

// Fixed-window bucket: the window start is `nowMs` floored to the window
// size, so every request in the same window shares one counter doc and a
// stale window can never gate a fresh one.
function windowStartFor(nowMs, windowMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
    return 0;
  }
  return Math.floor(nowMs / windowMs) * windowMs;
}

// Doc id: "{scope}_{windowStart}". scope already carries the action + subject
// (e.g. "aiChat:ip:41.x.x.x"); the windowStart suffix keeps consecutive
// windows in separate docs.
function rateLimitDocId(scope, windowStartMs) {
  return `${sanitizeKeyPart(scope, 380)}_${windowStartMs}`;
}

// A request is allowed while the pre-increment count is strictly below the
// cap. A non-positive limit means "no cap" (used as a disable sentinel).
function evaluate(count, limit) {
  const used = Number(count) || 0;
  const cap = Number(limit) || 0;
  const allowed = cap <= 0 ? true : used < cap;
  return { allowed, remaining: Math.max(0, cap - used) };
}

// Whole seconds until the current window rolls over (min 1 so a Retry-After
// header is never "0").
function retryAfterSeconds(nowMs, windowStartMs, windowMs) {
  const resetAt = windowStartMs + windowMs;
  return Math.max(1, Math.ceil((resetAt - nowMs) / 1000));
}

// Best-effort client IP behind Google's front-end + the Firebase Hosting
// proxy. `req.ip` is the immediate peer (usually the proxy, not the client),
// so prefer the LEFTMOST X-Forwarded-For entry — the original client the LB
// records. NOTE: a client can prepend its own XFF, so the per-IP limit is a
// spoofable backstop, not the primary control (that's the per-uid bucket).
function clientIpFrom(headerValue, fallbackIp) {
  const xff = String(headerValue || "");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first.slice(0, 64);
  }
  const fb = String(fallbackIp || "").trim();
  return fb ? fb.slice(0, 64) : "unknown";
}

module.exports = {
  sanitizeKeyPart,
  windowStartFor,
  rateLimitDocId,
  evaluate,
  retryAfterSeconds,
  clientIpFrom,
};
