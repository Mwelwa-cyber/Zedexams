/**
 * AI cost tracking (audit B4).
 *
 * Per-call usage logging that aggregates into per-day rollups so the
 * /admin/ai-costs dashboard can show:
 *   - today's spend + 7-day chart
 *   - top consumers (per-uid totals)
 *   - per-tool breakdown
 *   - anomaly badge when today exceeds 2× the 7-day median
 *
 * Storage shape — three docs per call, all updates via
 * FieldValue.increment so concurrent writes don't collide:
 *
 *   aiUsage/{date}                              // global daily totals
 *     totalInputTokens, totalOutputTokens,
 *     totalCacheCreationTokens, totalCacheReadTokens,
 *     totalCostUsd, callCount, updatedAt
 *
 *   aiUsage/{date}/users/{uid}                  // per-user daily totals
 *     inputTokens, outputTokens, cacheCreation, cacheRead,
 *     costUsd, callCount, updatedAt
 *
 *   aiUsage/{date}/tools/{toolName}             // per-tool daily totals
 *     inputTokens, outputTokens, costUsd, callCount, updatedAt
 *
 * Cost calculation uses a price table keyed on the Anthropic model id.
 * Anthropic's published rates (USD per million tokens) for Claude
 * Sonnet 4.5 are $3 input, $15 output, $0.30 cache read, $3.75 5-min
 * cache write. Sonnet 3.5 / 3.7 are the same shape; Haiku and Opus
 * have separate entries below. Unknown models log at zero cost so we
 * don't fabricate numbers — the call is still counted.
 */

const admin = require("firebase-admin");
const crypto = require("node:crypto");
const {
  getBudgetMode,
  getReinvestRatio,
  getZmwPerUsd,
  getBudgetFloorUsd,
  deriveBudgetFromRevenueUsd,
  resolveZmwPerUsd,
  FX_MAX_AGE_MS,
} = require("./treasury");
const {
  resolveShardCount,
  pickShardId,
  toolShardDocId,
  sumShardDocs,
} = require("./shardedCounter");
const reservation = require("./aiBudgetReservation");

// All rates in USD per million tokens.
const PRICE_PER_MTOK = {
  // Default (current production model — keep in sync with ANTHROPIC_MODEL).
  default: {
    input: 3.00,
    output: 15.00,
    cacheCreation5m: 3.75,
    cacheRead: 0.30,
  },
  // Family-prefix overrides. The lookup walks longest-prefix first so
  // a future "claude-haiku-4-5" picks the haiku entry, not default.
  "claude-haiku": {
    input: 1.00,
    output: 5.00,
    cacheCreation5m: 1.25,
    cacheRead: 0.10,
  },
  "claude-opus": {
    input: 15.00,
    output: 75.00,
    cacheCreation5m: 18.75,
    cacheRead: 1.50,
  },
  "claude-sonnet": {
    input: 3.00,
    output: 15.00,
    cacheCreation5m: 3.75,
    cacheRead: 0.30,
  },
  // OpenAI (Zed chat + short-answer marking). recordAiUsage maps OpenAI's
  // {prompt_tokens, completion_tokens} onto {input_tokens, output_tokens};
  // we don't forward OpenAI cached-token counts, so the cache fields stay 0.
  // The longest-prefix lookup keeps "gpt-4o-mini" off the "gpt-4o" rate.
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.60,
    cacheCreation5m: 0,
    cacheRead: 0,
  },
  "gpt-4o": {
    input: 2.50,
    output: 10.00,
    cacheCreation5m: 0,
    cacheRead: 0,
  },
  // Catch-all so an unrecognised gpt-* model never falls back to the
  // (Anthropic Sonnet) default rates and overstates spend.
  "gpt": {
    input: 0.50,
    output: 1.50,
    cacheCreation5m: 0,
    cacheRead: 0,
  },
  // Google Gemini text (document import, OCR structuring, answer suggest).
  // callGemini maps usageMetadata's promptTokenCount/candidatesTokenCount
  // onto {input_tokens, output_tokens}; no cache accounting on this path.
  "gemini-2.5-flash": {
    input: 0.30,
    output: 2.50,
    cacheCreation5m: 0,
    cacheRead: 0,
  },
  // Catch-all: every Gemini text path here is a flash variant, so an
  // unrecognised gemini-* id prices at flash rates rather than zero.
  // (Gemini IMAGE generations are flat-priced via IMAGE_PRICE_USD below,
  // never token-priced through this table.)
  "gemini": {
    input: 0.30,
    output: 2.50,
    cacheCreation5m: 0,
    cacheRead: 0,
  },
  // OpenAI embeddings (Qix semantic dedup). Input-only pricing.
  "text-embedding-3-small": {
    input: 0.02,
    output: 0,
    cacheCreation5m: 0,
    cacheRead: 0,
  },
  "text-embedding-3-large": {
    input: 0.13,
    output: 0,
    cacheCreation5m: 0,
    cacheRead: 0,
  },
};

