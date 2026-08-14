/**
 * Quiz summary mirror — the read-side optimisation for the learner quiz
 * library.
 *
 * The library (src/features/quiz/pages/QuizList.jsx via useFirestore.getQuizzes)
 * lists quizzes by grade/subject/term and renders only metadata (title,
 * subject, duration, questionCount, …). But each `quizzes/{id}` doc also
 * carries its full embedded `passages[]` (comprehension text + image URLs),
 * `parts[]`, and `description` — heavy fields the list never shows. The
 * Firestore web SDK has no field projection, so reading the list meant
 * downloading all of that dead weight on every load.
 *
 * This trigger keeps a lightweight `quizSummaries/{id}` mirror — the quiz doc
 * minus the heavy fields — in sync with every write to `quizzes/{id}`. Because
 * it's a Firestore trigger, EVERY write path is covered automatically (admin
 * create/update, teacher edits, publish toggles, the agent pipeline, daily-exam
 * conversions) — there's no app-side write path to forget. getQuizzes reads the
 * mirror once the `appConfig/quizLibrary.useSummaries` flag is on (flipped by
 * the backfill script after it populates existing docs), so the cutover is
 * operator-controlled and instantly reversible.
 */

const admin = require("firebase-admin");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");

// buildQuizSummary lives in a dependency-free module so it can be unit-tested
// with a bare `node` run (no functions package installed). See buildSummary.js.
const {buildQuizSummary, HEAVY_FIELDS} = require("./buildSummary");

// Colocated with the (default) Firestore database in africa-south1 so the
// Eventarc trigger and the function compute share a region — same rationale as
// the storageCleanup triggers.
const COMMON_OPTS = {
  region: "africa-south1",
  timeoutSeconds: 60,
  memory: "256MiB",
};

const onQuizWritten = onDocumentWritten(
  {document: "quizzes/{quizId}", ...COMMON_OPTS},
  async (event) => {
    const quizId = event.params.quizId;
    const summaryRef = admin.firestore()
      .collection("quizSummaries").doc(quizId);
    try {
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;
      // Quiz deleted → drop its mirror. (The parent delete helper removes the
      // quiz doc; this keeps the library from listing a ghost.)
      if (!after) {
        await summaryRef.delete().catch(() => {});
        return;
      }
      await summaryRef.set(buildQuizSummary(after));
    } catch (err) {
      console.warn(`[quizSummary] onQuizWritten(${quizId}) failed`,
        (err && err.message) || err);
    }
  },
);

module.exports = {onQuizWritten};
