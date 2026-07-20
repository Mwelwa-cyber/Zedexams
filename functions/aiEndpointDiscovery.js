/**
 * Auto-discovery for the AI provider-call coverage guard (B3 / OBS-005, Gate 3).
 *
 * The hand-maintained inventory (aiProviderCallInventory.js) can only prove
 * that the endpoints SOMEONE LISTED still carry a limiter. It cannot catch the
 * real risk: a NEW provider-backed callable added to functions/index.js with no
 * limiter AND no inventory row — the substring test stays green because the new
 * endpoint was never listed. This module closes that hole by DISCOVERING the
 * deployed surface directly from index.js and letting the test fail on any
 * provider-backed, user-invokable endpoint that is neither rate-limited nor
 * explicitly exempted-with-a-reason.
 *
 * Ground-truth signals (no call-graph tracing, no runtime — pure text over
 * source so it runs under plain `node` with no firebase deps):
 *
 *   • Deployed surface  — every `exports.<Name> = …` in functions/index.js is
 *     a deployable Cloud Function. That is the authoritative list.
 *   • Provider-backed    — a function that reaches Anthropic/OpenAI/Gemini MUST
 *     bind that provider's API-key secret, or the call fails at deploy/runtime.
 *     So the export's definition span referencing a provider secret var
 *     (anthropicApiKey / openaiApiKey / geminiApiKey) — as a factory argument
 *     (`createX(anthropicApiKey)`) or inside the handler's `secrets: [ … ]`
 *     array — is a reliable, deployment-level "this can spend money" signal.
 *   • Kind (callable / http / scheduled / trigger) — from the on* constructor,
 *     resolved through index.js's require map for factory exports. Only
 *     `callable` + `http` are user-burstable; `scheduled` (cron) and `trigger`
 *     (Firestore onDocument*) have no client entry point and are excluded.
 *
 * The result is intentionally CONSERVATIVE: an endpoint whose kind can't be
 * resolved is reported as `unknown`, and the test treats an unknown that is
 * provider-backed as still-needing-classification, so a resolver miss fails
 * loud rather than passing silently.
 */

"use strict";

// Var names bound to the provider secrets in functions/index.js (see the
// defineSecret lines). Any of these in a definition span ⇒ provider-backed.
const PROVIDER_SECRET_VARS = [
  "anthropicApiKey",
  "openaiApiKey",
  "openAiApiKey",
  "geminiApiKey",
  "geminiKey",
];
const PROVIDER_SECRET_RE = new RegExp(`\\b(${PROVIDER_SECRET_VARS.join("|")})\\b`);

/**
 * Parse `exports.<Name> = <rhs…>` blocks out of index.js. The "span" of an
 * export is the text from its own line up to (but excluding) the next
 * `exports.` line — enough to see a handler's options block (`secrets: […]`)
 * or a factory's argument list.
 *
 * @param {string} indexSrc
 * @returns {Array<{name: string, rhsFirstLine: string, span: string}>}
 */
function parseExports(indexSrc) {
  const lines = String(indexSrc).split("\n");
  const starts = [];
  const re = /^exports\.([A-Za-z0-9_]+)\s*=\s*(.*)$/;
  lines.forEach((line, i) => {
    const m = re.exec(line);
    if (m) starts.push({name: m[1], rhsFirstLine: m[2], lineIdx: i});
  });
  return starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].lineIdx : lines.length;
    return {
      name: s.name,
      rhsFirstLine: s.rhsFirstLine.trim(),
      span: lines.slice(s.lineIdx, end).join("\n"),
    };
  });
}

/**
 * Build identifier → relative-require-path map from index.js. Handles:
 *   const { a, b } = require("./p")           → a→./p, b→./p
 *   const { orig: alias } = require("./p")    → alias→./p
 *   const X = require("./p")                  → X→./p
 * (multi-line destructures included via the [^}] class + s-flag).
 *
 * @param {string} indexSrc
 * @returns {Map<string,string>}
 */
