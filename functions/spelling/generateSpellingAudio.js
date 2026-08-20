/**
 * generateSpellingAudio — voice a batch of spelling words, once, for good.
 *
 * Admin-only. Synthesises each word through the SAME path `/api/tts` uses
 * (`ttsVoiceConfig` → `ttsSynthesis`), stores the MP3 as a public object, and
 * stamps the URL onto `spellingWords/{id}.audio`. A learner then plays a
 * static file and never touches a function, a quota or a rate limit.
 *
 * ── One synthesis path, still ────────────────────────────────────────────
 * The voice is resolved through `getEffectiveVoices()`, which is the admin's
 * own selection in /admin/voice and the same list the learner endpoint
 * allows. This callable therefore CANNOT voice the bank with something the
 * endpoint would refuse, and it cannot fork voice routing the way
 * `ttsSynthesis`'s header warns about — it is a third caller of that module,
 * not a second implementation.
 *
 * ── Why this is not on the learner's meter ───────────────────────────────
 * It is not a learner action. The spend is an editorial one, made once per
 * word by a named admin, and it is recorded against that admin's uid in the
 * aiUsage rollups so /admin/ai-costs prices it like every other AI call. What
 * it buys is the removal of a recurring charge from every learner's daily
 * allowance — see spellingAudioCore's header for the arithmetic.
 *
 * ── Failure is per word, never per batch ─────────────────────────────────
 * A provider error on one word records that word as failed and moves on. The
 * alternative — throwing — would abandon the words already paid for in the
 * same run, and an admin re-running the batch would buy them a second time.
 * The reply lists every outcome, so a half-successful run reads as one.
 */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {assertVerifiedAuth} = require("./../authGuard");
const {assertCallableRateLimit} = require("./../rateLimit");
const {getUserRole, isAdminRole} = require("./../aiService");
const {
  MAX_BATCH,
  planAudioBatch,
  batchCharacters,
} = require("./spellingAudioCore");

// The ELEVENLABS_API_KEY binding and every other onCall option live in
// functions/index.js, not here: the frozen-surface manifest reads a new
// export's options out of that file, so options declared in a module would
// arrive at the guard as an export with none.
//
// This file exports the HANDLER. Same split as setTtsOfferedVoicesHandler /
// previewTtsVoiceHandler in ttsAdmin.js.

/**
 * The public download URL for a stored object.
 *
 * Built from the bucket's public host rather than a signed URL: the object is
 * world-readable by rule (see storage.rules — the bank already ships in every
 * client bundle, so the audio leaks nothing new), and a signed URL would
 * EXPIRE, which for content stamped onto a database row means every voiced
 * word silently stops playing on a schedule nobody remembers setting.
 */
