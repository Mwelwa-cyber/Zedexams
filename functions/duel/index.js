/**
 * Live learner-vs-learner challenge (PROMPT 9) — server side.
 *
 * Two functions, exported through factories the way dispatcher.js does:
 *
 *   duelQueueOnCreate (Firestore trigger, africa-south1 — colocated with
 *     the (default) database like every Firestore trigger here):
 *     a learner writes duelQueue/{their-uid}; the trigger transactionally
 *     pairs them with the oldest live same-grade entry, draws the shared
 *     question set (seeded by the match id, so both players provably get
 *     the same questions), creates matches/{id} and stamps both queue
 *     docs with the matchId so each client learns its match by watching
 *     its OWN doc — no client ever lists the queue (no roster).
 *
 *   submitDuelAnswers (callable, us-central1 like other callables):
 *     takes raw answer indexes, grades them against the SERVER's copy of
 *     the match questions, and settles the match in a transaction. A
 *     client never sends a score.
 *
 * Every decision lives in duelCore.js (plain-node tested).
 */

"use strict";

const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const core = require("./duelCore");

const QUESTION_COUNT = 5;

/** First name / nickname only — the compliance shape for anything shown
 *  to the opponent. Never an email, never a uid. */
function publicName(profile) {
  const raw = String(profile?.displayName || "").trim();
  if (!raw) return "Learner";
  return raw.split(/\s+/)[0].slice(0, 20);
}

function createDuelQueueOnCreate() {
  return onDocumentCreated(
    {document: "duelQueue/{uid}", region: "africa-south1"},
    async (event) => {
      const snap = event.data;
      if (!snap) return;
      const uid = event.params.uid;
      const entry = snap.data() || {};
      // The doc id is the identity; a queue doc claiming to be someone
      // else is ignored outright.
      if (entry.uid && entry.uid !== uid) return;
      const db = getFirestore();

      const grade = Number(entry.grade);
      if (!Number.isFinite(grade)) return;

      await db.runTransaction(async (tx) => {
        // Oldest few live entries in this grade. The query is server-side
        // only — rules deny clients any list of the queue.
        const waitingSnap = await tx.get(
          db.collection("duelQueue")
            .where("grade", "==", grade)
            .orderBy("createdAtMs", "asc")
            .limit(8),
        );
        const waiting = waitingSnap.docs
          .filter((d) => d.id !== uid && !d.get("matchId"))
          .map((d) => ({uid: d.id, grade: d.get("grade"), createdAtMs: d.get("createdAtMs")}));

        const opponent = core.pickOpponent(waiting, {uid, grade}, Date.now());
        if (!opponent) return; // stay queued; the next arrival pairs us

        // The shared question set comes from the grade's timed-quiz bank
        // (the same public games catalogue the daily challenge plays).
        const gameSnap = await tx.get(
          db.collection("games")
            .where("grade", "==", grade)
            .where("type", "==", "timed_quiz")
            .limit(1),
        );
        const gameDoc = gameSnap.docs[0];
        const bank = gameDoc ? (gameDoc.get("questions") || []) : [];
        if (!bank.length) return; // nothing to race on — leave both queued

        const matchRef = db.collection("matches").doc();
        const questions = core.drawQuestions(bank, matchRef.id, QUESTION_COUNT);

        const [profA, profB] = await Promise.all([
          tx.get(db.collection("users").doc(uid)),
          tx.get(db.collection("users").doc(opponent.uid)),
        ]);

        tx.create(matchRef, {
          players: [uid, opponent.uid],
          names: {
            [uid]: publicName(profA.data()),
            [opponent.uid]: publicName(profB.data()),
          },
          grade,
          gameId: gameDoc.id,
          questions,
          state: "active",
          scores: {},
          winner: null,
          startedAtMs: Date.now(),
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(db.collection("duelQueue").doc(uid), {matchId: matchRef.id});
        tx.update(db.collection("duelQueue").doc(opponent.uid), {matchId: matchRef.id});
      });
    },
  );
}

function createSubmitDuelAnswers() {
  return onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Sign in to race.");
      const matchId = String(request.data?.matchId || "");
      const submitted = Array.isArray(request.data?.answers) ? request.data.answers : null;
      if (!matchId || !submitted) {
        throw new HttpsError("invalid-argument", "matchId and answers are required.");
      }

      const db = getFirestore();
      const ref = db.collection("matches").doc(matchId);
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
        const match = snap.data();
        const graded = core.gradeSubmission(match.questions, submitted);
        const settled = core.settleMatch(match, uid, graded.score, Date.now());
        if (!settled.ok) throw new HttpsError("failed-precondition", settled.reason);
        tx.update(ref, settled.patch);
        return {graded, done: settled.patch.state === "done", patch: settled.patch};
      });

      return {
        correct: result.graded.correct,
        total: result.graded.total,
        score: result.graded.score,
        done: result.done,
        winner: result.done ? result.patch.winner : null,
        draw: result.done ? !!result.patch.draw : false,
      };
    },
  );
}

module.exports = {createDuelQueueOnCreate, createSubmitDuelAnswers};
