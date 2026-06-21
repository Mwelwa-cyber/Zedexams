/**
 * functions/fxRate.js
 *
 * Daily ZMW/USD rate refresh for the treasury read-out + the revenue-linked
 * budget governor. A scheduled cron calls refreshFxRate() once a day; it
 * fetches a free public rate and writes it to settings/fxRate. The budget path
 * (aiCostTracking.getMonthToDateRevenueUsd) reads that CACHED Firestore value —
 * it never makes a live network call itself, so an FX outage can never block AI.
 *
 * Safety:
 *   - the fetched value is range-checked (treasury.isSaneFxRate) before it is
 *     written, so a bad/garbage response can't poison the budget;
 *   - on any failure (network, parse, out-of-band) the existing rate is LEFT
 *     UNTOUCHED — only a lastError marker is recorded;
 *   - readers always fall back to the AI_TREASURY_ZMW_PER_USD env / default 26
 *     when the doc is missing, stale (> 8 days), or insane.
 */

const admin = require("firebase-admin");
const {parseFxApiResponse} = require("./treasury");

// Free, no-key USD rates (includes ZMW). Returns { result:'success', rates:{…} }.
const FX_SOURCE_URL = "https://open.er-api.com/v6/latest/USD";
const FX_SOURCE_NAME = "open.er-api.com";
const FX_DOC = {collection: "settings", id: "fxRate"};

/**
 * Fetch the live rate and persist it to settings/fxRate. db injected;
 * fetchImpl defaults to the runtime's global fetch. Never throws.
 *
 * Returns { ok, zmwPerUsd?, error? }.
 */
async function refreshFxRate({db, fetchImpl = fetch, now = Date.now()} = {}) {
  const ref = db.collection(FX_DOC.collection).doc(FX_DOC.id);

  let rate = null;
  let error = null;
  try {
    const res = await fetchImpl(FX_SOURCE_URL, {method: "GET"});
    if (!res || !res.ok) {
      error = `fetch failed: HTTP ${res ? res.status : "no-response"}`;
    } else {
      const json = await res.json();
      rate = parseFxApiResponse(json);
      if (rate == null) error = "response had no sane ZMW rate";
    }
  } catch (err) {
    error = String((err && err.message) || err || "fetch error").slice(0, 200);
  }

  // Bad fetch → record the error but DO NOT overwrite the last good rate.
  if (rate == null) {
    try {
      await ref.set({
        lastError: error || "unknown",
        lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (err) {
      // even the error write failed — nothing more we can safely do
    }
    console.warn("[fxRate] refresh skipped:", error);
    return {ok: false, error: error || "unknown"};
  }

  try {
    await ref.set({
      zmwPerUsd: rate,
      source: FX_SOURCE_NAME,
      fetchedAtMs: now,
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: null,
    }, {merge: true});
  } catch (err) {
    const msg = String((err && err.message) || err || "write error").slice(0, 200);
    console.warn("[fxRate] write failed:", msg);
    return {ok: false, error: msg};
  }

  return {ok: true, zmwPerUsd: rate};
}

module.exports = {refreshFxRate, FX_SOURCE_URL, FX_SOURCE_NAME, FX_DOC};
