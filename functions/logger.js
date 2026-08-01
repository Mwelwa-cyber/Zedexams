/**
 * Structured logging for Cloud Functions (OBS-003).
 *
 * The backend logs with `console.warn/error` and `[module]` tags, which Cloud
 * Logging stores as opaque text — you cannot query by field or trace one
 * request end to end. Cloud Logging DOES lift `severity` + `message` (and keeps
 * every other key as a queryable field) out of a JSON line on stdout/stderr, so
 * one `JSON.stringify` per line buys structured, filterable logs with no SDK.
 *
 * Every line can carry a correlation id (`rid`) so a single request is
 * traceable UI -> function -> data. This generalises the per-request logger
 * that `visitorTracking.js` grew inline (its `rid` read from the `x-request-id`
 * header, minted server-side when absent).
 *
 * Pure + injectable: `createLogger(module, fields, write)` takes an optional
 * sink so tests capture lines instead of hitting the console.
 */

const crypto = require("crypto");

const SEVERITY = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

/** A fresh correlation id. */
function newRequestId() {
  return crypto.randomUUID();
}

/**
 * The correlation id for an onRequest request: the client-propagated
 * `x-request-id` if present, else a fresh one. Bounded so a hostile header
 * can't bloat every log line, and stripped of anything but url-safe id chars.
 */
function requestIdFromReq(req, max = 64) {
  let raw = "";
  if (req && typeof req.get === "function") raw = req.get("x-request-id") || "";
  else if (req && req.headers) raw = req.headers["x-request-id"] || req.headers["X-Request-Id"] || "";
  const cleaned = String(raw).replace(/[^A-Za-z0-9._-]/g, "").slice(0, max);
  return cleaned || newRequestId();
}

// Route to the console method whose stream matches the severity, so even a
// consumer that ignores the JSON `severity` field still sees warn/error
// correctly (stderr). Overridable for tests.
function defaultWrite(severity, line) {
  if (severity === "ERROR") console.error(line);
  else if (severity === "WARNING") console.warn(line);
  else console.log(line);
}

/**
 * Build a logger bound to `module` and `baseFields` (e.g. `{rid}`).
 * Returns { debug, info, warn, error, child }.
 */
function createLogger(module, baseFields = {}, write = defaultWrite) {
  const base = { ...baseFields };

  const at = (levelKey) => (message, fields = {}) => {
    const severity = SEVERITY[levelKey];
    // Reserved keys are written LAST so a caller field named `message`,
    // `severity` or `module` can never clobber the event name / level / source
    // (which is what log filters and alerts match on). Put a varying value under
    // its own field (e.g. `errorMessage`) instead.
    const entry = { ...base, ...fields, module, severity, message };
    // Never let a broken logger throw into the caller's happy path.
    try {
      write(severity, JSON.stringify(entry));
    } catch (err) {
      try { console.error(`[${module}] log-failed`, err && err.message); } catch { /* noop */ }
    }
    return entry;
  };

  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    /** Bind extra fields (typically a correlation id) for a sub-scope. */
    child(childFields = {}) {
      return createLogger(module, { ...base, ...childFields }, write);
    },
  };
}

module.exports = { createLogger, newRequestId, requestIdFromReq, SEVERITY };
