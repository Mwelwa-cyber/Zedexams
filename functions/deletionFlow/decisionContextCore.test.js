"use strict";

/**
 * What the guardian's decision screen shows — and, mostly, what it refuses to.
 *
 * Every number on that screen is an argument for saying no, so the tests that
 * matter here are the suppressions:
 *
 *   • the "worth a conversation" note NEVER appears for a child who is not
 *     actually active, because "she has been using it almost every day" about
 *     a child who last opened it in March is a lie in the service of retention;
 *   • an unknown number is OMITTED rather than shown as zero, because "0 day
 *     streak" and "we do not know" look identical and mean opposite things;
 *   • the plan panel is absent for a family that is not paying, because a
 *     billing reassurance about a charge that does not exist raises a question
 *     instead of answering one.
 *
 * Run: npm run test:deletion-decision-context
 */

const assert = require("node:assert/strict");

const {
  ACTIVE_DAYS_THRESHOLD,
  MS_PER_DAY,
  buildStatTiles,
  buildConversationNote,
  buildPlanPanel,
  buildDecisionContext,
} = require("./decisionContextCore");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const NOW = Date.parse("2026-08-19T12:00:00Z");
const days = (n) => n * MS_PER_DAY;

/** An active child with exams close: the case the note is written for. */
const activeInput = (over = {}) => ({
  childName: "Lydia",
  tiles: {streakDays: 12, daysToExam: 12},
  activeDaysLast7: 5,
  lastActiveAt: NOW - days(1),
  now: NOW,
  ...over,
});

/* ── The stat tiles ──────────────────────────────────────────────────── */

test("real numbers come through", () => {
  const t = buildStatTiles({
    stats: {currentStreak: 12},
    summary: {examReadiness: 68},
    nextExamAt: NOW + days(12),
    now: NOW,
  });
  assert.equal(t.streakDays, 12);
  assert.equal(t.examReadiness, 68);
  assert.equal(t.daysToExam, 12);
});

test("an unknown number is null, never zero", () => {
  const t = buildStatTiles({stats: {}, summary: {}, nextExamAt: null, now: NOW});
  assert.equal(t.streakDays, null, "'0 day streak' reads as a fact; null reads as absent");
  assert.equal(t.examReadiness, null);
  assert.equal(t.daysToExam, null);
});

test("a zero streak is reported as absent rather than as zero", () => {
  const t = buildStatTiles({stats: {currentStreak: 0}, summary: {}, now: NOW});
  assert.equal(t.streakDays, null);
});

test("an exam already past is not a countdown", () => {
  const t = buildStatTiles({stats: {}, summary: {}, nextExamAt: NOW - days(3), now: NOW});
  assert.equal(t.daysToExam, null);
});

test("readiness is clamped and rounded", () => {
  assert.equal(buildStatTiles({summary: {examReadiness: 68.6}, now: NOW}).examReadiness, 69);
  assert.equal(buildStatTiles({summary: {examReadiness: 240}, now: NOW}).examReadiness, 100);
});

test("garbage in the stats does not become a number on screen", () => {
  const t = buildStatTiles({
    stats: {currentStreak: "loads"},
    summary: {examReadiness: null},
    nextExamAt: "soon",
    now: NOW,
  });
  assert.equal(t.streakDays, null);
  assert.equal(t.examReadiness, null);
  assert.equal(t.daysToExam, null);
});

/* ── The conversation note, and every reason it is withheld ──────────── */

