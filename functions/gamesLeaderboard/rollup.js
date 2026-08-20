/**
 * functions/gamesLeaderboard/rollup.js
 *
 * The games weekly-board rollup — everything `gameScoreOnCreate` DOES, with
 * no `firebase-functions` import anywhere in its require graph.
 *
 * ── Why that constraint, and why it is a separate file ───────────────────
 *
 * `test:games-leaderboard-flow` drives this end to end under plain `node`,
 * and the CI job that runs it (`Tests (importer + sanitize + schema)`)
 * installs the ROOT dependencies only — never `functions/`. `firebase-admin`
 * happens to resolve from the root tree, which is why the neighbouring
 * `functions/dailyQuiz/dailyQuizService.js` loads there at all;
 * `firebase-functions` does not, and a top-level `require` of it fails the
 * job with MODULE_NOT_FOUND.
 *
 * So the trigger REGISTRATION (`onDocumentCreated`, the one thing that needs
 * `firebase-functions`) stays in `index.js`, and every decision and every
 * write lives here. The split is not cosmetic: it is what makes the whole
 * chain testable without a second `npm install` in CI, and the same reason
 * `functions/duel/duelCore.js` sits beside `functions/duel/index.js`.
 *
 * The full rationale for the rollup itself — why a trigger rather than a
 * callable, the region, and how account deletion reaches these rows — is in
 * `index.js`, which is where a reader arrives first.
 */

"use strict";

const {FieldValue} = require("firebase-admin/firestore");
const {lusakaDayString} = require("../lusakaTime");
const {weekIdFor} = require("../dailyQuiz/dailyQuizService");
const core = require("./gamesLeaderboardCore");

const COLLECTION = "gamesLeaderboards";

/**
 * May this learner's round reach a public board?
 *
 * The same question `functions/dailyQuiz/dailyQuizFns.js#mayRank` asks, and
 * deliberately the same answer: a refusal costs the child their rank, never
 * their round. Fails CLOSED — an unreadable consent state is not consent.
 */
async function mayRank(uid, db) {
  try {
    // Required LAZILY, inside the function, and that is load-bearing rather
    // than tidy: `consentGuard.js` pulls in `firebase-functions/v2/https`
    // for HttpsError, which does not resolve in the plain-node CI job (root
    // dependencies only). Nothing reaches this line there — the flow test
    // injects its own resolver — so the cost of the require is paid only by
    // the deployed function, which has the dependency.
    const {resolveCallerAccess} = require("../consentGuard");
    const {access} = await resolveCallerAccess(uid, db);
    return Boolean(access?.capabilities?.includes("leaderboard"));
  } catch (err) {
    console.warn("[gamesLeaderboard] consent lookup failed:", err?.message || err);
    return false;
  }
}

/**
 * The week a round belongs to.
 *
 * Derived from the row's own `playedAt` rather than from "now", so a
 * trigger that retries after a delivery delay — or one that runs a few
 * seconds after Monday 00:00 for a round played on Sunday night — files
 * the points in the week the learner actually played in. `playedAt` is a
 * server timestamp (`request.time`, pinned by the rules), so it is not
 * something the client chose.
 */
function weekIdForRound(playedAt) {
  const at = typeof playedAt?.toDate === "function" ? playedAt.toDate() : new Date();
  return weekIdFor(lusakaDayString(at));
}

/**
 * The whole rollup, with its two collaborators injected.
 *
 * Split out of the trigger closure so the Daily-Challenge-to-board chain can
 * be driven end to end under plain node (`test:games-leaderboard-flow`)
 * against a fake Firestore — a real round's `scores` payload in, a real
 * board entry out. Without this seam the only thing testable would be the
 * pure decisions, and the wiring between them is exactly where a rollup
 * goes wrong: the right verdict written to the wrong path is still a
 * learner who cannot find themselves on the board.
 *
 * @param {object} args
 * @param {object} args.db               Firestore (admin SDK, or a fake)
 * @param {object} args.row              the `scores` document just created
 * @param {Function} args.resolveConsent `(uid, db) => Promise<boolean>`
 * @param {object} args.increment        a field transform factory for points
 * @param {*} args.serverTimestamp
 * @returns {Promise<{written: boolean, reason?: string, path?: string, points?: number}>}
 */
async function handleScoreCreated({
  db,
  row,
  resolveConsent = mayRank,
  increment = FieldValue.increment,
  serverTimestamp = FieldValue.serverTimestamp,
}) {
  const uid = String(row?.userId || "");

  // The consent read is two documents and it happens per completed round,
  // which is the right place for it: it is the only moment the answer can
  // change the outcome, and a round is a rare event compared with a page
  // view.
  const consented = uid ? await resolveConsent(uid, db) : false;

  let profile = null;
  if (uid) {
    try {
      const userSnap = await db.doc(`users/${uid}`).get();
      profile = userSnap.exists ? userSnap.data() : null;
    } catch (err) {
      console.warn("[gamesLeaderboard] profile read failed:", err?.message || err);
    }
  }

  // The grade is the LEARNER's, read from their profile — not `row.grade`,
  // which is the grade of the GAME they played and is client-written. See
  // resolveBoardEligibility.
  const verdict = core.resolveBoardEligibility({
    uid,
    profileGrade: profile?.grade,
    consented,
    profile,
  });
  if (!verdict.eligible) {
    // Not an error — every reason here is a decision. Logged at info so
    // "why is this learner not on the board" is one query away rather than
    // a debugging session.
    console.info(`[gamesLeaderboard] round not boarded (${verdict.reason})`);
    return {written: false, reason: verdict.reason};
  }

  const {points, clamped} = core.roundPoints(row.score);
  if (clamped) {
    console.warn(
        `[gamesLeaderboard] round score clamped to ${core.MAX_ROUND_POINTS}`,
        {uid, gameId: row.gameId, raw: row.score},
    );
  }

  const weekId = weekIdForRound(row.playedAt);

  // The name comes from the PROFILE, not from the score row. The row's
  // `displayName` is whatever the client sent; the profile is what the
  // learner's account actually says, and it is re-derived on every round so
  // a learner who corrects their name in Settings sees the board follow
  // within one game rather than carrying the old spelling for the rest of
  // the week.
  const displayName = core.publicLearnerName(profile?.displayName || row.displayName);

  const path = `${COLLECTION}/${verdict.grade}/weeks/${weekId}/entries/${uid}`;
  const ref = db.collection(COLLECTION).doc(String(verdict.grade))
      .collection("weeks").doc(weekId)
      .collection("entries").doc(uid);

  try {
    await ref.set({
      uid,
      grade: verdict.grade,
      weekId,
      displayName,
      points: increment(points),
      plays: increment(1),
      lastPlayedAt: row.playedAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    // A failed board write must never look like a failed round. The score
    // is already saved; this is the derived view of it.
    console.error("[gamesLeaderboard] entry write failed:", err?.message || err);
    return {written: false, reason: "write-failed"};
  }

  return {written: true, path, weekId, grade: verdict.grade, points, displayName};
}

module.exports = {COLLECTION, handleScoreCreated, mayRank, weekIdForRound};
