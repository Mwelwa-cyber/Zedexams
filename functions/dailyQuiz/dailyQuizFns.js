/**
 * functions/dailyQuiz/dailyQuizFns.js
 *
 * The Daily Quiz's public surface: one read path, one submit path, one cron.
 *
 * ── ONE read path ────────────────────────────────────────────────────
 *
 * `getTodaysQuiz` is the ONLY thing that reads `dailyQuizzes`. Home, the
 * Games hub and anything else that shows the daily quiz call it and nothing
 * else touches the collection. That is the whole architectural point: the
 * bug this replaces was two readers of one daily quiz, one of them not
 * grade-filtered, so Home said "no quiz today" while another surface served
 * a Grade 4 quiz to a Grade 6 learner. Two readers of one collection will
 * always drift; one function cannot.
 *
 * The grade comes from the learner's PROFILE, server-side. It is never a
 * parameter, because a client-supplied grade is exactly how a learner ends
 * up on another grade's quiz — whether by a bug or on purpose.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {assertVerifiedAuth} = require("../authGuard");
const {getUserRole, isAdminRole} = require("../aiService");
const {resolveCallerAccess} = require("../consentGuard");
const {choiceEquals} = require("../grading/dailyExamGrading");
const {sendOpsAlert} = require("../opsAlert");
const {
  DAILY_QUIZ_GRADES,
  DAILY_QUIZ_QUESTION_COUNT,
  RUNWAY_ALERT_DAYS,
  scoreAttempt,
  canEditQuiz,
  seedFor,
  seedHex,
  selectQuestions,
} = require("./dailyQuizCore");
const svc = require("./dailyQuizService");

// ── Handlers, not builders ───────────────────────────────────────────
//
// Every export here is a bare handler; the `onCall` / `onSchedule` builders
// that carry region, schedule and timeout live in functions/index.js. That
// split is a repo RULE rather than a style: `test:functions-manifest` freezes
// each export's options by reading index.js, and a module that wraps its own
// builder moves its region and runtime options out of that guard's sight.
/** Read the learner's grade from their own profile. Never from the client. */
async function resolveLearnerGrade(db, uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpsError("not-found", "We could not find your account.");
  const grade = snap.data()?.grade;
  const normalised = String(grade ?? "").trim();
  if (!normalised) {
    throw new HttpsError(
        "failed-precondition",
        "Choose your grade to start today's quiz.",
        {reason: "no-grade"},
    );
  }
  return {grade: normalised, user: snap.data() || {}};
}

/**
 * May this learner's score reach the weekly board?
 *
 * A learner still waiting on their guardian MAY PLAY — they simply do not
 * appear on the board, per the published /child-safety promise. So this
 * resolves to a boolean rather than throwing the way `assertLearnerCapability`
 * does: a refusal here must cost the child their rank, never their quiz.
 * Fails CLOSED — an unreadable consent state means no leaderboard write.
 */
async function mayRank(db, uid) {
  try {
    const {access} = await resolveCallerAccess(uid, db);
    return Boolean(access?.capabilities?.includes("leaderboard"));
  } catch (err) {
    console.warn("[dailyQuiz] leaderboard consent lookup failed:", err?.message || err);
    return false;
  }
}

// ── §1  getTodaysQuiz — the one read path ────────────────────────────