test("an active child with exams close gets the note", () => {
  const note = buildConversationNote(activeInput());
  assert.ok(note);
  assert.match(note.text, /Lydia/);
  assert.match(note.text, /12 days/);
  assert.match(note.text, /don't have to answer tonight/);
});

test("A CHILD WHO IS NOT ACTIVE GETS NO NOTE — the claim would be false", () => {
  const note = buildConversationNote(activeInput({
    lastActiveAt: NOW - days(60),
    activeDaysLast7: 0,
    tiles: {streakDays: null, daysToExam: 12},
  }));
  assert.equal(note, null,
    "'she has been using it almost every day' must not be said about a child who has not");
});

test("a child seen recently but barely practising gets no note", () => {
  const note = buildConversationNote(activeInput({
    activeDaysLast7: 1,
    tiles: {streakDays: 1, daysToExam: 12},
  }));
  assert.equal(note, null);
});

test("an unknown activity level is not an active one", () => {
  for (const over of [
    {activeDaysLast7: undefined, tiles: {streakDays: null, daysToExam: 12}},
    {lastActiveAt: undefined},
    {lastActiveAt: null, activeDaysLast7: null, tiles: {streakDays: null, daysToExam: 5}},
  ]) {
    assert.equal(buildConversationNote(activeInput(over)), null, JSON.stringify(over));
  }
});

test("no exam anywhere near means no note, however active the child is", () => {
  assert.equal(
    buildConversationNote(activeInput({tiles: {streakDays: 30, daysToExam: null}})),
    null,
    "without the exam half it is a generic retention message dressed as advice",
  );
  assert.equal(
    buildConversationNote(activeInput({tiles: {streakDays: 30, daysToExam: 90}})),
    null,
    "exams three months out are not a reason to hesitate tonight",
  );
});

test("a streak alone is enough activity, and so is recent practice alone", () => {
  const byStreak = buildConversationNote(activeInput({
    activeDaysLast7: 0,
    tiles: {streakDays: ACTIVE_DAYS_THRESHOLD, daysToExam: 10},
  }));
  assert.ok(byStreak, "a live streak is evidence of practice");

  const byPractice = buildConversationNote(activeInput({
    activeDaysLast7: ACTIVE_DAYS_THRESHOLD,
    tiles: {streakDays: null, daysToExam: 10},
  }));
  assert.ok(byPractice);
});

test("the note says why it fired, so a support agent can check it", () => {
  const note = buildConversationNote(activeInput());
  assert.ok(note.reasons.includes("exam_soon"));
  assert.ok(note.reasons.includes("streak"));
});

test("one day to the exam reads as a day, not days", () => {
  const note = buildConversationNote(activeInput({tiles: {streakDays: 12, daysToExam: 1}}));
  assert.match(note.text, /1 day\./);
});

test("a child with no name still gets a readable sentence", () => {
  const note = buildConversationNote(activeInput({childName: ""}));
  assert.match(note.text, /^Your child has been/);
});

/* ── The plan panel ──────────────────────────────────────────────────── */

test("a paying guardian with two children is told the other one keeps everything", () => {
  const plan = buildPlanPanel({
    subscription: {active: true, priceLabel: "K50 a month"},
    linkedChildCount: 2,
    childName: "Lydia",
  });
  assert.ok(plan);
  assert.match(plan.text, /K50 a month/);
  assert.match(plan.text, /2 children/);
  assert.match(plan.text, /does not cancel it/);
  assert.equal(plan.othersRemain, true);
});

test("a paying guardian with one child is told how to stop paying", () => {
  const plan = buildPlanPanel({
    subscription: {active: true, priceLabel: "K50 a month"},
    linkedChildCount: 1,
    childName: "Lydia",
  });
  assert.match(plan.text, /Account → Subscription/);
  assert.equal(plan.othersRemain, false);
});

test("A FREE FAMILY IS SHOWN NOTHING — there is no charge to reassure them about", () => {
  for (const subscription of [null, undefined, {active: false, priceLabel: "K50 a month"}, {active: true}]) {
    assert.equal(
      buildPlanPanel({subscription, linkedChildCount: 2, childName: "Lydia"}),
      null,
      JSON.stringify(subscription),
    );
  }
});

test("three children reads correctly", () => {
  const plan = buildPlanPanel({
    subscription: {active: true, priceLabel: "K50 a month"},
    linkedChildCount: 3,
    childName: "Lydia",
  });
  assert.match(plan.text, /3 children/);
  assert.match(plan.text, /children keep/);
});

/* ── Assembled ───────────────────────────────────────────────────────── */

test("the whole context assembles, and suppresses independently", () => {
  const ctx = buildDecisionContext({
    childName: "Lydia",
    stats: {currentStreak: 12},
    summary: {examReadiness: 68},
    nextExamAt: NOW + days(12),
    activeDaysLast7: 5,
    lastActiveAt: NOW - days(1),
    subscription: {active: true, priceLabel: "K50 a month"},
    linkedChildCount: 2,
    now: NOW,
  });
  assert.equal(ctx.tiles.streakDays, 12);
  assert.ok(ctx.note);
  assert.ok(ctx.plan);

  // The same child, inactive and on the free plan: tiles survive, the two
  // persuasive elements do not.
  const quiet = buildDecisionContext({
    childName: "Lydia",
    stats: {currentStreak: 0},
    summary: {},
    nextExamAt: null,
    activeDaysLast7: 0,
    lastActiveAt: NOW - days(90),
    subscription: null,
    linkedChildCount: 1,
    now: NOW,
  });
  assert.equal(quiet.note, null);
  assert.equal(quiet.plan, null);
  assert.equal(quiet.tiles.streakDays, null);
});

test("the clock is never implicit", () => {
  assert.throws(() => buildStatTiles({}), /now/);
  assert.throws(() => buildConversationNote({childName: "x", tiles: {}}), /now/);
  assert.throws(() => buildDecisionContext({childName: "x"}), /now/);
});

/* ── Runner ──────────────────────────────────────────────────────────── */

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(`\ndeletion decision context: ${tests.length - failed}/${tests.length} passed`);
if (failed) {
  throw new Error(`${failed} decision-context test(s) failed`);
}
