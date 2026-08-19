/**
 * Firestore half of the offered-voices config: read `settings/ttsVoices`,
 * cache it, and resolve the endpoint's effective voice list. Decisions live
 * in ttsVoiceConfigCore.js (pure); this file is the I/O.
 *
 * ── Never on the critical path, never a throw ─────────────────────────────
 * /api/tts consults this on EVERY synthesis, so the read is cached in-memory
 * for 60s (same shape as aiCostTracking's budgetCache) — a burst of learner
 * taps costs one Firestore read a minute per warm instance, not one per tap.
 * A read FAILURE serves the built-in Google defaults: the allow-list is a
 * financial control, so it fails toward "the safe known voices", and a config
 * outage must not take learner audio down with it. The failure is logged —
 * an admin's choice silently not applying is worth noticing — but it costs a
 * stale minute, not an error.
 */

"use strict";

const admin = require("firebase-admin");
const {effectiveVoiceList, findOfferedVoice} = require("./ttsVoiceConfigCore");
const {GOOGLE_VOICES} = require("./ttsAdminCore");

const CONFIG_TTL_MS = 60_000;

let cache = {expiresAt: 0, doc: null};

/** Raw settings/ttsVoices data (null when absent), cached 60s. Never throws. */
async function readVoiceConfigDoc({now = Date.now()} = {}) {
  if (now < cache.expiresAt) return cache.doc;
  try {
    const snap = await admin.firestore().doc("settings/ttsVoices").get();
    cache = {expiresAt: now + CONFIG_TTL_MS, doc: snap.exists ? snap.data() : null};
  } catch (err) {
    console.warn("[ttsVoiceConfig] read failed — serving defaults", err?.message || err);
    // Cache the failure too: a Firestore outage must not turn into a
    // per-request read attempt on the audio path.
    cache = {expiresAt: now + CONFIG_TTL_MS, doc: cache.doc};
  }
  return cache.doc;
}

/** The endpoint's effective voice list right now. */
async function getEffectiveVoices() {
  const doc = await readVoiceConfigDoc();
  return effectiveVoiceList(doc, GOOGLE_VOICES);
}

/** The offered entry for a voice id, or null when it may not be synthesised. */
async function resolveRequestedVoice(id) {
  return findOfferedVoice(await getEffectiveVoices(), id);
}

/** Test seam. */
function _resetVoiceConfigCache() {
  cache = {expiresAt: 0, doc: null};
}

module.exports = {readVoiceConfigDoc, getEffectiveVoices, resolveRequestedVoice, _resetVoiceConfigCache};