exports.getTodaysQuizHandler = async (request) => {
  const uid = await assertVerifiedAuth(request);
  const db = admin.firestore();
  const date = svc.today();
  const {grade} = await resolveLearnerGrade(db, uid);

  // `alreadyPlayed` rides along so the client can render the "already
  // played" card without a second round trip — the card is on Home, which
  // is the most latency-sensitive screen in the product.
  const attemptSnap = await db.collection(svc.ATTEMPTS)
      .doc(svc.attemptDocId(uid, date)).get();
  const attempt = attemptSnap.exists ? attemptSnap.data() : null;

  // LAZY SELF-HEAL. If the cron died, the first learner to open the app
  // builds the document and everyone else in that grade gets the same one —
  // the seed guarantees it is the same five the cron would have written.
  // A failed cron must never surface to a learner as "no quiz today".
  let doc;
  try {
    const ensured = await svc.ensureDailyQuiz(db, {
      grade, date, createdBy: "selfheal", actorUid: uid,
    });
    doc = ensured.doc;
  } catch (err) {
    console.error("[dailyQuiz] build failed", {grade, date, err: err?.message || err});
    throw new HttpsError("unavailable", "We could not load today's quiz. Please try again.");
  }

  const ranked = doc.status !== "thin";
  let questions = [];
  if (ranked) {
    questions = await svc.loadLearnerQuestions(db, doc.questionIds);
  }

  // §5 — the only honest empty state. A thin bank becomes a labelled
  // practice set, never a card with nothing to tap.
  if (!ranked || questions.length < DAILY_QUIZ_QUESTION_COUNT) {
    const practice = await svc.buildPracticeSet(db, {grade, uid, date});
    return {
      date,
      grade,
      ranked: false,
      status: "practice",
      reason: "thin_bank",
      questions: practice.questions,
      subjects: practice.subjects,
      alreadyPlayed: Boolean(attempt),
      result: attempt ? publicResult(attempt) : null,
      canRank: false,
    };
  }

  return {
    date,
    grade,
    ranked: true,
    status: doc.status,
    seed: doc.seed,
    questions,
    subjects: doc.subjects || [],
    voidedQuestionIds: doc.voidedQuestionIds || [],
    alreadyPlayed: Boolean(attempt),
    result: attempt ? publicResult(attempt) : null,
    canRank: await mayRank(db, uid),
  };
};

/** The parts of a stored attempt a client may see. */
function publicResult(attempt) {
  return {
    correct: attempt.correct ?? 0,
    credited: attempt.credited ?? 0,
    total: attempt.total ?? DAILY_QUIZ_QUESTION_COUNT,
    points: attempt.points ?? 0,
    allCorrect: Boolean(attempt.allCorrect),
    ranked: Boolean(attempt.ranked),
    submittedAt: attempt.submittedAt || null,
    perQuestion: (attempt.perQuestion || []).map((r) => ({
      questionId: r.questionId,
      subject: r.subject,
      correct: Boolean(r.correct),
      chosen: r.chosen ?? null,
      correctAnswer: r.correctAnswer ?? null,
      explanation: r.explanation || "",
      voided: Boolean(r.voided),
    })),
  };
}

// ── §4  answerDailyQuizQuestion — the server marks it, one at a time ──

/**
 * Record ONE answer and return the feedback for it.
 *
 * ── Why this is incremental rather than one submit at the end ────────
 *
 * The learner is shown whether they were right the moment they tap, with a
 * line of why — feedback that arrives after all five is feedback nobody
 * reads. But the client cannot mark anything: it has never seen the answer
 * key, and shipping the key so it could would defeat the whole design.
 *
 * So the answer is marked HERE, per question, and the key for that one
 * question comes back with the verdict. That leaks nothing: the learner has
 * already committed to an answer for it, and the answer is final (a second
 * call for the same question returns the first verdict rather than
 * re-marking, so nobody can walk the options).
 *
 * The attempt FINALISES on the last answer — score, bonus and the
 * leaderboard write all happen in that same call. There is no separate
 * submit to lose.
 *
 * The client sends the CHOSEN OPTION and nothing else. No score, no
 * correctness, no points field is read from the payload — `test:daily-quiz-
 * scoring` pins that, because "we ignore it" is a claim about absence and
 * absence is what a later refactor quietly reintroduces.
 */
