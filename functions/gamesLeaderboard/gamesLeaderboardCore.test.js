/**
 * test:games-leaderboard-core — the rollup's decisions, under plain node.
 *
 * The two that matter most here are the ones with a victim if they are
 * wrong: a name that leaks an email address onto a board other children
 * read, and a consent refusal that fails open.
 */

"use strict";

const assert = require("node:assert/strict");
const core = require("./gamesLeaderboardCore");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log("games leaderboard core");

/* ── publicLearnerName ───────────────────────────────────────────────── */

test("a full name becomes first name + last initial", () => {
  assert.equal(core.publicLearnerName("Chanda Mwale"), "Chanda M.");
  assert.equal(core.publicLearnerName("Taonga Banda"), "Taonga B.");
});

test("a single name keeps just that name", () => {
  assert.equal(core.publicLearnerName("Mahenga"), "Mahenga");
});

test("a middle name does not become the initial — the LAST word does", () => {
  assert.equal(core.publicLearnerName("Luyando Chanda Mweemba"), "Luyando M.");
});

test("an email address never reaches the board", () => {
  // The live board carried "Elisha C at zedexams.com". All three spellings
  // of that leak are refused.
  assert.equal(core.publicLearnerName("elisha.c@zedexams.com"), "Learner");
  assert.equal(core.publicLearnerName("Elisha C at zedexams.com"), "Elisha");
  assert.equal(core.publicLearnerName("zedexams.com"), "Learner");
  assert.ok(!core.publicLearnerName("Elisha C at zedexams.com").includes("zedexams"));
});

test("a name carrying an email alongside it keeps only the name", () => {
  const out = core.publicLearnerName("Bwalya Phiri bwalya@example.co.zm");
  assert.equal(out, "Bwalya P.");
  assert.ok(!out.includes("@"));
});

test("digits and separators are stripped — an email local part often survives as one", () => {
  assert.equal(core.publicLearnerName("luyando2014"), "Luyando");
  assert.equal(core.publicLearnerName("mapalo_c"), "Mapalo C.");
});

test("a name that is only an identifier falls back to Learner, never to a uid", () => {
  assert.equal(core.publicLearnerName("aX9kZ2pQ1mNvB3rTsW7yUj"), "Learner");
  assert.equal(core.publicLearnerName("kZpQmNvBrTsW"), "Learner");
  assert.equal(core.publicLearnerName(""), "Learner");
  assert.equal(core.publicLearnerName(null), "Learner");
  assert.equal(core.publicLearnerName(undefined), "Learner");
  assert.equal(core.publicLearnerName("   "), "Learner");
});

test("a very long first name is bounded", () => {
  const out = core.publicLearnerName(`${"a".repeat(80)} Banda`);
  assert.ok(out.length <= 22, `got ${out.length} chars: ${out}`);
});

test("lowercase input is title-cased", () => {
  assert.equal(core.publicLearnerName("chanda mwale"), "Chanda M.");
});

test("hyphenated and apostrophe names survive", () => {
  assert.equal(core.publicLearnerName("Anne-Marie Banda"), "Anne-Marie B.");
  // One interior case change in a short word is a NAME, not an identifier.
  assert.equal(core.publicLearnerName("McDonald Zulu"), "McDonald Z.");
  assert.equal(core.publicLearnerName("N'gandu Zulu"), "N'gandu Z.");
});

/* ── resolveBoardEligibility ─────────────────────────────────────────── */

const OK = {uid: "u1", profileGrade: 7, consented: true, profile: {grade: 7}};

test("a consented learner with a grade is eligible", () => {
  const v = core.resolveBoardEligibility(OK);
  assert.equal(v.eligible, true);
  assert.equal(v.grade, 7);
});