// Truly unknown models log at zero cost so we don't fabricate numbers —
// the call is still counted (see header comment).
const ZERO_RATES = {input: 0, output: 0, cacheCreation5m: 0, cacheRead: 0};

function pickRates(model) {
  const id = String(model || "").toLowerCase();
  // Longest-prefix match. Family entries are short (~12 chars), full
  // model ids are ~25 chars, so this is fine without a real trie.
  let best = null;
  for (const key of Object.keys(PRICE_PER_MTOK)) {
    if (key === "default") continue;
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  if (best) return PRICE_PER_MTOK[best];
  // A claude-* id from a future family without its own row prices at the
  // default production rates; anything else logs at zero (never at Sonnet
  // rates, which would fabricate spend for e.g. an unlisted provider).
  return id.startsWith("claude") ? PRICE_PER_MTOK.default : ZERO_RATES;
}

// Flat per-image pricing in USD. gpt-image-1 bills per image by
// quality × size (the repo's default is medium 1536x1024 ≈ $0.063 — the
// "~$0.06/image" noted in generateDiagram). Gemini 2.5 Flash Image is a
// flat per-image rate (≈1290 image-output tokens at $30/MTok). Keyed by
// longest model-id prefix like PRICE_PER_MTOK.
const IMAGE_PRICE_USD = {
  "gpt-image-1": {
    low: {"1024x1024": 0.011, "1024x1536": 0.016, "1536x1024": 0.016},
    medium: {"1024x1024": 0.042, "1024x1536": 0.063, "1536x1024": 0.063},
    high: {"1024x1024": 0.167, "1024x1536": 0.250, "1536x1024": 0.250},
  },
  "gemini-2.5-flash-image": 0.039,
};

/**
 * Flat USD cost of one generated image. Unknown models / quality / size
 * combinations return 0 (counted, not fabricated) — same policy as
 * pickRates for unknown text models.
 */
function imageCostUsd(model, {quality, size} = {}) {
  const id = String(model || "").toLowerCase();
  let best = null;
  for (const key of Object.keys(IMAGE_PRICE_USD)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  const entry = best ? IMAGE_PRICE_USD[best] : null;
  if (typeof entry === "number") return entry;
  if (!entry) return 0;
  const byQuality = entry[String(quality || "").toLowerCase()];
  return (byQuality && byQuality[String(size || "")]) || 0;
}

// ── Text-to-speech (character-billed) ─────────────────────────────────
//
// Google Cloud TTS bills per CHARACTER of input, not per token, so neither
// PRICE_PER_MTOK nor IMAGE_PRICE_USD can express it — hence a third table.
// Rates are USD per MILLION characters, keyed by the voice TIER.
//
// Tier is the third segment of a Google voice name (`en-GB-Neural2-A` →
// Neural2), which is why this is a segment lookup rather than the
// longest-PREFIX match the other two tables use: every voice shares the
// `en-` prefix and differs in the middle, so prefix matching would price a
// Studio voice at Standard rates. That is a 40× error in the expensive
// direction, on the one surface where a learner can trigger synthesis in a
// loop.
//
// The spread is the reason this is worth pricing at all rather than counting
// calls: one Studio character costs 40× a Standard one, so "how many TTS
// calls did we serve" says almost nothing about the bill.
const TTS_PRICE_PER_MCHAR = {
  standard: 4.00,
  wavenet: 16.00,
  neural2: 16.00,
  polyglot: 16.00,
  studio: 160.00,
};

/**
 * The billing tier of a Google Cloud TTS voice name, lowercased, or null
 * when the name does not carry a tier we have a rate for.
 *
 * Scans the segments rather than indexing a fixed position: the ALLOWED_VOICES
 * list in tts.js is all `{lang}-{region}-{Tier}-{Variant}`, but Google also
 * ships names with a different shape, and silently reading the wrong segment
 * would price them at zero without anything saying so.
 */
function ttsVoiceTier(voice) {
  const parts = String(voice || "").toLowerCase().split("-");
  for (const part of parts) {
    if (Object.prototype.hasOwnProperty.call(TTS_PRICE_PER_MCHAR, part)) return part;
  }
  return null;
}

/**
 * USD cost of synthesising `characters` characters with `voice`.
 *
 * An unrecognised voice or a non-finite/negative character count returns 0 —
 * the same "count the call, never fabricate a number" policy as pickRates and
 * imageCostUsd. A voice we cannot price is a gap to notice in the per-tool
 * rollup (calls with no cost), not a number to guess at.
 */
function ttsCostUsd(voice, characters) {
  const tier = ttsVoiceTier(voice);
  if (!tier) return 0;
  const chars = Number(characters);
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return (chars * TTS_PRICE_PER_MCHAR[tier]) / 1_000_000;
}

/**
 * Fire-and-forget rollup for a character-billed speech synthesis. Same
 * never-throws contract as recordAiUsage / recordAiImageUsage.
 *
 *   recordAiTtsUsage({ uid, voice, characters, tool })
 *
 * Records no tokens (there are none) but DOES record the character count, so
 * the rollups carry the unit this spend is actually billed in — cost alone
 * cannot be turned back into volume once two tiers are mixed in one total.
 *
 * `cached: true` records the call at ZERO cost while still recording its
 * characters. That is what makes the audio cache's saving measurable rather
 * than merely asserted: a cache-hit row carries the volume served, so what it
 * saved is that volume priced at the voice's own rate — the counterfactual
 * bill. Recording hits at their notional cost would inflate spend that was
 * never incurred; not recording them at all would leave the cache's whole
 * value invisible on the dashboard that justifies it.
 */
async function recordAiTtsUsage({uid, voice, characters, tool, cached = false}) {
  const chars = Number(characters);
  return writeUsageRollups({
    uid,
    tool,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
    characters: Number.isFinite(chars) && chars > 0 ? chars : 0,
    costUsd: cached ? 0 : ttsCostUsd(voice, characters),
  });
}

function dateKeyUtc() {
  // Same UTC YYYY-MM-DD shape used elsewhere (results.completedAt
  // ISO-slice, dailyExamPicker, etc.). Cheap, no Lusaka-aware logic
  // needed for cost reports.
  return new Date().toISOString().slice(0, 10);
}

// YYYY-MM, used for the month-to-date spend rollup that the budget
// ceiling reads. Deliberately a SEPARATE collection (aiUsageMonthly)
// from the daily aiUsage/{date} docs: the /admin/ai-costs dashboard
// lists aiUsage with `where('__name__', '>=', since)`, and a
// 'month-…' doc id sorts after the date ids and would surface as a
// bogus daily row. Keeping the monthly doc in its own collection avoids
// that entirely.
const MONTHLY_COLLECTION = "aiUsageMonthly";

function monthKeyUtc() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Compute USD cost from token usage and a model id. All tokens default
 * to 0 if the upstream didn't report them (e.g. a streaming abort).
 */
function computeCostUsd(model, usage = {}) {
  const rates = pickRates(model);
  const input = (usage.input_tokens || 0) * rates.input;
  const output = (usage.output_tokens || 0) * rates.output;
  const cacheCreate = (usage.cache_creation_input_tokens || 0) * rates.cacheCreation5m;
  const cacheRead = (usage.cache_read_input_tokens || 0) * rates.cacheRead;
  return (input + output + cacheCreate + cacheRead) / 1_000_000;
}

/**
 * Fire-and-forget write of one call's usage into the daily rollups.
 * Returns the inferred cost so callers / tests can assert on it, but
 * never throws — accounting failures must not crash the user-facing
 * AI flow.
 *
 *   recordAiUsage({ uid, model, usage, tool })
 *     uid    — auth uid of the caller (null for system / cron usage)
 *     model  — Anthropic model id from the response
 *     usage  — Anthropic usage block: { input_tokens, output_tokens,
 *              cache_creation_input_tokens, cache_read_input_tokens }
 *     tool   — short label of the calling Cloud Function
 *              ('aiChat', 'generateQuiz', 'lessonPlan', etc.)
 */
async function recordAiUsage({uid, model, usage, tool}) {
  return writeUsageRollups({
    uid,
    tool,
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    cacheCreation: usage?.cache_creation_input_tokens || 0,
    cacheRead: usage?.cache_read_input_tokens || 0,
    costUsd: computeCostUsd(model, usage),
  });
}

/**
 * Fire-and-forget rollup for flat-priced image generations (gpt-image-1,
 * Gemini image) — no token accounting; the cost comes from IMAGE_PRICE_USD
 * by model + quality + size. Same never-throws contract as recordAiUsage.
 *
 *   recordAiImageUsage({ uid, model, quality, size, tool })
 */
async function recordAiImageUsage({uid, model, quality, size, tool}) {
  return writeUsageRollups({
    uid,
    tool,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
    costUsd: imageCostUsd(model, {quality, size}),
  });
}

/**
 * Shared rollup writer behind recordAiUsage / recordAiImageUsage. Never
 * throws — accounting failures must not crash the user-facing AI flow.
 *
 * The day-total, month-total, and per-tool counters are SHARDED (each call
 * increments one random shard doc) so a burst of concurrent AI calls — or a
 * single tool dominating traffic — never serialises on one hot document.
 * The per-user counter is left un-sharded: it's already keyed per uid, so it
 * spreads across users on its own. Readers sum the shards back together
 * (shardedCounter.sumShardDocs / groupToolShards).
 */
async function writeUsageRollups({
  uid, tool, inputTokens, outputTokens, cacheCreation, cacheRead, costUsd,
  // Character-billed surfaces (TTS) report volume here. Defaulted so every
  // existing token/image caller keeps its current call shape and simply
  // increments by 0 — the field is additive on a merge:true write, so docs
  // written before this existed stay valid.
  characters = 0,
}) {
  try {
    const db = admin.firestore();
    const date = dateKeyUtc();
    const month = monthKeyUtc();

    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const now = admin.firestore.FieldValue.serverTimestamp();
    // One shard id per call, reused across the day/month/tool counters.
    const shardId = pickShardId(resolveShardCount());

    const dayRef = db.collection("aiUsage").doc(date);

    // Day totals → aiUsage/{date}/shards/{shardId}
    const writes = [];
    writes.push(dayRef.collection("shards").doc(String(shardId)).set({
      date,
      totalInputTokens: inc(inputTokens),
      totalOutputTokens: inc(outputTokens),
      totalCacheCreationTokens: inc(cacheCreation),
      totalCacheReadTokens: inc(cacheRead),
      totalCharacters: inc(characters),
      totalCostUsd: inc(costUsd),
      callCount: inc(1),
      updatedAt: now,
    }, {merge: true}));

    // Per-user totals → aiUsage/{date}/users/{uid} (UNCHANGED — per-uid).
    if (uid) {
      writes.push(dayRef.collection("users").doc(uid).set({
        uid,
        inputTokens: inc(inputTokens),
        outputTokens: inc(outputTokens),
        cacheCreation: inc(cacheCreation),
        cacheRead: inc(cacheRead),
        characters: inc(characters),
        costUsd: inc(costUsd),
        callCount: inc(1),
        updatedAt: now,
      }, {merge: true}));
    }

    // Per-tool totals → aiUsage/{date}/toolShards/{tool}__{shardId}
    // (flattened so every doc is a real, listable doc regardless of parent).
    if (tool) {
      const safeTool = String(tool).slice(0, 64);
      writes.push(dayRef.collection("toolShards").doc(toolShardDocId(safeTool, shardId)).set({
        tool: safeTool,
        inputTokens: inc(inputTokens),
        outputTokens: inc(outputTokens),
        characters: inc(characters),
        costUsd: inc(costUsd),
        callCount: inc(1),
        updatedAt: now,
      }, {merge: true}));
    }

    // Month-to-date totals → aiUsageMonthly/{month}/shards/{shardId}
    // (the ceiling reads this — summed across shards).
    writes.push(db.collection(MONTHLY_COLLECTION).doc(month)
        .collection("shards").doc(String(shardId)).set({
          month,
          totalInputTokens: inc(inputTokens),
          totalOutputTokens: inc(outputTokens),
          totalCacheCreationTokens: inc(cacheCreation),
          totalCacheReadTokens: inc(cacheRead),
          totalCharacters: inc(characters),
          totalCostUsd: inc(costUsd),
          callCount: inc(1),
          updatedAt: now,
        }, {merge: true}));

    await Promise.allSettled(writes);
    return {costUsd, inputTokens, outputTokens, characters};
  } catch (err) {
    // Accounting NEVER blocks the request. Log + move on.
    console.warn("[aiCostTracking] usage rollup write failed", err);
    return null;
  }
}

// ── Monthly spend ceiling (the "auto-pause" guardrail) ────────────────
//
// Off by default. The project owner arms it by setting the
// AI_MONTHLY_BUDGET_USD env var (a positive USD amount) on the Cloud
// Functions runtime. When the month-to-date *tracked* spend reaches the
// ceiling, getBudgetStatus() reports overBudget=true and the AI
// chokepoints (callAnthropic / callAnthropicStream / callClaude) refuse
// new calls, pausing app-side AI spend until the next UTC month or until
// an admin raises the limit.
//
// IMPORTANT scope note: this ceiling only sees spend that flows through
// recordAiUsage — i.e. the deployed app's own Anthropic calls. It does
// NOT see Claude Code / managed-agent (Opus) usage on the same API key,
// which never touches this code. The org-level console spend limit is
// the control for that; this is the app-side belt to its braces.
//
// Reads are cached for 60s and fail OPEN: a Firestore read error never
// blocks a legitimate AI call.

const BUDGET_CACHE_TTL_MS = 60_000;
const BUDGET_READ_ERROR_TTL_MS = 10_000;
// Soft heads-up threshold used by the daily summary cron (not the gate).
const BUDGET_WARN_RATIO = 0.8;

let budgetCache = {expiresAt: 0, monthKey: null, monthCostUsd: 0};

/** Configured ceiling in USD, or 0 when unset/invalid (disabled). */
function getMonthlyBudgetUsd() {
  const raw = Number(process.env.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Sum month-to-date tracked spend across the monthly shard docs, folding
 * in the legacy single-doc total for pre-migration months. A month's spend
 * lives in exactly one shape (parent doc before migration, shards after),
 * so adding both never double-counts.
 */
async function readMonthToDateCostUsd(monthKey) {
  const monthDoc = admin.firestore().collection(MONTHLY_COLLECTION).doc(monthKey);
  const [legacySnap, shardsSnap] = await Promise.all([
    monthDoc.get(),
    monthDoc.collection("shards").get(),
  ]);
  const docs = [];
  if (legacySnap.exists) docs.push(legacySnap.data());
  shardsSnap.forEach((s) => docs.push(s.data()));
  const totals = sumShardDocs(docs, {carry: ["month"]});
  return Number(totals.totalCostUsd || 0);
}

/**
 * Month-to-date tracked spend in USD, read from the aiUsageMonthly
 * rollup. Cached 60s; fails open (returns 0) so the gate never blocks
 * a call because accounting hiccuped.
 */
async function getMonthToDateCostUsd() {
  const monthKey = monthKeyUtc();
  const nowMs = Date.now();
  if (budgetCache.monthKey === monthKey && nowMs < budgetCache.expiresAt) {
    return budgetCache.monthCostUsd;
  }
  try {
    const monthCostUsd = await readMonthToDateCostUsd(monthKey);
    budgetCache = {
      expiresAt: nowMs + BUDGET_CACHE_TTL_MS,
      monthKey,
      monthCostUsd,
    };
    return monthCostUsd;
  } catch (err) {
    console.warn("[aiCostTracking] month-to-date read failed", err);
    // Short-lived negative cache so a bad path doesn't hammer Firestore.
    budgetCache = {
      expiresAt: nowMs + BUDGET_READ_ERROR_TTL_MS,
      monthKey,
      monthCostUsd: 0,
    };
    return 0;
  }
}

// ── Revenue-linked ceiling (the "self-funding governor") ──────────────────
//
// When AI_BUDGET_MODE=revenue_linked, the month's AI ceiling is derived from
// subscription revenue actually earned (payments) rather than a fixed env
// number: budget = monthRevenueUsd × reinvestRatio (see functions/treasury.js
// + ORG.md → Treasury & Self-Funding). Default mode is 'static', so this path
// is dormant until the owner arms it.
//
// Revenue is read from the payments collection and cached 5 min (it changes
// slowly and the query is heavier than the cost rollup read). Fails OPEN: a
// read error returns null so the gate falls back to the static ceiling rather
// than blocking AI because revenue couldn't be read.

const REVENUE_CACHE_TTL_MS = 5 * 60_000;
let revenueCache = {expiresAt: 0, monthKey: null, revenueUsd: null};

/** Start of the current UTC month — matches monthKeyUtc()'s window. */
function monthStartUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// FX rate resolver. Reads the auto-refreshed settings/fxRate doc (written by
// the dailyFxRefresh cron) and resolves it against the env/default fallback —
// NEVER a live network call, so it can't block the AI gate. Cached 1h since
// the rate only changes daily; fails open to the env/default rate.
const FX_CACHE_TTL_MS = 60 * 60_000;
let fxCache = {expiresAt: 0, rate: null};

async function getResolvedZmwPerUsd() {
  const nowMs = Date.now();
  if (nowMs < fxCache.expiresAt && fxCache.rate != null) return fxCache.rate;
  const envFallback = getZmwPerUsd();
  let rate = envFallback;
  try {
    const snap = await admin.firestore().collection("settings").doc("fxRate").get();
    const d = snap.exists ? (snap.data() || {}) : {};
    const fetchedAtMs = Number.isFinite(Number(d.fetchedAtMs)) ?
      Number(d.fetchedAtMs) :
      (d.fetchedAt && d.fetchedAt.toMillis ? d.fetchedAt.toMillis() : NaN);
    rate = resolveZmwPerUsd({
      liveRate: d.zmwPerUsd,
      liveFetchedAtMs: fetchedAtMs,
      now: nowMs,
      envFallback,
      maxAgeMs: FX_MAX_AGE_MS,
    });
  } catch (err) {
    // Fail open to the env/default rate; never block a budget read on FX.
    rate = envFallback;
  }
  fxCache = {expiresAt: nowMs + FX_CACHE_TTL_MS, rate};
  return rate;
}

/**
 * Month-to-date confirmed subscription revenue, expressed in USD via the
 * auto-refreshed (or fallback) ZMW/USD rate. Cached 5 min; returns null (not 0)
 * on a read error so callers can distinguish "couldn't read" from "earned
 * nothing" and fail open accordingly.
 */
async function getMonthToDateRevenueUsd() {
  const monthKey = monthKeyUtc();
  const nowMs = Date.now();
  if (revenueCache.monthKey === monthKey && nowMs < revenueCache.expiresAt &&
      revenueCache.revenueUsd != null) {
    return revenueCache.revenueUsd;
  }
  try {
    const since = admin.firestore.Timestamp.fromDate(monthStartUtc());
    const snap = await admin.firestore()
        .collection("payments")
        .where("status", "in", ["confirmed", "successful"])
        .where("confirmedAt", ">=", since)
        .get();
    let zmw = 0;
    snap.forEach((doc) => {
      zmw += Number((doc.data() || {}).amountZMW || 0);
    });
    const revenueUsd = zmw / (await getResolvedZmwPerUsd());
    revenueCache = {expiresAt: nowMs + REVENUE_CACHE_TTL_MS, monthKey, revenueUsd};
    return revenueUsd;
  } catch (err) {
    console.warn("[aiCostTracking] month-to-date revenue read failed", err);
    revenueCache = {
      expiresAt: nowMs + BUDGET_READ_ERROR_TTL_MS,
      monthKey,
      revenueUsd: null,
    };
    return null;
  }
}

/**
 * Pure budget evaluation — no I/O, so it unit-tests directly.
 * Returns { enabled, overBudget, warning, ratio, budgetUsd, monthCostUsd }.
 */
function evaluateBudget({monthCostUsd, budgetUsd} = {}) {
  const cost = Number(monthCostUsd) || 0;
  const budget = Number(budgetUsd) || 0;
  if (budget <= 0) {
    return {
      enabled: false,
      overBudget: false,
      warning: false,
      ratio: 0,
      budgetUsd: 0,
      monthCostUsd: cost,
    };
  }
  const ratio = cost / budget;
  return {
    enabled: true,
    overBudget: cost >= budget,
    warning: ratio >= BUDGET_WARN_RATIO && cost < budget,
    ratio,
    budgetUsd: budget,
    monthCostUsd: cost,
  };
}

/**
 * Live budget status. Never throws. Picks the ceiling by AI_BUDGET_MODE:
 *   - 'static' (default): the fixed AI_MONTHLY_BUDGET_USD env ceiling.
 *   - 'revenue_linked':   monthRevenueUsd × reinvestRatio (self-funding).
 * Both fail OPEN — any read error degrades to "allow the call".
 */
async function getBudgetStatus() {
  if (getBudgetMode() === "revenue_linked") {
    return getRevenueLinkedBudgetStatus();
  }
  // ── static (unchanged) ──────────────────────────────────────────────────
  const budgetUsd = getMonthlyBudgetUsd();
  if (!budgetUsd) {
    return {...evaluateBudget({budgetUsd: 0, monthCostUsd: 0}), mode: "static"};
  }
  const monthCostUsd = await getMonthToDateCostUsd();
  return {
    ...evaluateBudget({monthCostUsd, budgetUsd}),
    monthKey: monthKeyUtc(),
    mode: "static",
  };
}

/**
 * The self-funding ceiling. budget = monthRevenueUsd × reinvestRatio, with a
 * floor for the pre-revenue bootstrap. Safety net so arming this can never
 * brick AI: if revenue can't be read, OR the derived ceiling is $0 (no
 * revenue and no floor), it falls back to the static AI_MONTHLY_BUDGET_USD
 * ceiling — which is itself "disabled = allow" when unset.
 */
async function getRevenueLinkedBudgetStatus() {
  const revenueUsd = await getMonthToDateRevenueUsd();

  // Revenue unreadable → degrade to the static ceiling (fail open).
  if (revenueUsd == null) {
    const staticBudget = getMonthlyBudgetUsd();
    if (!staticBudget) {
      return {
        ...evaluateBudget({budgetUsd: 0, monthCostUsd: 0}),
        mode: "revenue_linked", revenueUsd: null, degraded: true,
      };
    }
    const monthCostUsd = await getMonthToDateCostUsd();
    return {
      ...evaluateBudget({monthCostUsd, budgetUsd: staticBudget}),
      monthKey: monthKeyUtc(),
      mode: "revenue_linked", revenueUsd: null, degraded: true,
    };
  }

  const reinvestRatio = getReinvestRatio();
  const derivedBudgetUsd = deriveBudgetFromRevenueUsd({
    revenueUsd, reinvestRatio, floorUsd: getBudgetFloorUsd(),
  });

  // No revenue + no floor → a $0 ceiling would block everything. Fall back to
  // the static budget (or disabled) so a pre-revenue project isn't bricked.
  let budgetUsd = derivedBudgetUsd;
  if (budgetUsd <= 0) {
    budgetUsd = getMonthlyBudgetUsd();
    if (!budgetUsd) {
      return {
        ...evaluateBudget({budgetUsd: 0, monthCostUsd: 0}),
        mode: "revenue_linked", revenueUsd, derivedBudgetUsd: 0, reinvestRatio,
      };
    }
  }

  const monthCostUsd = await getMonthToDateCostUsd();
  return {
    ...evaluateBudget({monthCostUsd, budgetUsd}),
    monthKey: monthKeyUtc(),
    mode: "revenue_linked",
    revenueUsd,
    derivedBudgetUsd,
    reinvestRatio,
  };
}

// User-facing message every client-side budget gate throws with
// (code "resource-exhausted").
const BUDGET_PAUSED_MESSAGE =
  "The monthly AI budget has been reached. AI features are paused " +
  "until the next billing month or until an admin raises the limit.";

/**
 * Convenience for the model-client gates (anthropicClient, openaiClient,
 * geminiClient, embeddings): true only when a ceiling is armed AND
 * month-to-date tracked spend has reached it. Never throws — any
 * accounting error fails open, matching getBudgetStatus.
 */
async function isOverBudget() {
  try {
    const status = await getBudgetStatus();
    return Boolean(status && status.overBudget);
  } catch (err) {
    console.warn("[aiCostTracking] budget check failed (allowing call)", err);
    return false;
  }
}

// ── Reservation-based hard gate (begin / settle / release) ────────────────
//
// The month-to-date read above is an eventually-consistent REPORT, not a
// lock — under concurrency many callers can read the same stale total and
// all proceed past the ceiling. The reservation gate (aiBudgetReservation.js)
// makes the ceiling enforceable: reserve a conservative max cost up front,
// reconcile to the actual cost after, release on failure. It is armed by the
// SAME ceiling resolution as isOverBudget (static or revenue-linked); when no
// ceiling is armed it is a no-op and every call is allowed. Everything below
// FAILS OPEN — an accounting glitch never blocks a legitimate AI call.

// Conservative input-token allowance for the pre-call cost estimate. The
// prompt size isn't known until the call returns, so we assume a generous
// fixed budget for input on top of the full output allowance (maxTokens).
const DEFAULT_INPUT_ALLOWANCE_TOKENS = 40000;

/** Conservative MAX USD cost of a text call, used to size a reservation. */
function estimateMaxCostUsd({model, maxTokens = 4000, inputAllowanceTokens = DEFAULT_INPUT_ALLOWANCE_TOKENS} = {}) {
  const rates = pickRates(model);
  const out = (Number(maxTokens) || 0) * rates.output;
  const inp = (Number(inputAllowanceTokens) || 0) * rates.input;
  return (out + inp) / 1_000_000;
}

// A generationId that Firestore rejects as a document id ('/', '.', '..',
// or over-long) would throw inside reserveBudget and the fail-open catch
// would skip enforcement entirely — so a caller-influenced id must never
// reach the reservation path unchecked. Accept only obviously-safe ids
// (Firestore push ids, UUIDs — everything the app generates); anything else
// gets a fresh server-side id, which costs only retry idempotency for that
// one call, never enforcement.
const SAFE_GENERATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function safeGenerationId(generationId) {
  const id = typeof generationId === "string" ? generationId : "";
  return SAFE_GENERATION_ID.test(id) ? id : crypto.randomUUID();
}

// Conservative hold for an image whose flat price is unknown (imageCostUsd
// returns 0 for model/quality/size combos outside the price matrix). A
// reservation is a HOLD, not accounting — unlike the rollups' "never
// fabricate" policy, the safe direction here is to over-reserve; the settle
// step reconciles the bucket back to the (possibly $0) actual.
const DEFAULT_IMAGE_EST_USD = 0.25;

/** Shared reserve step behind beginAiCall / beginAiImageCall. */
async function reserveForCall({generationId, estCostUsd, provider}) {
  const status = await getBudgetStatus();
  if (!status || !status.enabled || !(Number(status.budgetUsd) > 0)) {
    return {allowed: true, reservation: null, generationId, mode: "disabled"};
  }
  const res = await reservation.reserveBudget(admin.firestore(), {
    month: monthKeyUtc(),
    generationId,
    estCostUsd,
    monthlyBudgetUsd: Number(status.budgetUsd),
    provider,
    now: Date.now(),
  });
  if (!res.allowed && res.reason === "budget_exhausted") {
    return {allowed: false, reservation: null, generationId, reason: res.reason};
  }
  // Fail OPEN on any other non-allow reason (e.g. estimate_exceeds_bucket).
  return {
    allowed: true,
    reservation: res.reservation || null,
    generationId,
    mode: res.mode || "open",
  };
}

/**
 * Reserve budget for an AI call before dispatching it. Returns
 *   { allowed, reservation, generationId, mode|reason }
 * `allowed:false` (reason 'budget_exhausted') means the ceiling is armed and
 * the month's budget is fully reserved — the caller should refuse the call
 * with BUDGET_PAUSED_MESSAGE. Any other outcome allows the call (fail-open);
 * a null reservation just means nothing needs reconciling afterwards.
 */
async function beginAiCall({generationId, model, maxTokens, inputAllowanceTokens, provider = null} = {}) {
  const genId = safeGenerationId(generationId);
  try {
    return await reserveForCall({
      generationId: genId,
      estCostUsd: estimateMaxCostUsd({model, maxTokens, inputAllowanceTokens}),
      provider,
    });
  } catch (err) {
    console.warn("[aiCostTracking] beginAiCall failed (allowing call)", err?.message || err);
    return {allowed: true, reservation: null, generationId: genId, mode: "error"};
  }
}

/**
 * Image-generation variant of beginAiCall: the reservation is sized off the
 * flat per-image price (imageCostUsd by model + quality + size) rather than
 * token rates — token pricing would route gpt-image-1 through the "gpt"
 * catch-all row and understate the hold. Same contract as beginAiCall.
 */
async function beginAiImageCall({generationId, model, quality, size, provider = null} = {}) {
  const genId = safeGenerationId(generationId);
  try {
    const flat = imageCostUsd(model, {quality, size});
    return await reserveForCall({
      generationId: genId,
      estCostUsd: flat > 0 ? flat : DEFAULT_IMAGE_EST_USD,
      provider,
    });
  } catch (err) {
    console.warn("[aiCostTracking] beginAiImageCall failed (allowing call)", err?.message || err);
    return {allowed: true, reservation: null, generationId: genId, mode: "error"};
  }
}

/**
 * Reconcile a reservation to the actual cost AND record the call in the
 * sharded analytics counters. Idempotent + never throws. Pass the handle
 * returned by beginAiCall (null when the gate was off).
 */
async function settleAiCall({reservation: handle, uid, tool, model, usage} = {}) {
  if (handle && handle.id) {
    const actualCostUsd = computeCostUsd(model, usage);
    await reservation.settleReservation(admin.firestore(), {
      month: handle.month || monthKeyUtc(),
      generationId: handle.id,
      actualCostUsd,
      now: Date.now(),
    }).catch((err) => console.warn("[aiCostTracking] settle failed", err?.message || err));
  }
  return recordAiUsage({uid, model, usage, tool});
}

/**
 * Image-call counterpart of settleAiCall: reconcile the reservation to the
 * flat per-image actual AND record the call in the flat-priced image rollups.
 * Idempotent + never throws.
 */
async function settleAiImageCall({reservation: handle, uid, tool, model, quality, size} = {}) {
  if (handle && handle.id) {
    await reservation.settleReservation(admin.firestore(), {
      month: handle.month || monthKeyUtc(),
      generationId: handle.id,
      actualCostUsd: imageCostUsd(model, {quality, size}),
      now: Date.now(),
    }).catch((err) => console.warn("[aiCostTracking] image settle failed", err?.message || err));
  }
  return recordAiImageUsage({uid, model, quality, size, tool});
}

/**
 * Release a reservation whose AI call failed (returns the full held amount
 * to the budget). Idempotent + never throws. No analytics write — the call
 * produced no billable usage.
 */
async function releaseAiCall({reservation: handle} = {}) {
  if (handle && handle.id) {
    await reservation.releaseReservation(admin.firestore(), {
      month: handle.month || monthKeyUtc(),
      generationId: handle.id,
      now: Date.now(),
    }).catch((err) => console.warn("[aiCostTracking] release failed", err?.message || err));
  }
}

// Test seam — let tests reset the in-memory caches between cases.
function _resetBudgetCache() {
  budgetCache = {expiresAt: 0, monthKey: null, monthCostUsd: 0};
  revenueCache = {expiresAt: 0, monthKey: null, revenueUsd: null};
  fxCache = {expiresAt: 0, rate: null};
}

module.exports = {
  recordAiUsage,
  recordAiImageUsage,
  recordAiTtsUsage,
  computeCostUsd,
  pickRates,
  imageCostUsd,
  ttsCostUsd,
  ttsVoiceTier,
  PRICE_PER_MTOK,
  IMAGE_PRICE_USD,
  TTS_PRICE_PER_MCHAR,
  isOverBudget,
  BUDGET_PAUSED_MESSAGE,
  monthKeyUtc,
  getMonthlyBudgetUsd,
  getMonthToDateCostUsd,
  getMonthToDateRevenueUsd,
  getResolvedZmwPerUsd,
  evaluateBudget,
  getBudgetStatus,
  BUDGET_WARN_RATIO,
  MONTHLY_COLLECTION,
  // Reservation-based hard gate (see aiBudgetReservation.js).
  estimateMaxCostUsd,
  safeGenerationId,
  beginAiCall,
  beginAiImageCall,
  settleAiCall,
  settleAiImageCall,
  releaseAiCall,
  DEFAULT_IMAGE_EST_USD,
  _resetBudgetCache,
};
