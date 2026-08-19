/**
 * Pure, dependency-free helpers for the text-to-speech audio cache.
 *
 * Split from ttsCache.js (which does the Storage I/O) so the key derivation —
 * the part that decides whether two requests are "the same audio" — tests
 * under plain `node` with no firebase-admin, and so a change to it is
 * reviewable on its own. Getting this wrong is silent in both directions: too
 * loose and a learner hears the wrong voice reading the right words, too tight
 * and the cache never hits and we pay for every repeat.
 *
 * ── Why cache at all ──────────────────────────────────────────────────────
 * Synthesis is billed per character, and the two learner surfaces that matter
 * repeat heavily across users: a pronunciation is a short phrase thousands of
 * learners ask for, and a study note is one long body read by everyone in the
 * grade. Uncached, the same audio is bought once per learner per playback.
 * The cache is content-addressed and SHARED — that sharing is the entire
 * saving, and it is what makes a premium per-character provider viable.
 *
 * ── Why a hash and not the text ───────────────────────────────────────────
 * The key is a sha256 of the normalised request, so an object name never
 * contains a learner's text (object names show up in logs, listings and
 * console UIs) and is always a safe, fixed-length path segment regardless of
 * what was typed. Retrieval requires reproducing the exact text, so the cache
 * discloses nothing to someone who does not already have the content.
 */

"use strict";

const crypto = require("node:crypto");

// Bumped when a change makes previously-stored audio wrong for a given
// request — a new normalisation rule, a provider swap, a default that moves.
// Old objects then simply stop being addressed rather than being served as
// stale audio; they age out by lifecycle rather than needing a migration.
const TTS_CACHE_VERSION = "v1";

const CACHE_PREFIX = "tts-cache";

/**
 * Normalise the spoken text for keying.
 *
 * Collapses whitespace and trims, so the same sentence arriving with a
 * trailing newline or a double space shares one cache entry. Deliberately
 * does NOT lowercase or strip punctuation: a synthesiser reads "polish" and
 * "Polish" differently, and punctuation changes prosody, so folding those
 * would serve audio that does not match the request.
 */
function normalizeTtsText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The cache key for one synthesis request.
 *
 * EVERY input that changes the produced audio is in the key. voice, rate and
 * pitch are all rendered into the audio, so two requests differing only in
 * rate are different objects — keying on text alone would hand a learner who
 * chose slow playback the fast recording, which is exactly the kind of bug
 * that looks like "the speed setting does nothing".
 *
 * Numbers are normalised to a fixed decimal string first: the endpoint clamps
 * rate/pitch to numbers, and 1 vs 1.0 vs "1.00" must not produce three copies
 * of one recording.
 *
 * @returns {string} 64-char lowercase hex sha256.
 */
function ttsCacheKey({text, voice, rate, pitch, provider} = {}) {
  const parts = [
    TTS_CACHE_VERSION,
    String(provider || "google"),
    String(voice || ""),
    numberToken(rate, 1),
    numberToken(pitch, 0),
    normalizeTtsText(text),
  ];
  // Length-prefix each field so no combination of values can be rearranged
  // into the same joined string (a voice ending in a digit followed by a rate
  // is otherwise ambiguous against a longer voice name).
  const payload = parts.map((p) => `${p.length}:${p}`).join("|");
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Fixed-precision token for a numeric field, falling back to `fallback`. */
function numberToken(value, fallback) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : fallback).toFixed(3);
}

/**
 * Storage object path for a cache key.
 *
 * Fanned out over the first two hex characters (256 folders) so the bucket
 * never accumulates one flat directory with every recording in it — listing,
 * lifecycle rules and the console UI all degrade badly on that, and it is far
 * cheaper to shard from the start than to reorganise later.
 *
 * Lives under a prefix with NO match block in storage.rules, so the catch-all
 * `allow read, write: if false` covers it: the cache is server-only, reachable
 * through the endpoint and not directly by any client.
 */
function ttsCachePath(key) {
  const hex = String(key || "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return `${CACHE_PREFIX}/${hex.slice(0, 2)}/${hex}.mp3`;
}

module.exports = {
  TTS_CACHE_VERSION,
  CACHE_PREFIX,
  normalizeTtsText,
  ttsCacheKey,
  ttsCachePath,
};
