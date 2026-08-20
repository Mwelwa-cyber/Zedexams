/**
 * functions/gamesLeaderboard/gamesLeaderboardCore.js
 *
 * Every decision the games weekly-board rollup makes, as pure functions —
 * no Firestore, no firebase-functions, no clock of its own — so the whole
 * contract tests under plain `node` (`test:games-leaderboard-core`).
 *
 * ── What the rollup is for ───────────────────────────────────────────────
 *
 * `scores` is an append-only log: ONE DOCUMENT PER ROUND PLAYED. The board
 * that used to be at /games/leaderboard read it directly and ranked the
 * rows, so a learner who played four rounds occupied four places and the
 * "leaderboard" was a list of good rounds rather than a list of learners.
 * It also had no grade scope and no week boundary, so it could not answer
 * the two questions the Daily Challenge promises an answer to: *how am I
 * doing against my class this week*, and *when does it reset*.
 *
 * This rollup answers both by keeping ONE ENTRY PER LEARNER PER GRADE PER
 * ISO WEEK, incremented server-side. Three consequences worth stating:
 *
 *   • The learner's client never writes the board, so a client cannot put
 *     itself on it. It writes a `scores` row, which the rules already bound.
 *   • Reading the board is a small, indexed query over one week's entries
 *     rather than a scan of every score ever recorded.
 *   • Last week's board is simply last week's document path. Nothing has to
 *     be archived on a schedule for "👑 Last week: …" to work, and nothing
 *     has to be destroyed for the new week to start empty.
 */

"use strict";

/**
 * The most one round may contribute.
 *
 * `firestore.rules` bounds `scores.score` to the same number, and the two
 * must stay equal — this is the belt to that braces. Every engine in the
 * repo is a bounded-round accumulator (10 questions × ~25 points at the top
 * of the range), so 1000 is roughly 4× the largest legitimate round and is
 * nowhere near the `score: 50000` a hand-written client would post to buy
 * the top of the board.
 *
 * Clamping rather than rejecting is deliberate: a round that somehow exceeds
 * this is far more likely to be a future engine scoring differently than an
 * attack, and dropping a real learner's round silently is the worse failure.
 * The clamp is logged by the caller when it bites.
 */
const MAX_ROUND_POINTS = 1000;

/** Why a round did not reach the board. Every one is a decision, not an error. */
const SKIP = Object.freeze({
  NO_UID: "no-uid",
  NO_GRADE: "no-grade",
  NOT_CONSENTED: "not-consented",
  PROFILE_PRIVATE: "profile-private",
});

/**
 * Strip anything that could carry an account identity out of a name.
 *
 * The board this replaces printed `scores.displayName` verbatim, which is
 * whatever the learner (or their Google account) put in the field — and the
 * live board carried a row reading "Elisha C at zedexams.com". A learner's
 * email address is not something other learners get to read because a name
 * field happened to hold one.
 *
 * Three shapes are removed, because the leak arrives in all three:
 * `name@host.tld`, the spelled-out `name at host.tld`, and a bare
 * `host.tld` left behind by either. Digits go too — an email local part
 * often survives as `luyando2014`, and no real first name needs them.
 */