function buildRequireMap(indexSrc) {
  const map = new Map();
  const src = String(indexSrc);
  // Destructured: const { … } = require("./path")
  const destructure = /const\s*\{([^}]*)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/gs;
  let m;
  while ((m = destructure.exec(src)) !== null) {
    const path = m[2];
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (!part) continue;
      // `orig: alias` → bind the alias (the local name actually used).
      const name = part.includes(":") ? part.split(":")[1].trim() : part;
      if (/^[A-Za-z0-9_]+$/.test(name)) map.set(name, path);
    }
  }
  // Whole-module: const X = require("./path")
  const whole = /const\s+([A-Za-z0-9_]+)\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/g;
  while ((m = whole.exec(src)) !== null) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
}

function kindFromSource(text) {
  if (/\bmakeStreamingEndpoint\s*\(/.test(text)) return "http";
  if (/\bonRequest\s*\(/.test(text)) return "http";
  if (/\bonDocument[A-Za-z]*\s*\(/.test(text)) return "trigger";
  if (/\bonSchedule\s*\(/.test(text)) return "scheduled";
  if (/\bonCall\s*\(/.test(text)) return "callable";
  return null;
}

/**
 * Resolve a require path to a readable functions/-relative file path (adds
 * `.js`, or `/index.js` for a directory-style require if the file lookup fails).
 */
function resolveDefFile(relPath, readFile) {
  const candidates = relPath.endsWith(".js")
    ? [relPath.replace(/^\.\//, "")]
    : [relPath.replace(/^\.\//, "") + ".js", relPath.replace(/^\.\//, "") + "/index.js"];
  for (const c of candidates) {
    const src = readFile(c);
    if (src != null) return {file: c, src};
  }
  return null;
}

/**
 * Determine the Cloud Function KIND for one export.
 *
 * @returns {'callable'|'http'|'scheduled'|'trigger'|'unknown'}
 */
function resolveKind(exp, requireMap, readFile) {
  // 1. Inline constructor on the RHS (or anywhere in the handler span).
  const inline = kindFromSource(exp.span);
  if (inline) return inline;

  // 2. Factory / re-export → follow to the definition file.
  //    Forms: `createX(...)`, `require("./p").name`, or a bare identifier.
  const rhs = exp.rhsFirstLine;
  const inlineRequire = /require\(\s*["'](\.[^"']+)["']\s*\)/.exec(rhs);
  let defPath = null;
  if (inlineRequire) {
    defPath = inlineRequire[1];
  } else {
    const identMatch = /^([A-Za-z0-9_]+)/.exec(rhs);
    if (identMatch) defPath = requireMap.get(identMatch[1]) || null;
  }
  if (!defPath) return "unknown";

  const resolved = resolveDefFile(defPath, readFile);
  if (!resolved) return "unknown";
  return kindFromSource(resolved.src) || "unknown";
}

function isProviderBacked(span) {
  return PROVIDER_SECRET_RE.test(span);
}

/**
 * Discover every deployed function in index.js, tagged with kind +
 * provider-backedness.
 *
 * @param {object} deps
 * @param {string} deps.indexSrc — contents of functions/index.js
 * @param {(relPath: string) => string|null} deps.readFile — returns file text
 *   (functions/-relative) or null when absent. MUST NOT throw.
 * @returns {Array<{name, kind, providerBacked, userInvokable}>}
 */
function discoverEndpoints({indexSrc, readFile}) {
  const requireMap = buildRequireMap(indexSrc);
  return parseExports(indexSrc).map((exp) => {
    const kind = resolveKind(exp, requireMap, readFile);
    return {
      name: exp.name,
      kind,
      providerBacked: isProviderBacked(exp.span),
      userInvokable: kind === "callable" || kind === "http" || kind === "unknown",
    };
  });
}

module.exports = {
  PROVIDER_SECRET_VARS,
  parseExports,
  buildRequireMap,
  resolveKind,
  isProviderBacked,
  kindFromSource,
  discoverEndpoints,
};