exports.answerDailyQuizQuestionHandler = async (request) => {
  const uid = await assertVerifiedAuth(request);
  const db = admin.firestore();
  const date = svc.today();
  const {grade, user} = await resolveLearnerGrade(db, uid);

  const questionId = String(request.data?.questionId || "");
  if (!questionId) throw new HttpsError("invalid-argument", "questionId is required.");
  const chosen = request.data?.chosen;
  const elapsedMs = Math.max(0, Math.min(Number(request.data?.elapsedMs) || 0, 6 * 60 * 60 * 1000));

  const quizSnap = await db.collection(svc.QUIZZES).doc(svc.quizDocId(grade, date)).get();
  if (!quizSnap.exists) {
    throw new HttpsError("failed-precondition", "There is no ranked quiz for today.");
  }
  const quiz = quizSnap.data();
  if (quiz.status === "thin") {
    // A practice set scores nothing on the board, by design. Refusing the
    // write is what makes `ranked: false` true rather than decorative.
    throw new HttpsError("failed-precondition", "Today's practice set is not scored.");
  }
  const questionIds = (quiz.questionIds || []).map(String);
  if (!questionIds.includes(questionId)) {
    throw new HttpsError("invalid-argument", "That question is not in today's quiz.");
  }

  // The key and the learner-safe pool together: the key marks the answer,
  // the pool supplies the subject stored on the row (the weakest-subject
  // lookup behind the practice fallback reads it back).
  const [key, pool] = await Promise.all([
    svc.loadAnswerKey(db, questionIds),
    svc.loadLearnerQuestions(db, questionIds),
  ]);
  const entry = key.get(questionId);
  const subject = pool.find((q) => q.id === questionId)?.subject || "";
  const voided = new Set((quiz.voidedQuestionIds || []).map(String));
  const isVoid = voided.has(questionId);
  // A question whose bank row has gone missing is credited rather than marked
  // wrong: the learner answered what they were shown, and we can no longer
  // prove what the right answer was.
  const correct = isVoid || !entry ? true : choiceEquals(chosen, entry.correctAnswer);

  const attemptRef = db.collection(svc.ATTEMPTS).doc(svc.attemptDocId(uid, date));
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(attemptRef);
    const existing = snap.exists ? snap.data() : null;
    const rows = existing?.perQuestion ? [...existing.perQuestion] : [];

    // ANSWERS ARE FINAL. A repeat call returns the recorded verdict without
    // re-marking, so a learner cannot tap through the options watching which
    // one comes back green.
    const already = rows.find((r) => String(r.questionId) === questionId);
    if (already) return {row: already, attempt: existing, replayed: true};
    if (existing?.status === "submitted") {
      return {row: null, attempt: existing, replayed: true};
    }

    const row = {
      questionId,
      subject,
      chosen: chosen ?? null,
      correct: Boolean(correct),
      correctAnswer: entry?.correctAnswer ?? null,
      explanation: entry?.explanation || "",
      voided: isVoid,
    };
    rows.push(row);

    const answeredAll = rows.length >= questionIds.length;
    const base = {
      uid,
      grade: String(grade),
      date,
      quizDocId: quizSnap.id,
      seed: quiz.seed || null,
      total: questionIds.length,
      perQuestion: rows,
      status: answeredAll ? "submitted" : "in_progress",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!answeredAll) {
      tx.set(attemptRef, {
        ...base,
        startedAt: existing?.startedAt || admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      return {row, attempt: {...base}, replayed: false, finalised: false};
    }

    const marks = rows.filter((r) => !r.voided).map((r) => (r.correct ? 1 : 0));
    const score = scoreAttempt({
      marks,
      voidedCount: rows.filter((r) => r.voided).length,
      count: questionIds.length,
    });
    const finalAttempt = {
      ...base,
      correct: score.correct,
      credited: score.credited,
      points: score.points,
      allCorrect: score.allCorrect,
      elapsedMs,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    tx.set(attemptRef, finalAttempt, {merge: true});
    return {row, attempt: finalAttempt, replayed: false, finalised: true, score};
  });

  // Only a genuinely finalised attempt moves the board, and only for a
  // learner whose guardian has approved. An unapproved learner keeps their
  // result and their feedback — they simply do not appear in the ranking.
  let weekId = null;
  let ranked = false;
  if (outcome.finalised) {
    ranked = await mayRank(db, uid);
    await attemptRef.update({ranked});
    if (ranked && outcome.score.points > 0) {
      try {
        weekId = await svc.bumpLeaderboard(db, {
          grade,
          uid,
          date,
          points: outcome.score.points,
          elapsedMs,
          displayName: user.displayName || user.name || null,
        });
      } catch (err) {
        // A failed board write must not cost the learner their attempt — the
        // attempt is the record, the board is a derived view of it.
        console.error("[dailyQuiz] leaderboard write failed:", err?.message || err);
      }
    }
  }

  return {
    questionId,
    correct: outcome.row ? Boolean(outcome.row.correct) : null,
    correctAnswer: outcome.row?.correctAnswer ?? null,
    explanation: outcome.row?.explanation || "",
    voided: Boolean(outcome.row?.voided),
    replayed: Boolean(outcome.replayed),
    finalised: Boolean(outcome.finalised),
    answeredCount: outcome.attempt?.perQuestion?.length || 0,
    total: questionIds.length,
    result: outcome.finalised
      ? {...publicResult({...outcome.attempt, ranked}), rankHidden: !ranked, weekId}
      : null,
  };
};


// ── §3  the nightly cron ─────────────────────────────────────────────

/**
 * 00:05 Africa/Lusaka, every grade. Nine small documents a night at most —
 * that is the entire output, and everything the learner sees hangs off them.
 *
 * One grade failing must not stop the others, so each is caught
 * individually. The whole run is idempotent: `ensureDailyQuiz` returns an
 * existing document untouched, and the seed means a rebuild would produce
 * the same five anyway.
 */
exports.buildDailyQuizzesHandler = async () => {
  const db = admin.firestore();
  const date = svc.today();
  const results = await runBuildForAllGrades(db, date, "cron");
  await alertOnThinRunway(db, date);
  console.info("[dailyQuiz] cron complete", JSON.stringify(results));
  return null;
};

/** Shared by the cron and the console's "Run now" button, so they cannot drift. */
async function runBuildForAllGrades(db, date, createdBy, actorUid = null) {
  const results = [];
  for (const grade of DAILY_QUIZ_GRADES) {
    try {
      const {doc, created} = await svc.ensureDailyQuiz(db, {grade, date, createdBy, actorUid});
      results.push({
        grade,
        ok: true,
        created,
        status: doc.status,
        rulesRelaxed: doc.rulesRelaxed || [],
        questionCount: (doc.questionIds || []).length,
      });
    } catch (err) {
      console.error("[dailyQuiz] build failed", {grade, date, err: err?.message || err});
      results.push({grade, ok: false, error: err?.message || "build failed"});
      await svc.logEvent(db, {
        type: "build_failed", grade: String(grade), date, error: err?.message || "build failed",
      });
    }
  }
  return results;
}

/**
 * Email the content team when a grade's runway crosses 30 days — once a
 * month, not nightly. The real cause of an empty card is a starved bank,
 * not a dead cron, and this fires weeks before a child would ever see one.
 */
async function alertOnThinRunway(db, date) {
  let rows;
  try {
    rows = await svc.bankHealth(db, DAILY_QUIZ_GRADES);
  } catch (err) {
    console.error("[dailyQuiz] bank health failed:", err?.message || err);
    return;
  }
  for (const row of rows) {
    // `unknown` is a failed count, not a starved bank. Paging on it would
    // train the team to ignore the address.
    if (row.level !== "critical") continue;
    const claimed = await svc.claimRunwayAlert(db, {
      grade: row.grade, date, runwayDays: row.runwayDays,
    });
    if (!claimed) continue;
    await svc.logEvent(db, {
      type: "runway_alert", grade: row.grade, date,
      runwayDays: row.runwayDays, eligible: row.eligible,
    });
    try {
      await sendOpsAlert({
        severity: "warning",
        title: `Daily Quiz: Grade ${row.grade} has ${row.runwayDays} days of runway`,
        lines: [
          `Grade ${row.grade} has ${row.eligible} approved questions in the bank — ` +
            `${row.runwayDays} days of daily quizzes at five a day.`,
          `Below ${RUNWAY_ALERT_DAYS} days the content team needs to author more.`,
          "At zero, learners get the labelled practice set instead of a ranked quiz.",
          "This alert is sent once per grade per month.",
        ],
      });
    } catch (err) {
      console.error("[dailyQuiz] runway alert send failed:", err?.message || err);
    }
  }
}

// ── §6  the admin console ────────────────────────────────────────────

/** Staff only. The console is not a learner or parent surface. */
async function assertStaff(request) {
  const uid = await assertVerifiedAuth(request);
  // isAdminRole rather than a string compare: superAdmin is a strict
  // superset of admin everywhere in the app, and an "admin only" gate that
  // compares to "admin" alone locks out the project owner.
  if (!isAdminRole(await getUserRole(uid))) {
    throw new HttpsError("permission-denied", "Staff only.");
  }
  return uid;
}

/**
 * Everything the five tabs need, in one call.
 *
 * One round trip rather than five: the console is opened rarely and read
 * whole, and five callables would each re-derive the same date and grade
 * list.
 */
exports.adminDailyQuizOverviewHandler = async (request) => {
  await assertStaff(request);
  const db = admin.firestore();
  const date = String(request.data?.date || svc.today());
  const tomorrow = svc.shiftDate(date, 1);

  const [todayDocs, tomorrowDocs, health, events] = await Promise.all([
    loadRunRows(db, date),
    loadRunRows(db, tomorrow),
    svc.bankHealth(db, DAILY_QUIZ_GRADES),
    loadEvents(db, 60),
  ]);

  return {
    date,
    tomorrow,
    grades: DAILY_QUIZ_GRADES,
    today: todayDocs,
    preview: tomorrowDocs,
    health,
    events,
    cutoffHour: require("./dailyQuizCore").SWAP_CUTOFF_HOUR,
    nowHour: svc.lusakaNowParts().hour,
  };
};

async function loadRunRows(db, date) {
  const rows = [];
  for (const grade of DAILY_QUIZ_GRADES) {
    const snap = await db.collection(svc.QUIZZES).doc(svc.quizDocId(grade, date)).get();
    if (!snap.exists) {
      rows.push({grade, date, docId: svc.quizDocId(grade, date), exists: false, status: "queued"});
      continue;
    }
    const data = snap.data();
    const questions = await svc.loadLearnerQuestions(db, data.questionIds || []);
    rows.push({
      grade,
      date,
      docId: snap.id,
      exists: true,
      status: data.status,
      createdBy: data.createdBy,
      seed: data.seed,
      rulesRelaxed: data.rulesRelaxed || [],
      poolSize: data.poolSize ?? null,
      voidedQuestionIds: data.voidedQuestionIds || [],
      questions,
    });
  }
  return rows;
}

async function loadEvents(db, limit) {
  try {
    const snap = await db.collection(svc.EVENTS).orderBy("at", "desc").limit(limit).get();
    return snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        ...data,
        at: data.at?.toDate?.().toISOString() || null,
      };
    });
  } catch (err) {
    console.warn("[dailyQuiz] event read failed:", err?.message || err);
    return [];
  }
}

