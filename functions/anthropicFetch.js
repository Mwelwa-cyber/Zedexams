/**
 * Shared fetch wrapper for the Anthropic Messages API.
 *
 * Why this exists: every direct caller (aiService.callAnthropic,
 * aiService.callAnthropicStream, teacherTools/anthropicClient.callClaude)
 * threw immediately on the first 429. Bursty callers can blow past the
 * org-level 30k input-tokens-per-minute quota and crash with no chance to
 * recover.
 *
 * This helper retries 429 (rate limit), 529 (overloaded) and 5xx with
 * exponential backoff, honouring the `retry-after` header when Anthropic
 * sends one. Successful (2xx) responses pass through untouched so the
 * caller can stream or json().
 *
 * It is also the one place every Messages request passes through, so it is
 * where a request is shaped for its model: fields a model refuses (non-default
 * sampling on Sonnet 5 / Opus 4.7+) are dropped, and Sonnet 5's thinking
 * default is pinned off. See anthropicRequestPolicy.js.
 */

const {applyRequestPolicy} = require("./anthropicRequestPolicy");

const DEFAULT_MAX_RETRIES = 4;
const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  // 1.5s, 3s, 6s, 8s, 8s — plus 0-500ms jitter to spread retries across
  // concurrent calls hitting the same bucket.
  const base = Math.min(1500 * 2 ** attempt, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * 500);
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const ts = new Date(headerValue).getTime();
  if (Number.isFinite(ts)) return Math.max(0, ts - Date.now());
  return null;
}

function isRetryableStatus(status) {
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

/**
 * Drop the fields the target model refuses (see anthropicRequestPolicy.js).
 * Only a Messages request with a JSON string body is touched; anything else,
 * or a body the policy leaves alone, goes out as the very same object.
 */
function shapeRequest(url, init) {
  if (!init || typeof init.body !== "string") return init;
  if (!/\/v1\/messages\/?$/.test(String(url))) return init;
  let parsed;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    return init;
  }
  const {body, changed} = applyRequestPolicy(parsed);
  return changed ? {...init, body: JSON.stringify(body)} : init;
}

/**
 * fetch() with retry-on-429/529/5xx. Returns a Response.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=4]
 * @param {string} [opts.label="anthropic"]  Used in log lines.
 * @returns {Promise<Response>}
 */
async function anthropicFetch(url, init, opts = {}) {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const label = opts.label || "anthropic";
  const request = shapeRequest(url, init);
  let lastNetworkErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(url, request);
    } catch (err) {
      lastNetworkErr = err;
      if (attempt === maxRetries) throw err;
      const delay = backoffMs(attempt);
      console.warn(
        `[${label}] network error, retrying in ${delay}ms ` +
        `(attempt ${attempt + 1}/${maxRetries + 1})`,
        err?.message,
      );
      await sleep(delay);
      continue;
    }

    if (res.ok) return res;
    if (!isRetryableStatus(res.status) || attempt === maxRetries) return res;

    const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
    const delay = Math.min(
      retryAfter ?? backoffMs(attempt),
      MAX_RETRY_AFTER_MS,
    );

    console.warn(
      `[${label}] HTTP ${res.status}, retrying in ${delay}ms ` +
      `(attempt ${attempt + 1}/${maxRetries + 1})`,
    );

    // Drain the body so the underlying connection can be reused.
    try {
      await res.text();
    } catch {
      // ignore
    }
    await sleep(delay);
  }

  // Loop guarantees a return inside, but TypeScript-style fallthrough.
  if (lastNetworkErr) throw lastNetworkErr;
  throw new Error(`[${label}] retry loop exited without a response`);
}

function isRateLimitError(err) {
  if (!err) return false;
  if (err.status === 429) return true;
  const msg = String(err.message || "");
  return /rate limit|tokens per minute|exceed.*quota/i.test(msg);
}

module.exports = {anthropicFetch, isRateLimitError};
