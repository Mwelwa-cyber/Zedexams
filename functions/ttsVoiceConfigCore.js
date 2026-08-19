/**
 * Pure decisions for the OFFERED-VOICES config — which voices /api/tts will
 * synthesise for learners, chosen from /admin/voice instead of a code change.
 *
 * No firebase imports (the *Core.js split: the functions node suite runs from
 * the repo root where firebase-functions does not resolve).
 *
 * ── The doc, and what it replaces ─────────────────────────────────────────
 * `settings/ttsVoices` holds `{ offered: [{id, provider, label, lang}] }`.
 * It replaces the hard-coded ALLOWED_VOICES Set in tts.js as the endpoint's
 * allow-list. That Set is a FINANCIAL control (an open endpoint at Studio
 * rates is a money printer for whoever finds it), so the rules here fail
 * toward the built-in Google defaults, never toward "allow anything":
 *   - no config doc, an unreadable doc, or an empty/invalid `offered` list
 *     all resolve to the defaults;
 *   - an entry that does not validate is DROPPED, not repaired — a voice id
 *     with a typo must fail closed at the picker, not 400 on a learner.
 */

"use strict";

const PROVIDERS = new Set(["google", "elevenlabs"]);

// ElevenLabs ids are ~20 chars of base62; Google names are dash-separated
// locale-tier-variant. One permissive shape covers both and refuses anything
// that could not be a voice id (path separators, whitespace, absurd length).
const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One validated entry, or null. Never throws, never repairs. */
function normalizeOfferedVoice(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const provider = String(raw.provider || "").toLowerCase().trim();
  if (!VOICE_ID_RE.test(id)) return null;
  if (!PROVIDERS.has(provider)) return null;
  return {
    id,
    provider,
    label: typeof raw.label === "string" ? raw.label.trim().slice(0, 80) : "",
    lang: typeof raw.lang === "string" ? raw.lang.trim().slice(0, 16) : "",
  };
}

/**
 * Validate a whole offered list (the admin callable's input). Returns
 * {ok, offered, dropped} — dropped is REPORTED so the admin UI can say
 * "2 entries were invalid" instead of silently shrinking the list.
 */
function normalizeOfferedList(rawList, {maxVoices = 30} = {}) {
  const list = Array.isArray(rawList) ? rawList : [];
  const seen = new Set();
  const offered = [];
  let dropped = 0;
  for (const raw of list) {
    const v = normalizeOfferedVoice(raw);
    if (!v || seen.has(v.id)) {
      dropped += 1;
      continue;
    }
    seen.add(v.id);
    offered.push(v);
    if (offered.length >= maxVoices) break;
  }
  return {ok: offered.length > 0 || list.length === 0, offered, dropped};
}

/**
 * The endpoint's effective voice list: the stored config when it holds at
 * least one valid entry, else the built-in Google defaults. `configDoc` is
 * the raw Firestore doc data (or null/undefined when absent/unreadable).
 */
function effectiveVoiceList(configDoc, googleDefaults) {
  const defaults = (googleDefaults || []).map((v) => ({
    id: v.id,
    provider: "google",
    label: v.label || "",
    lang: v.lang || "",
  }));
  const {offered} = normalizeOfferedList(configDoc?.offered);
  return offered.length ? offered : defaults;
}

/** The entry for a requested voice id, or null when it is not offered. */
function findOfferedVoice(list, id) {
  if (typeof id !== "string" || !id) return null;
  return (list || []).find((v) => v.id === id) || null;
}

module.exports = {
  PROVIDERS,
  normalizeOfferedVoice,
  normalizeOfferedList,
  effectiveVoiceList,
  findOfferedVoice,
};