/**
 * Tab 2 — "How it picks". Re-runs the selector for a grade/date and reports
 * the pool count after each rule, WITHOUT writing anything. A read-only view
 * of a decision that has already been made must not be able to change it.
 */
exports.adminDailyQuizFunnelHandler = async (request) => {
  await assertStaff(request);
  const db = admin.firestore();
  const grade = String(request.data?.grade || DAILY_QUIZ_GRADES[0]);
  const date = String(request.data?.date || svc.today());

  const [pool, recentDocs] = await Promise.all([
    svc.fetchEligiblePool(db, grade),
    svc.fetchRecentQuizDocs(db, grade, date),
  ]);
  const stale = new Set(recentDocs.flatMap((d) => d.questionIds || []).map(String));
  const fresh = pool.filter((p) => !stale.has(String(p.id)));
  const selection = selectQuestions({pool, grade, date, recentDocs});
  const questions = await svc.loadLearnerQuestions(db, selection.questionIds);

  return {
    grade,
    date,
    seed: seedHex(seedFor(grade, date)),
    steps: [
      {key: "approved", label: "Approved bank", count: pool.length, unit: "questions"},
      {key: "fresh", label: "Not served in 30 days", count: fresh.length, unit: "remain"},
      {key: "slots", label: "Subject spread", count: DAILY_QUIZ_QUESTION_COUNT, unit: "slots"},
      {key: "mix", label: "Difficulty mix", count: "2·2·1", unit: "mix"},
      {key: "picked", label: "Seeded pick", count: selection.questionIds.length, unit: "chosen"},
    ],
    rulesRelaxed: selection.rulesRelaxed,
    status: selection.status,
    questions,
  };
};

