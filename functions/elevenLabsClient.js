/**
 * Thin REST client for the ElevenLabs API.
 *
 * REST rather than the official SDK, for the same reason geminiClient.js is:
 * functions/index.js loads every module, so an SDK's transitive weight is paid
 * by all ~190 exports on every cold start, for the handful that call it.
 *
 * Three operations, matching the three scopes the production key is granted —
 * Text to Speech (Access), Voices (Read), User (Access). Nothing here writes
 * to the ElevenLabs account, and nothing here should: the key is deliberately
 * scoped so it cannot create voices, touch the workspace, or manage members.
 *
 * ── The unconfigured case is normal, not an error ─────────────────────────
 * ELEVENLABS_API_KEY may legitimately be absent — on a developer machine and
 * in CI, neither of which binds the secret, and in any runtime the binding has
 * not reached yet. Every function here reports that as a STATE
 * (`configured: false`) rather than throwing, so the admin
 * surface can say "not connected yet" instead of rendering an error, and so
 * the synthesis path can fall back to Google rather than failing a learner's
 * audio over a missing key.
 */

"use strict";

const EL_BASE = "https://api.elevenlabs.io/v1";

// The endpoint's own read timeouts. A learner waiting on audio must not wait
// on a hung provider — Google is the fallback and is only useful if we give up
// in time to use it.
const LIST_TIMEOUT_MS = 10_000;
const SYNTH_TIMEOUT_MS = 25_000;

function apiKey() {
  const raw = process.env.ELEVENLABS_API_KEY;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Whether a usable key is bound to this runtime. */
function isConfigured() {
  return apiKey() !== null;
}

async function elFetch(path, {method = "GET", body, timeoutMs = LIST_TIMEOUT_MS, accept} = {}) {
  const key = apiKey();
  if (!key) return {configured: false, ok: false, status: 0, error: "ELEVENLABS_API_KEY is not set."};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${EL_BASE}${path}`, {
      method,
      headers: {
        "xi-api-key": key,
        ...(body ? {"Content-Type": "application/json"} : {}),
        ...(accept ? {Accept: accept} : {}),
      },
      ...(body ? {body: JSON.stringify(body)} : {}),
      signal: controller.signal,
    });
    return {configured: true, ok: res.ok, status: res.status, res};
  } catch (err) {
    // An abort is a timeout, which is operationally different from a refusal
    // and worth distinguishing in the admin panel.
    const aborted = err && err.name === "AbortError";
    return {
      configured: true,
      ok: false,
      status: aborted ? 408 : 0,
      error: aborted ? `Timed out after ${timeoutMs}ms` : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The voices this account can use.
 *
 * Returns only the fields the admin picker needs. ElevenLabs returns a large
 * object per voice (settings, sharing, fine-tuning state); passing it straight
 * through would put unreviewed provider payload into our UI and our logs, so
 * the shape is narrowed here, once.
 *
 * @returns {Promise<{configured:boolean, ok:boolean, voices:Array, error?:string}>}
 */
async function listVoices() {
  const r = await elFetch("/voices");
  if (!r.configured) return {configured: false, ok: false, voices: [], error: r.error};
  if (!r.ok) return {configured: true, ok: false, voices: [], error: r.error || `HTTP ${r.status}`};
  try {
    const data = await r.res.json();
    const voices = Array.isArray(data?.voices) ? data.voices : [];
    return {
      configured: true,
      ok: true,
      voices: voices.map((v) => ({
        voiceId: String(v?.voice_id || ""),
        name: String(v?.name || ""),
        category: String(v?.category || ""),
        previewUrl: String(v?.preview_url || ""),
        labels: v?.labels && typeof v.labels === "object" ? v.labels : {},
      })).filter((v) => v.voiceId),
    };
  } catch (err) {
    return {configured: true, ok: false, voices: [], error: `Unreadable reply: ${err?.message || err}`};
  }
}

/**
 * The account's subscription and credit position.
 *
 * This is the number that matters for the credit question: ElevenLabs' OWN
 * count of characters used against the plan's allowance, which is authoritative
 * in a way our rollups can never be — ours only see what this deploy spent,
 * not what was spent from the dashboard, another key, or a test script.
 */
async function getSubscription() {
  const r = await elFetch("/user/subscription");
  if (!r.configured) return {configured: false, ok: false, error: r.error};
  if (!r.ok) return {configured: true, ok: false, error: r.error || `HTTP ${r.status}`};
  try {
    const d = await r.res.json();
    const used = Number(d?.character_count);
    const limit = Number(d?.character_limit);
    const resetUnix = Number(d?.next_character_count_reset_unix);
    return {
      configured: true,
      ok: true,
      tier: String(d?.tier || ""),
      charactersUsed: Number.isFinite(used) ? used : null,
      characterLimit: Number.isFinite(limit) ? limit : null,
      // Remaining is DERIVED and clamped at zero: a plan can go over its
      // allowance, and a negative "remaining" reads as a bug rather than as
      // the overage it is.
      charactersRemaining: Number.isFinite(used) && Number.isFinite(limit) ?
        Math.max(0, limit - used) : null,
      resetsAt: Number.isFinite(resetUnix) && resetUnix > 0 ? resetUnix * 1000 : null,
    };
  } catch (err) {
    return {configured: true, ok: false, error: `Unreadable reply: ${err?.message || err}`};
  }
}

/**
 * Synthesise speech. Returns the MP3 bytes, or a failure the caller can fall
 * back from — never throws, because the caller's fallback (Google) is a better
 * outcome for a learner than an error.
 */
async function synthesize({text, voiceId, modelId = "eleven_multilingual_v2", stability, similarityBoost} = {}) {
  if (!text || !voiceId) {
    return {configured: isConfigured(), ok: false, error: "text and voiceId are required."};
  }
  const voiceSettings = {};
  if (Number.isFinite(Number(stability))) voiceSettings.stability = Number(stability);
  if (Number.isFinite(Number(similarityBoost))) voiceSettings.similarity_boost = Number(similarityBoost);

  const r = await elFetch(`/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    accept: "audio/mpeg",
    timeoutMs: SYNTH_TIMEOUT_MS,
    body: {
      text: String(text),
      model_id: String(modelId),
      ...(Object.keys(voiceSettings).length ? {voice_settings: voiceSettings} : {}),
    },
  });
  if (!r.configured) return {configured: false, ok: false, error: r.error};
  if (!r.ok) return {configured: true, ok: false, error: r.error || `HTTP ${r.status}`};
  try {
    const buf = Buffer.from(await r.res.arrayBuffer());
    if (!buf.length) return {configured: true, ok: false, error: "Empty audio reply."};
    return {configured: true, ok: true, audio: buf};
  } catch (err) {
    return {configured: true, ok: false, error: `Unreadable audio: ${err?.message || err}`};
  }
}

module.exports = {isConfigured, listVoices, getSubscription, synthesize, EL_BASE};
