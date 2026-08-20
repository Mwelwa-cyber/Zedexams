/**
 * The pre-generated-pronunciation rules.
 *
 * Plain node (the *Core.js split): run with
 *   node functions/spelling/spellingAudioCore.test.js
 */

"use strict";

const assert = require("node:assert/strict");
const {
  AUDIO_PREFIX,
  MAX_BATCH,
  spellingAudioPath,
  slugForWord,
  planAudioBatch,
  batchCharacters,
  isPlayableAudioUrl,
} = require("./spellingAudioCore");

let passed = 0;
const failures = [];
function check(cond, msg) {
  if (cond) { passed += 1; return; }
  failures.push(msg);
}

/* ── the object path ────────────────────────────────────────────────── */

check(spellingAudioPath({grade: 7, word: "neighbour"}) === `${AUDIO_PREFIX}/g7/neighbour.mp3`,
  "a word's path is readable — grade folder, word, .mp3");
check(spellingAudioPath({grade: "7", word: " Neighbour "}) === `${AUDIO_PREFIX}/g7/neighbour.mp3`,
  "a string grade and stray whitespace resolve to the same object");
check(spellingAudioPath({grade: null, word: "neighbour"}) === `${AUDIO_PREFIX}/gx/neighbour.mp3`,
  "a word with no grade still gets one stable home");
check(spellingAudioPath({grade: 7, word: "don't"}) === `${AUDIO_PREFIX}/g7/don-t.mp3`,
  "an apostrophe becomes a dash rather than an awkward object name");

// The path is what a write targets, so anything that is not a word must
// produce null — otherwise a malformed record writes outside its prefix.
for (const bad of ["", "  ", "../../etc/passwd", "a/b", "word with space", "9lives", "x".repeat(60), null, undefined, 42]) {
  check(spellingAudioPath({grade: 7, word: bad}) === null,
    `"${String(bad).slice(0, 20)}" yields no path, so it can never be written`);
  check(slugForWord(bad) === null, `slugForWord refuses "${String(bad).slice(0, 20)}"`);
}
check(spellingAudioPath({grade: 7, word: "neighbour"}).startsWith(`${AUDIO_PREFIX}/`),
  "every path a caller can obtain is inside the prefix the rules open");

/* ── planning a batch ───────────────────────────────────────────────── */

const words = [
  {id: "a", word: "neighbour", grade: 7},
  {id: "b", word: "separate", grade: 7},
  {id: "c", word: "9lives", grade: 7},
  {id: "d", word: "neighbour", grade: 7},
];

{
  const plan = planAudioBatch({words});
  check(plan.todo.length === 2, "two real, distinct words are voiced");
  check(plan.todo.map((t) => t.word).join() === "neighbour,separate", "in the order given");
  check(plan.skipped.some((s) => s.reason === "not-a-word"), "a malformed word is skipped");
  check(plan.skipped.some((s) => s.reason === "duplicate-in-batch"),
    "the same word twice in one batch is voiced once — two writes to one object, bought twice");
  // The skip list is the honest half: a run reporting "2 voiced" while
  // dropping two rows in silence is how a half-voiced bank looks finished.
  check(plan.skipped.length === 2, "and every skip is reported, never dropped quietly");
}

{
  const existing = new Set([`${AUDIO_PREFIX}/g7/neighbour.mp3`]);
  const plan = planAudioBatch({words, existing});
  check(plan.todo.length === 1 && plan.todo[0].word === "separate",
    "a word already voiced is not re-bought");
  check(plan.skipped.some((s) => s.reason === "already-voiced"), "and says so");

  const forced = planAudioBatch({words, existing, force: true});
  check(forced.todo.length === 2, "force re-voices — how an admin changes the voice of a bank");
}

{
  const many = Array.from({length: MAX_BATCH + 7}, (_, i) => ({word: `wordone${String.fromCharCode(97 + (i % 26))}`, grade: 7, id: `x${i}`}));
  const plan = planAudioBatch({words: many});
  check(plan.todo.length <= MAX_BATCH, "a batch is capped");
  check(plan.overflow === 7, "and the remainder is REPORTED, so the caller knows to page");
}

check(planAudioBatch({}).todo.length === 0, "no words is not an error");
check(batchCharacters([{word: "cat"}, {word: "house"}]) === 8,
  "the character count is what will be billed, known before the spend");
check(batchCharacters([]) === 0, "an empty batch bills nothing");

/* ── the URL the client will play ───────────────────────────────────── */
//
// The `audio` field is written by the pipeline but editable by an admin, and
// it is handed to `new Audio(url)`. "It came from our own database" is not a
// reason to trust a string that reaches a media element.

check(isPlayableAudioUrl("https://storage.googleapis.com/b/spelling-audio/g7/x.mp3?v=1"),
  "an https object URL plays");
for (const bad of ["", "  ", "javascript:alert(1)", "data:audio/mpeg;base64,AAAA", "http://insecure/x.mp3", "//host/x.mp3", "x".repeat(3000), null]) {
  check(isPlayableAudioUrl(bad) === false, `"${String(bad).slice(0, 24)}" is refused before it reaches an Audio element`);
}

/* ── report ─────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\nspelling audio core: ${failures.length} FAILED\n`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`spelling audio core: ${passed} checks passed`);
