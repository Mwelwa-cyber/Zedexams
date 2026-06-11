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
};

function pickRates(model) {
  const id = String(model || "").toLowerCase();
  // Longest-prefix match. Family entries are short (~12 chars), full
  // model ids are ~25 chars, so this is fine without a real trie.
  let best = null;
  for (const key of Object.keys(PRICE_PER_MTOK)) {
    if (key === "default") continue;
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return PRICE_PER_MTOK[best] || PRICE_PER_MTOK.default;
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
  try {
    const db = admin.firestore();
    const date = dateKeyUtc();
    const inputTokens = usage?.input_tokens || 0;
    const outputTokens = usage?.output_tokens || 0;
    const cacheCreation = usage?.cache_creation_input_tokens || 0;
    const cacheRead = usage?.cache_read_input_tokens || 0;
    const costUsd = computeCostUsd(model, usage);

    const dayRef = db.collection("aiUsage").doc(date);
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Ensure the parent doc exists with the date stamped (so list
    // queries on aiUsage can sort by date without an index).
    const dayUpdate = dayRef.set({
      date,
      totalInputTokens: inc(inputTokens),
      totalOutputTokens: inc(outputTokens),
      totalCacheCreationTokens: inc(cacheCreation),
      totalCacheReadTokens: inc(cacheRead),
      totalCostUsd: inc(costUsd),
      callCount: inc(1),
      updatedAt: now,
    }, {merge: true});

    const subUpdates = [];
    if (uid) {
      subUpdates.push(dayRef.collection("users").doc(uid).set({
        uid,
        inputTokens: inc(inputTokens),
        outputTokens: inc(outputTokens),
        cacheCreation: inc(cacheCreation),
        cacheRead: inc(cacheRead),
        costUsd: inc(costUsd),
        callCount: inc(1),
        updatedAt: now,
      }, {merge: true}));
    }
    if (tool) {
      const safeTool = String(tool).slice(0, 64);
      subUpdates.push(dayRef.collection("tools").doc(safeTool).set({
        tool: safeTool,
        inputTokens: inc(inputTokens),
        outputTokens: inc(outputTokens),
        costUsd: inc(costUsd),
        callCount: inc(1),
        updatedAt: now,
      }, {merge: true}));
    }

    // Month-to-date rollup that the spend ceiling reads. One extra
    // increment write, same fire-and-forget contract as the rest.
    const monthRef = db.collection(MONTHLY_COLLECTION).doc(monthKeyUtc());
    subUpdates.push(monthRef.set({
      month: monthKeyUtc(),
      totalInputTokens: inc(inputTokens),
      totalOutputTokens: inc(outputTokens),
      totalCacheCreationTokens: inc(cacheCreation),
      totalCacheReadTokens: inc(cacheRead),
      totalCostUsd: inc(costUsd),
      callCount: inc(1),
      updatedAt: now,
    }, {merge: true}));

    await Promise.allSettled([dayUpdate, ...subUpdates]);
    return {costUsd, inputTokens, outputTokens};
  } catch (err) {
    // Accounting NEVER blocks the request. Log + move on.
    console.warn("[aiCostTracking] recordAiUsage failed", err);
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
    const snap = await admin.firestore()
        .collection(MONTHLY_COLLECTION).doc(monthKey).get();
    const monthCostUsd = Number(
        snap.exists ? (snap.data().totalCostUsd || 0) : 0,
    );
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

/** Live budget status (reads the rollup). Never throws. */
async function getBudgetStatus() {
  const budgetUsd = getMonthlyBudgetUsd();
  if (!budgetUsd) return evaluateBudget({budgetUsd: 0, monthCostUsd: 0});
  const monthCostUsd = await getMonthToDateCostUsd();
  return {...evaluateBudget({monthCostUsd, budgetUsd}), monthKey: monthKeyUtc()};
}

// Test seam — let tests reset the in-memory cache between cases.
function _resetBudgetCache() {
  budgetCache = {expiresAt: 0, monthKey: null, monthCostUsd: 0};
}

module.exports = {
  recordAiUsage,
  computeCostUsd,
  pickRates,
  PRICE_PER_MTOK,
  monthKeyUtc,
  getMonthlyBudgetUsd,
  getMonthToDateCostUsd,
  evaluateBudget,
  getBudgetStatus,
  BUDGET_WARN_RATIO,
  MONTHLY_COLLECTION,
  _resetBudgetCache,
};