/** Run the build now, for every grade. Same code path as the cron. */
exports.adminRunDailyQuizNowHandler = async (request) => {
  const uid = await assertStaff(request);
  const db = admin.firestore();
  const date = String(request.data?.date || svc.today());
  const results = await runBuildForAllGrades(db, date, "admin", uid);
  await svc.logEvent(db, {type: "admin_run", date, actorUid: uid, results});
  return {date, results};
};

/**
 * §6.3 — swap one question in a FUTURE quiz.
 *
 * The lock is `canEditQuiz`, and it is checked against the live attempt
 * count rather than a stored flag: "has anyone played" is a fact about the
 * database, and a flag would be one deploy away from disagreeing with it.
 */
exports.adminSwapDailyQuizQuestionHandler = async (request) => {
  const uid = await assertStaff(request);
  const db = admin.firestore();
  const grade = String(request.data?.grade || "");
  const date = String(request.data?.date || "");
  const slot = Number(request.data?.slot);
  const replacementId = String(request.data?.questionId || "");
  if (!grade || !date || !Number.isInteger(slot) || slot < 0) {
    throw new HttpsError("invalid-argument", "grade, date and slot are required.");
  }

  const ref = db.collection(svc.QUIZZES).doc(svc.quizDocId(grade, date));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "No quiz for that grade and date.");
    const data = snap.data();

    const attempts = await db.collection(svc.ATTEMPTS)
        .where("grade", "==", grade).where("date", "==", date).limit(1).get();
    const gate = canEditQuiz({
      quizDate: date,
      today: svc.today(),
      nowHour: svc.lusakaNowParts().hour,
      hasAttempts: !attempts.empty,
    });
    if (!gate.allowed) {
      throw new HttpsError("failed-precondition", swapRefusal(gate.reason), {reason: gate.reason});
    }

    const ids = [...(data.questionIds || [])];
    if (slot >= ids.length) throw new HttpsError("invalid-argument", "That slot does not exist.");
    if (ids.includes(replacementId)) {
      throw new HttpsError("invalid-argument", "That question is already in this quiz.");
    }
    const previous = ids[slot];
    ids[slot] = replacementId;
    tx.update(ref, {
      questionIds: ids,
      createdBy: "admin",
      lastEditedBy: uid,
      lastEditedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {previous, replacementId, questionIds: ids};
  });

  await svc.logEvent(db, {
    type: "admin_swap", grade, date, slot, actorUid: uid,
    previousQuestionId: result.previous, questionId: result.replacementId,
  });
  return result;
};