function stripIdentifiers(raw) {
  return String(raw || "")
      .replace(/\S+@\S+/g, " ")
      .replace(/\S+\s+at\s+\S+\.[a-z]{2,}/gi, " ")
      .replace(/\S+\.[a-z]{2,}(\b|$)/gi, " ")
      // Digits vanish rather than splitting the word: "luyando2014" is one
      // name with a birth year stuck on it, not two.
      .replace(/[0-9]+/g, "")
      .replace(/[_]+/g, " ")
      .replace(/[^\p{L}\s'-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
}

/**
 * Does this word look like a machine identifier rather than a name?
 *
 * A Firebase uid survives digit-stripping as a long run of alternating case
 * ("aX9kZ2pQ1mNvB3" → "aXkZpQmNvB"), and rendering that on a public board as
 * "AX M." is worse than admitting we do not know the learner's name.
 *
 * The test is INTERIOR case transitions, and the threshold is set so real
 * names survive: "McDonald" and "MacBanda" have exactly one and are short,
 * which is the shape of a name; a uid fragment has several, or one inside a
 * word longer than any Zambian given name.
 */
function looksLikeIdentifier(word) {
  const transitions = (word.match(/\p{Ll}\p{Lu}/gu) || []).length;
  return transitions >= 2 || (transitions >= 1 && word.length >= 12);
}

/** "chanda" → "Chanda". Leaves an already-capitalised name alone. */
function titleCase(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The name one learner may see for another: **first name + last initial**.
 *
 * "Chanda Mwale" → "Chanda M." — enough for a child to recognise a
 * classmate, not enough to be a directory of minors' full names. It is a
 * deliberate half-step past `functions/duel/index.js#publicName`, which
 * gives an opponent the first name alone: a duel names ONE person the
 * learner is already playing, while a board lists a whole grade, where two
 * Chandas are common and indistinguishable.
 *
 * Falls back to "Learner" rather than to a uid, an email or an empty string.
 * A blank name on a public row is the failure mode this exists to prevent.
 */
function publicLearnerName(raw) {
  const cleaned = stripIdentifiers(raw);
  if (!cleaned) return "Learner";
  const words = cleaned.split(" ").filter((w) => w && !looksLikeIdentifier(w));
  if (!words.length) return "Learner";
  const first = titleCase(words[0]).slice(0, 18);
  if (!first) return "Learner";
  if (words.length === 1) return first;
  const initial = titleCase(words[words.length - 1]).charAt(0);
  return initial ? `${first} ${initial}.` : first;
}

/**
 * May this round reach the public board?
 *
 * Two independent refusals, and neither costs the learner their score — the
 * `scores` row is already written and their history, badges and level are
 * untouched. What they lose is a public row, which is the only thing either
 * refusal is about.
 *
 *   • **Guardian consent.** Resolved by the same `consentGuard` gate the
 *     Daily Quiz's board uses, and it FAILS CLOSED: an unreadable consent
 *     state means no board write, per /child-safety.
 *   • **`learnerSettings.privacy.profileVisibility === 'private'`.** The
 *     setting has always been labelled "Hidden from leaderboards" in
 *     Settings › Privacy and, until this rollup, nothing in the repo read
 *     it — a learner who asked to be hidden appeared anyway. Honouring it
 *     here is what makes the label true.
 *
 * ── The grade is the LEARNER's, never the score row's ────────────────────
 *
 * `buildGameScorePayload` writes `grade: Number(game.grade)` — which grade's
 * GAME was played, not who played it. Two things follow. A Grade 7 learner
 * revising with a Grade 5 game would have been filed on the Grade 5 board,
 * ranked against nine-year-olds; and because `scores.grade` is written
 * straight from the client with only `is number` to stop it, choosing a
 * grade would have been choosing a board. So the grade is read from
 * `users/{uid}` here, which the learner cannot write to arbitrarily
 * (`firestore.rules` bounds the self-update) and which is what "everyone in
 * Grade 7" means on the page.
 *
 * A learner whose profile has no grade yet gets NO board row, rather than a
 * guessed one. They are in the setup wizard, and a guess would put them on
 * a board they never chose.
 *
 * @param {object} args
 * @param {string} args.uid
 * @param {string|number} args.profileGrade  `users/{uid}.grade` — stored
 *                                           loosely (the wizard writes a
 *                                           string), so it is coerced here
 *                                           exactly as `resolveLearnerGrade`
 *                                           coerces it on the client
 * @param {boolean} args.consented    `capabilities.includes('leaderboard')`
 * @param {object|null} args.profile  the `users/{uid}` document
 */
function resolveBoardEligibility({uid, profileGrade, consented, profile}) {
  if (!uid) return {eligible: false, reason: SKIP.NO_UID};

  const gradeNumber = Number(String(profileGrade ?? "").trim());
  if (!Number.isInteger(gradeNumber) || gradeNumber <= 0) {
    return {eligible: false, reason: SKIP.NO_GRADE};
  }

  if (!consented) return {eligible: false, reason: SKIP.NOT_CONSENTED};

  const visibility = profile?.learnerSettings?.privacy?.profileVisibility;
  if (visibility === "private") {
    return {eligible: false, reason: SKIP.PROFILE_PRIVATE};
  }

  return {eligible: true, grade: gradeNumber};
}

/**
 * The points one `scores` row contributes, clamped and coerced.
 *
 * A negative or non-finite value contributes zero rather than subtracting:
 * the round still happened (`plays` still increments), it simply earns
 * nothing. Fractions are floored so the board only ever shows whole points.
 */
function roundPoints(rawScore) {
  const n = Math.floor(Number(rawScore));
  if (!Number.isFinite(n) || n <= 0) return {points: 0, clamped: false};
  if (n > MAX_ROUND_POINTS) return {points: MAX_ROUND_POINTS, clamped: true};
  return {points: n, clamped: false};
}

module.exports = {
  MAX_ROUND_POINTS,
  SKIP,
  stripIdentifiers,
  looksLikeIdentifier,
  publicLearnerName,
  resolveBoardEligibility,
  roundPoints,
};
