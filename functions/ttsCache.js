/**
 * Storage I/O for the text-to-speech audio cache. Key derivation is in
 * ttsCacheCore.js (pure); this file is the part that touches the bucket.
 *
 * ── The contract both halves keep ─────────────────────────────────────────
 * NEITHER function throws, and a read failure returns null rather than
 * propagating. A cache is an optimisation: if the bucket is slow, missing or
 * misconfigured, the correct behaviour is to synthesise and serve audio, not
 * to fail a learner's playback. Every failure path here degrades to "cache
 * miss", which costs money and works, over "error", which costs nothing and
 * doesn't.
 *
 * The write IS awaited by the caller (see tts.js), for the same reason the
 * usage rollup is: a v2 instance can be frozen once the response is flushed,
 * so work started after send() is not guaranteed to run — and a cache whose
 * writes only sometimes land is a cache that only sometimes saves money,
 * which is the failure it exists to prevent. The cost falls on the FIRST
 * listener of a given text (a bucket upload, on a request that already spent
 * seconds at the provider) and is repaid on every listener after them.
 */

"use strict";

const admin = require("firebase-admin");
const {ttsCachePath} = require("./ttsCacheCore");

// A cached recording of a 3000-character body is ~0.5 MB; anything far larger
// than the endpoint could legitimately produce is treated as not-a-hit rather
// than streamed back to a learner. Cheap guard against a corrupt or truncated
// object outliving a bad deploy.
const MAX_CACHED_BYTES = 8 * 1024 * 1024;

/**
 * Read cached audio for a key.
 *
 * @returns {Promise<Buffer|null>} the MP3 bytes, or null on miss/any failure.
 */
async function readCachedAudio(key) {
  const path = ttsCachePath(key);
  if (!path) return null;
  try {
    const file = admin.storage().bucket().file(path);
    const [buf] = await file.download();
    if (!buf || !buf.length || buf.length > MAX_CACHED_BYTES) return null;
    return buf;
  } catch (err) {
    // A miss is the overwhelmingly common case here and is NOT an error
    // worth logging on every request — google-cloud/storage raises a 404 for
    // an absent object, so only the genuinely surprising codes are logged.
    if (err && err.code !== 404) {
      console.warn("[ttsCache] read failed", err?.message || err);
    }
    return null;
  }
}

/**
 * Store synthesised audio under a key. Never throws.
 *
 * `cacheControl` is long and immutable because the object is content-addressed
 * — the key changes whenever anything about the request changes, so a stored
 * body can never become the wrong answer for its own name.
 *
 * The extra metadata is for humans operating the bucket (working out what a
 * lifecycle rule would delete, or why it is large). It deliberately records
 * the VOICE and the character count but never the text: an object's metadata
 * is as visible as its name, and the whole point of hashing the key was to
 * keep a learner's words out of both.
 */
async function writeCachedAudio(key, audio, {voice, characters, provider} = {}) {
  const path = ttsCachePath(key);
  if (!path || !audio || !audio.length) return false;
  try {
    await admin.storage().bucket().file(path).save(audio, {
      contentType: "audio/mpeg",
      metadata: {
        cacheControl: "public, max-age=31536000, immutable",
        metadata: {
          voice: String(voice || ""),
          provider: String(provider || "google"),
          characters: String(characters ?? ""),
        },
      },
    });
    return true;
  } catch (err) {
    console.warn("[ttsCache] write failed", err?.message || err);
    return false;
  }
}

module.exports = {readCachedAudio, writeCachedAudio, MAX_CACHED_BYTES};
