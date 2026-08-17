// Plain-node tests for the live-challenge decision core (PROMPT 9).
// Run: node functions/duel/duelCore.test.js

"use strict";

const assert = require("node:assert");
const {
  QUEUE_TTL_MS,
  pickOpponent,
  drawQuestions,
  gradeSubmission,
  settleMatch,
} = require("./duelCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const NOW = 1_000_000_000;

test("pairs the oldest live entry in the same grade, never yourself", () => {
  const waiting = [
    { uid: "self", grade: 7, createdAtMs: NOW - 10 },
    { uid: "older", grade: 7, createdAtMs: NOW - 5000 },
    { uid: "newer", grade: 7, createdAtMs: NOW - 100 },
    { uid: "other-grade", grade: 6, createdAtMs: NOW - 9000 },
  ];
  assert.deepStrictEqual(pickOpponent(waiting, { uid: "self", grade: 7 }, NOW), { uid: "older" });
});

test("a stale queue entry is a ghost, not an opponent", () => {
  const waiting = [{ uid: "ghost", grade: 7, createdAtMs: NOW - QUEUE_TTL_MS - 1 }];
  assert.strictEqual(pickOpponent(waiting, { uid: "me", grade: 7 }, NOW), null);
});

test("no grade means no pairing — never a cross-grade race by accident", () => {
  const waiting = [{ uid: "w", grade: 7, createdAtMs: NOW }];
  assert.strictEqual(pickOpponent(waiting, { uid: "me", grade: undefined }, NOW), null);
});

test("the question draw is deterministic per match id — both players get the same set", () => {
  const bank = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, answer: 0 }));
  const a = drawQuestions(bank, "match-abc", 5);
  const b = drawQuestions(bank, "match-abc", 5);
  assert.deepStrictEqual(a.map((q) => q.id), b.map((q) => q.id));
  assert.strictEqual(a.length, 5);
  // A different match draws a different set (with overwhelming likelihood
  // on a 20-question bank; pinned here as a regression guard).
  const c = drawQuestions(bank, "match-xyz", 5);
  assert.notDeepStrictEqual(a.map((q) => q.id), c.map((q) => q.id));
});

test("a bank smaller than the draw is used whole, never padded", () => {
  const bank = [{ id: "q1", answer: 0 }, { id: "q2", answer: 1 }];
  assert.strictEqual(drawQuestions(bank, "m", 5).length, 2);
});

test("grading resolves the REAL bank shape — answer is the option STRING", () => {
  // The games bank stores answer as the answer string ('42'), matched
  // loosely — the exact shape gamesSeed.js ships. Grading against an
  // integer-index assumption marked every honest answer wrong.
  const qs = [
    { options: ["42", "36", "48"], answer: "42" },   // correct index 0
    { options: [30, 35, 40], answer: "40" },          // loose: 40 vs "40" → 2
    { options: ["a", "b"], answer: "zzz" },           // no match → ungradable
  ];
  const g = gradeSubmission(qs, [0, 2, 0]);
  assert.deepStrictEqual(g, { correct: 2, total: 3, score: 20 });
  // Nulls and gaps are wrong answers, not errors.
  assert.strictEqual(gradeSubmission(qs, [null]).correct, 0);
});

test("an integer answer is accepted as an index, bounds-checked", () => {
  const qs = [{ options: ["x", "y"], answer: 1 }, { options: ["x"], answer: 9 }];
  const g = gradeSubmission(qs, [1, 0]);
  assert.strictEqual(g.correct, 1);
});

test("settle records the first score and waits for the opponent", () => {
  const match = { state: "active", players: ["a", "b"], scores: {}, startedAtMs: NOW };
  const r = settleMatch(match, "a", 30, NOW + 1000);
  assert.ok(r.ok);
  assert.strictEqual(r.patch.scores.a, 30);
  assert.strictEqual(r.patch.state, undefined);
});

test("the second score decides the winner; equal scores draw", () => {
  const match = { state: "active", players: ["a", "b"], scores: { a: 30 }, startedAtMs: NOW };
  const win = settleMatch(match, "b", 40, NOW + 1000);
  assert.strictEqual(win.patch.winner, "b");
  assert.strictEqual(win.patch.state, "done");
  const draw = settleMatch(match, "b", 30, NOW + 1000);
  assert.strictEqual(draw.patch.winner, null);
  assert.strictEqual(draw.patch.draw, true);
});

test("a non-player, a resubmission, and an expired match are all refused", () => {
  const match = { state: "active", players: ["a", "b"], scores: { a: 10 }, startedAtMs: NOW };
  assert.strictEqual(settleMatch(match, "x", 10, NOW).reason, "not_a_player");
  assert.strictEqual(settleMatch(match, "a", 10, NOW).reason, "already_submitted");
  const late = settleMatch(match, "b", 10, NOW + 11 * 60 * 1000);
  assert.strictEqual(late.reason, "match_expired");
  assert.strictEqual(settleMatch({ ...match, state: "done" }, "b", 10, NOW).reason, "match_done");
});

console.log(`\n${passed} duel core tests passed.`);