test("a profile grade stored as a string still resolves — the wizard writes one", () => {
  // `resolveLearnerGrade` on the client coerces the same way; if the two
  // disagreed, the board a learner opens would not be the one they were
  // written into.
  const v = core.resolveBoardEligibility({...OK, profileGrade: "7"});
  assert.equal(v.eligible, true);
  assert.equal(v.grade, 7);
  assert.equal(typeof v.grade, "number");
});

test("the score row's own grade is never consulted — that is the game's grade", () => {
  // A Grade 7 learner revising with a Grade 5 game stays on the Grade 7
  // board, and a forged `scores.grade` buys nothing.
  const v = core.resolveBoardEligibility({...OK, profileGrade: 7, grade: 5});
  assert.equal(v.grade, 7);
});

test("no consent means no board row, and consent is not assumed", () => {
  assert.equal(core.resolveBoardEligibility({...OK, consented: false}).reason, core.SKIP.NOT_CONSENTED);
  assert.equal(core.resolveBoardEligibility({...OK, consented: undefined}).reason, core.SKIP.NOT_CONSENTED);
  assert.equal(core.resolveBoardEligibility({...OK, consented: null}).reason, core.SKIP.NOT_CONSENTED);
});

test("profileVisibility 'private' is honoured — the setting says 'Hidden from leaderboards'", () => {
  const profile = {learnerSettings: {privacy: {profileVisibility: "private"}}};
  assert.equal(core.resolveBoardEligibility({...OK, profile}).reason, core.SKIP.PROFILE_PRIVATE);
});

test("'public' and 'class' visibility both appear — only 'private' hides", () => {
  for (const v of ["public", "class", undefined]) {
    const profile = {learnerSettings: {privacy: {profileVisibility: v}}};
  assert.equal(core.resolveBoardEligibility({...OK, profile: {...profile, grade: 7}}).eligible, true, `visibility ${v}`);
  }
});

test("a missing profile is refused rather than guessed at", () => {
  // profileGrade comes FROM the profile, so no profile means no grade.
  assert.equal(
      core.resolveBoardEligibility({uid: "u1", profileGrade: undefined, consented: true, profile: null}).reason,
      core.SKIP.NO_GRADE,
  );
});

test("a row with no uid or no grade is refused with the reason named", () => {
  assert.equal(core.resolveBoardEligibility({...OK, uid: ""}).reason, core.SKIP.NO_UID);
  assert.equal(core.resolveBoardEligibility({...OK, profileGrade: null}).reason, core.SKIP.NO_GRADE);
  assert.equal(core.resolveBoardEligibility({...OK, profileGrade: 0}).reason, core.SKIP.NO_GRADE);
  assert.equal(core.resolveBoardEligibility({...OK, profileGrade: -3}).reason, core.SKIP.NO_GRADE);
  assert.equal(core.resolveBoardEligibility({...OK, profileGrade: "Grade 7"}).reason, core.SKIP.NO_GRADE);
});

/* ── roundPoints ─────────────────────────────────────────────────────── */

test("an ordinary round contributes its score", () => {
  assert.deepEqual(core.roundPoints(96), {points: 96, clamped: false});
});

test("a forged score is clamped rather than crowning the forger", () => {
  const out = core.roundPoints(50000);
  assert.equal(out.points, core.MAX_ROUND_POINTS);
  assert.equal(out.clamped, true);
});

test("zero, negative and nonsense contribute nothing and subtract nothing", () => {
  assert.equal(core.roundPoints(0).points, 0);
  assert.equal(core.roundPoints(-500).points, 0);
  assert.equal(core.roundPoints("abc").points, 0);
  assert.equal(core.roundPoints(null).points, 0);
  assert.equal(core.roundPoints(Infinity).points, 0);
  assert.equal(core.roundPoints(NaN).points, 0);
});

test("a fractional score floors — the board shows whole points", () => {
  assert.equal(core.roundPoints(12.9).points, 12);
});

if (failures) {
  console.error(`games leaderboard core — ${failures} failed`);
  process.exit(1);
}
console.log("games leaderboard core — all passed");