function publicUrlFor(bucketName, path) {
  return `https://storage.googleapis.com/${bucketName}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

exports.generateSpellingAudioHandler = async (request) => {
    await assertVerifiedAuth(request);
    await assertCallableRateLimit(request, {action: "generateSpellingAudio", userPerMin: 6});

    const uid = request.auth.uid;
    const role = await getUserRole(uid);
    if (!isAdminRole(role)) {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const words = Array.isArray(request.data?.words) ? request.data.words : [];
    const force = request.data?.force === true;
    const requestedVoice = typeof request.data?.voice === "string" ? request.data.voice.trim() : "";
    if (!words.length) {
      throw new HttpsError("invalid-argument", "No words given.");
    }

    // The voice, resolved exactly as the learner endpoint resolves it.
    const {getEffectiveVoices} = require("./../ttsVoiceConfig");
    const offered = await getEffectiveVoices();
    const entry = requestedVoice
      ? offered.find((v) => v.id === requestedVoice) || null
      : offered[0] || null;
    if (!entry) {
      throw new HttpsError("failed-precondition", "No voice is offered. Choose one in /admin/voice first.");
    }

    const bucket = admin.storage().bucket();

    // What already exists, so a re-run does not re-buy it. Checked per path
    // rather than by listing the prefix: a bank of 879 objects is a long list
    // to page through for a batch of 25.
    const candidates = planAudioBatch({words, existing: new Set(), force: true});
    const existing = new Set();
    if (!force) {
      const checks = await Promise.all(
        candidates.todo.map(async (item) => {
          try {
            const [exists] = await bucket.file(item.path).exists();
            return exists ? item.path : null;
          } catch {
            // An unreadable bucket must not be read as "nothing is voiced",
            // which would re-buy the whole batch. Treating it as PRESENT
            // skips the word; the admin sees it skipped and can force.
            return item.path;
          }
        }),
      );
      for (const path of checks) if (path) existing.add(path);
    }

    const {todo, skipped, overflow} = planAudioBatch({words, existing, force});

    const {synthesizeVoice} = require("./../ttsSynthesis");
    const {recordAiTtsUsage} = require("./../aiCostTracking");

    const voiced = [];
    const failed = [];
    const db = admin.firestore();

    for (const item of todo) {
      let result;
      try {
        result = await synthesizeVoice({text: item.word, entry, rate: 1, pitch: 0});
      } catch (err) {
        // synthesizeVoice contracts not to throw; belt and braces so one bad
        // word cannot abandon the rest of a paid-for batch.
        console.error("[generateSpellingAudio] synth threw", err?.message || err);
        result = {ok: false, error: "Synthesis failed."};
      }
      if (!result?.ok || !result.audio?.length) {
        failed.push({word: item.word, error: result?.error || "Synthesis failed."});
        continue;
      }

      try {
        await bucket.file(item.path).save(result.audio, {
          contentType: "audio/mpeg",
          metadata: {
            // Long and immutable: re-voicing overwrites the object, and a
            // stale copy in a CDN is the one way a learner hears a voice the
            // admin has replaced. `version` in the URL is what busts it.
            cacheControl: "public, max-age=31536000, immutable",
            metadata: {
              voice: String(entry.id),
              provider: String(entry.provider),
              characters: String(item.word.length),
              voicedBy: uid,
            },
          },
        });
      } catch (err) {
        console.error("[generateSpellingAudio] upload", err?.message || err);
        failed.push({word: item.word, error: "Could not store the audio."});
        continue;
      }

      // `?v=` is a cache-buster tied to the moment of voicing. The object is
      // served immutable, so without it a re-voiced word would keep playing
      // the old recording out of the CDN for a year.
      const url = `${publicUrlFor(bucket.name, item.path)}?v=${Date.now()}`;

      if (item.id) {
        try {
          await db.doc(`spellingWords/${item.id}`).set({
            audio: url,
            audioVoice: entry.id,
            audioProvider: entry.provider,
            audioAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        } catch (err) {
          // The object IS stored — the spend happened and is not lost. Report
          // the record as unstamped rather than as unvoiced, so a retry
          // skips the synthesis and only redoes the write.
          console.error("[generateSpellingAudio] stamp", err?.message || err);
          failed.push({word: item.word, error: "Voiced, but the record could not be updated."});
          continue;
        }
      }

      voiced.push({id: item.id, word: item.word, url});
    }

    // Recorded against the ADMIN who spent it, in one rollup for the batch —
    // the dashboard prices editorial spend beside every other AI call.
    const characters = batchCharacters(todo.filter((t) => !failed.some((f) => f.word === t.word)));
    if (characters > 0) {
      await recordAiTtsUsage({
        uid,
        voice: entry.id,
        characters,
        tool: "tts-spelling-bank",
        cached: false,
        provider: entry.provider,
      });
    }

    return {
      voice: {id: entry.id, provider: entry.provider, label: entry.label || ""},
      voiced,
      skipped,
      failed,
      overflow,
      characters,
      maxBatch: MAX_BATCH,
    };
};