function swapRefusal(reason) {
  if (reason === "attempts_exist") {
    return "A learner has already played this quiz. Void the question instead of editing it.";
  }
  if (reason === "past_cutoff") return "Swaps close at 23:00. This quiz is locked.";
  return "Only a future quiz can be edited.";
}

/**
 * §6.3 — void a question in a LIVE quiz.
 *
 * The answer to an error found after midnight. Never edit a live quiz:
 * every player is credited its ten points, the card says the question was
 * removed, and the bank item goes back to review. Fair beats perfect.
 *
 * Existing attempts are re-credited in the same pass, because a learner who
 * already played is precisely who was harmed by the bad question.
 */
exports.adminVoidDailyQuizQuestionHandler = async (request) => {
  const uid = await assertStaff(request);
  const db = admin.firestore();
  const grade = String(request.data?.grade || "");
  const date = String(request.data?.date || "");
  const questionId = String(request.data?.questionId || "");
  const reason = String(request.data?.reason || "").slice(0, 500);
  if (!grade || !date || !questionId) {
    throw new HttpsError("invalid-argument", "grade, date and questionId are required.");
  }

  const ref = db.collection(svc.QUIZZES).doc(svc.quizDocId(grade, date));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No quiz for that grade and date.");
  if (!(snap.data().questionIds || []).map(String).includes(questionId)) {
    throw new HttpsError("invalid-argument", "That question is not in this quiz.");
  }

  await ref.update({
    voidedQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
    lastEditedBy: uid,
    lastEditedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Re-credit everyone who already played. Batched, and bounded by the
  // grade-day, which is at most one attempt per learner.
  const attempts = await db.collection(svc.ATTEMPTS)
      .where("grade", "==", grade).where("date", "==", date).get();
  let recredited = 0;
  for (const doc of attempts.docs) {
    const data = doc.data();
    const row = (data.perQuestion || []).find((r) => String(r.questionId) === questionId);
    if (!row || row.voided || row.correct) continue; // already credited
    const perQuestion = (data.perQuestion || []).map((r) =>
      String(r.questionId) === questionId ? {...r, voided: true, correct: true} : r);
    const marks = perQuestion.filter((r) => !r.voided).map((r) => (r.correct ? 1 : 0));
    const voidedCount = perQuestion.filter((r) => r.voided).length;
    const rescored = scoreAttempt({marks, voidedCount, count: data.total || DAILY_QUIZ_QUESTION_COUNT});
    const delta = rescored.points - (data.points || 0);
    await doc.ref.update({
      perQuestion,
      correct: rescored.correct,
      credited: rescored.credited,
      points: rescored.points,
      allCorrect: rescored.allCorrect,
    });
    if (delta !== 0 && data.ranked) {
      try {
        await svc.bumpLeaderboard(db, {
          grade, uid: data.uid, date, points: delta, elapsedMs: 0,
        });
        // bumpLeaderboard counts a day played; a re-credit is not a new day.
        await db.collection(svc.LEADERBOARDS).doc(grade)
            .collection("weeks").doc(svc.weekIdFor(date))
            .collection("entries").doc(String(data.uid))
            .update({daysPlayed: admin.firestore.FieldValue.increment(-1)});
      } catch (err) {
        console.error("[dailyQuiz] re-credit board write failed:", err?.message || err);
      }
    }
    recredited += 1;
  }

  await svc.logEvent(db, {
    type: "admin_void", grade, date, questionId, actorUid: uid, reason, recredited,
  });
  return {questionId, recredited};
};

module.exports.DAILY_QUIZ_GRADES = DAILY_QUIZ_GRADES;
module.exports.runBuildForAllGrades = runBuildForAllGrades;
module.exports.alertOnThinRunway = alertOnThinRunway;
