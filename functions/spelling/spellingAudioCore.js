/**
 * Pure decisions for PRE-GENERATED spelling pronunciation.
 *
 * ── Why a word is voiced once and stored, rather than synthesised on demand ─
 * `/api/tts` is the right path for a study note read once. It is the wrong one
 * for spelling, and the numbers say so rather than taste: the endpoint allows
 * 10 requests a minute and `assertDailyLimit` gives a learner 60 AI calls a
 * DAY across every surface. One stage is eight words, each spoken on arrival,
 * plus every "Hear it again" tap and the coach's chunks — roughly fifteen to
 * twenty calls. Three stages would spend a learner's entire daily allowance on
 * spelling and then drop them to the browser voice mid-round, which is both
 * worse than what they had and impossible to explain to a child.
 *
 * So a word is synthesised ONCE, by an admin, and stored as a static object.
 * A learner then plays a file: no quota, no rate limit, no per-play cost, no
 * signed-in requirement (the games surface is public), and the service worker
 * can hold it for the next round. The whole 879-word Grade 7 bank is about
 * 7,000 characters — a one-off spend measured in cents against a recurring
 * charge on every learner's daily budget.
 *
 * ── The object is public, and that leaks nothing new ──────────────────────
 * `spelling-audio/**` is world-readable, because the learner playing it may be
 * signed out. That does not expose an answer key: `src/data/spellingBank.js`
 * already ships all 879 words in the client bundle of anybody who opens the
 * games hub. The audio is a second copy of something already public, so the
 * rule can be read-only-to-everyone and server-only to write.
 *
 * ── Only the WORD is voiced ───────────────────────────────────────────────
 * Not the context sentence. The mechanic is "hear it, then produce it": the
 * sentence is on screen with its gap, and voicing it would mean reading a
 * sentence whose missing word is the answer — a gap a synthesiser has no
 * sensible way to speak. Nor the coach's chunks: those are nonsense fragments
 * ("sep", "a", "rate"), they appear only after a miss on one of 79 authored
 * words, and they stay on the live ladder.
 *
 * No firebase imports (the *Core.js split: the functions node suite runs from
 * the repo root, where firebase-functions does not resolve).
 */

"use strict";

/** Where a word's pronunciation lives. Public read, server-only write. */
const AUDIO_PREFIX = "spelling-audio";

/**
 * How many words one call may voice.
 *
 * A callable has a wall-clock budget and each word is a round trip to a
 * provider, so the whole bank cannot be one request. The admin tool pages
 * through, which also means a failure costs one page rather than the run.
 */
const MAX_BATCH = 25;

/** A word longer than this is not a word; refuse rather than pay for it. */
const MAX_WORD_CHARS = 40;

/**
 * The object path for one word.
 *
 * Keyed by GRADE and the word itself, not by a hash: unlike the TTS cache —
 * which hashes because it holds whatever a learner typed — this content is a
 * published curriculum word, and a readable path is what lets an operator see
 * what a lifecycle rule would delete, or spot that Grade 6 was never voiced.
 *
 * The VOICE is deliberately NOT in the path. One current pronunciation per
 * word is the model; re-voicing with a new voice overwrites, so a bank cannot
 * drift into a mix of two speakers with no way to tell which a learner gets.
 * `force` is how an admin re-voices after changing the offered voice.
 */
function spellingAudioPath({grade, word}) {
  const slug = slugForWord(word);
  if (!slug) return null;
  const g = Number.isFinite(Number(grade)) && Number(grade) > 0 ? String(Number(grade)) : "x";
  return `${AUDIO_PREFIX}/g${g}/${slug}.mp3`;
}

/**
 * The filename-safe form of a word.
 *
 * Returns null for anything that is not a word — an empty string, a path
 * separator, something absurdly long. A null path is refused by every caller,
 * so a malformed record cannot write outside its prefix.
 */
function slugForWord(word) {
  const raw = String(word || "").trim().toLowerCase();
  if (!raw || raw.length > MAX_WORD_CHARS) return null;
  if (!/^[a-z][a-z'-]*$/.test(raw)) return null;
  // The apostrophe in "don't" is legal in a word and illegal in a tidy object
  // name; it becomes a dash, and "dont" vs "don-t" cannot collide because the
  // source words differ by more than that character.
  const slug = raw.replace(/'/g, "-");
  return slug || null;
}

/**
 * What one batch should actually do.
 *
 * Splits the requested words into those to synthesise and those to skip, and
 * says WHY each was skipped. A run that reports "18 voiced" while silently
 * dropping seven malformed rows is how a half-voiced bank looks finished.
 *
 * `existing` is the set of paths already in the bucket. Without `force`, a
 * word that already has audio is skipped — re-voicing is a spend, and a
 * re-run of the same batch must not repeat it.
 */
function planAudioBatch({words = [], existing = new Set(), force = false} = {}) {
  const todo = [];
  const skipped = [];
  const seen = new Set();

  for (const entry of words.slice(0, MAX_BATCH)) {
    const word = String(entry?.word || "").trim().toLowerCase();
    const path = spellingAudioPath({grade: entry?.grade, word});
    if (!path) {
      skipped.push({word: word || "(blank)", reason: "not-a-word"});
      continue;
    }
    if (seen.has(path)) {
      // Two records for one word at one grade. Voicing it twice would buy the
      // same audio twice and race on the same object.
      skipped.push({word, reason: "duplicate-in-batch"});
      continue;
    }
    seen.add(path);
    if (!force && existing.has(path)) {
      skipped.push({word, reason: "already-voiced"});
      continue;
    }
    todo.push({id: entry?.id || null, word, grade: entry?.grade ?? null, path});
  }

  const overflow = Math.max(0, (words?.length || 0) - MAX_BATCH);
  return {todo, skipped, overflow};
}

/**
 * The characters one batch will be billed for. Reported before the spend so an
 * admin sees the size of what they are about to buy, not after.
 */
function batchCharacters(todo = []) {
  return todo.reduce((sum, item) => sum + String(item.word || "").length, 0);
}

/**
 * Is this URL one of ours?
 *
 * The `audio` field on a spelling word is written by this pipeline and read by
 * the learner's player, which hands it to `new Audio(url)`. A record whose
 * `audio` came from somewhere else is a URL an admin typed, and it is checked
 * at the point of USE rather than trusted because it is in our own database:
 * https only, no javascript: or data: scheme reaching an Audio element.
 */
function isPlayableAudioUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  if (raw.length > 2048) return false;
  return /^https:\/\//i.test(raw);
}

module.exports = {
  AUDIO_PREFIX,
  MAX_BATCH,
  MAX_WORD_CHARS,
  spellingAudioPath,
  slugForWord,
  planAudioBatch,
  batchCharacters,
  isPlayableAudioUrl,
};
