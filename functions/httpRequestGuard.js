"use strict";

/**
 * Inbound request vetting for the JSON POST endpoints
 * (SECURITY_ENDPOINT_AUDIT.md §4.5): assert the declared Content-Type and cap
 * the declared body size, before a handler spends anything on the payload.
 *
 * ## This is NOT applied to every POST, and the exceptions are the point
 *
 * Two surfaces would BREAK under a blanket rule, so both are excluded
 * deliberately rather than overlooked:
 *
 *  • `apiGuardianConsent` receives an HTML `<form method="POST">` from the
 *    decision page a guardian opens from their email. That is
 *    `application/x-www-form-urlencoded` BY DESIGN. Asserting JSON there would
 *    break consent for every under-age signup — the loudest possible failure,
 *    on the one flow whose users cannot work around it.
 *
 *  • The provider webhooks (`lencoWebhook`, `apiWhatsAppWebhook`) set their own
 *    headers, and their real gate is an HMAC signature that already makes a
 *    forged body unusable. A Content-Type assertion adds nothing there and hands
 *    a provider the ability to break payments by adjusting a header. They may
 *    still take a SIZE cap, which cannot break a well-formed delivery.
 *
 * So the Content-Type half applies only where the client is ours and was checked
 * to send JSON. `test:http-request-guard` records that list, and a control in it
 * proves the assertion can actually reject.
 *
 * ## Why this is worth having at all, given downstream validation
 *
 * The audit rates it low precisely because field validation already rejects a
 * malformed body. What it adds is REFUSING EARLIER — before the JSON parse and
 * before any per-request budget — and a declared-size cap that a body-parser
 * limit alone does not express at the edge.
 */

// 1 MiB. Every first-party JSON payload here is a handful of fields plus, at
// most, a few thousand characters of text; the largest legitimate one (a TTS
// request) is capped at 3000 chars upstream. Cloud Functions would accept
// megabytes by default.
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Does this Content-Type declare JSON?
 * Accepts parameters (`application/json; charset=utf-8`) and the +json suffix
 * tree (`application/merge-patch+json`), because rejecting a correct request on
 * a charset parameter is a bug, not strictness.
 */
function isJsonContentType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  const type = raw.split(";")[0].trim();
  return type === "application/json" || type.endsWith("+json");
}

/**
 * Decide whether to reject. Pure — no req/res — so the table of cases is
 * testable without faking Express.
 *
 * @returns {{reject: boolean, status: number, message: string, reason: string}}
 */
function vetJsonRequest({contentType, contentLength, maxBytes = DEFAULT_MAX_BODY_BYTES}) {
  if (!isJsonContentType(contentType)) {
    return {
      reject: true,
      status: 415,
      reason: "content-type",
      message: "Expected Content-Type: application/json.",
    };
  }
  // Content-Length is a CLAIM, not a guarantee — a chunked request omits it and
  // a liar can understate it. It is still worth checking: it rejects the honest
  // oversized request for free, and the platform's own body limit remains the
  // backstop for the rest. Absent or unparseable is NOT treated as oversized,
  // because that would reject every chunked upload.
  const declared = Number(contentLength);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return {
      reject: true,
      status: 413,
      reason: "too-large",
      message: "Request body is too large.",
    };
  }
  return {reject: false, status: 0, reason: "ok", message: ""};
}

/**
 * Express-shaped wrapper. Returns true if it has ALREADY responded, so a caller
 * reads as `if (enforceJsonRequest(req, res, {...})) return;`.
 */
function enforceJsonRequest(req, res, {maxBytes = DEFAULT_MAX_BODY_BYTES, label = ""} = {}) {
  const verdict = vetJsonRequest({
    contentType: req.get ? req.get("content-type") : undefined,
    contentLength: req.get ? req.get("content-length") : undefined,
    maxBytes,
  });
  if (!verdict.reject) return false;
  console.warn(`[httpGuard:${label || "unknown"}] rejected`, {
    reason: verdict.reason,
    status: verdict.status,
  });
  res.status(verdict.status).json({error: verdict.message});
  return true;
}

module.exports = {
  DEFAULT_MAX_BODY_BYTES,
  isJsonContentType,
  vetJsonRequest,
  enforceJsonRequest,
};
