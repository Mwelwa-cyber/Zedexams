/**
 * functions/dailyQuiz/dailyQuizService.js
 *
 * Everything the Daily Quiz does to Firestore. The pure rules live next
 * door in dailyQuizCore.js; this file is the part that needs a database.
 *
 * ── Collections ──────────────────────────────────────────────────────
 *
 *   dailyQuizzes/{grade}_{YYYY-MM-DD}   the day's five question IDs
 *   dailyAttempts/{uid}_{YYYY-MM-DD}    the attempt AND the once-a-day lock
 *   dailyQuizEvents/{autoId}            every write, with its cause
 *   leaderboards/{grade}/weeks/{weekId}/entries/{uid}
 *
 * Clients read NONE of these directly — firestore.rules denies the lot, and
 * every learner-facing read comes back through getTodaysQuiz. That is not
 * belt-and-braces: `dailyQuizzes` holds question IDs into `questionBank`,
 * and a learner who could read both would hold tomorrow's quiz tonight.
 *
 * ── The answer key never leaves this file ────────────────────────────
 *
 * `loadLearnerQuestions` strips the key; `loadAnswerKey` is the only thing
 * that keeps it, and nothing it returns is ever put in a callable response.
 * Both parse the bank row's `data` field, which is a JSON STRING (the bank
 * stores questions that way to sidestep Firestore's no-nested-arrays limit).
 */

const admin = require("firebase-admin");
const {lusakaDayString, lusakaNowParts} = require("../lusakaTime");
const {
  DAILY_QUIZ_QUESTION_COUNT,
  FRESHNESS_WINDOW_DAYS,
  selectQuestions,
  buildQuizDoc,
  runwayFor,
  runwayLevel,
  normalizeSubject,
} = require("./dailyQuizCore");

const QUIZZES = "dailyQuizzes";
const ATTEMPTS = "dailyAttempts";
const EVENTS = "dailyQuizEvents";
const ALERTS = "dailyQuizAlerts";
const BANK = "questionBank";
const LEADERBOARDS = "leaderboards";

/** Answer-key fields, mirroring grading/dailyExamGrading.js#ANSWER_KEY_FIELDS. */
const ANSWER_KEY_FIELDS = ["correctAnswer", "tolerance", "correctRegion", "explanation"];

/** dailyQuizzes doc id. One document per grade per day — the whole output. */
function quizDocId(grade, date) {
  return `${String(grade)}_${String(date)}`;
}

/** dailyAttempts doc id. Being uid+date is what makes it the once-a-day lock. */
function attemptDocId(uid, date) {
  return `${String(uid)}_${String(date)}`;
}

/**
 * ISO week id, `YYYY-Www`. The leaderboard resets on it, so it has to agree
 * with what the learner is told ("resets Sunday midnight") — ISO weeks start
 * Monday, so the board a learner sees on Sunday night is the one that ends
 * that night.
 */
function weekIdFor(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;          // Sunday → 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Today, in the only timezone this product's calendar day means anything in. */
function today() {
  return lusakaDayString();
}

/** The date `n` days before `date`, as a YYYY-MM-DD key. */
function shiftDate(date, days) {
  const [y, m, d] = String(date).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Append to the event log.
 *
 * Every write to `dailyQuizzes` says WHO caused it — cron, self-heal (with
 * the uid that triggered it), or a named admin. When Home says "no quiz
 * today" again, this is what answers *why* in one glance instead of a
 * debugging session. Best-effort: a failed log must never fail the quiz.
 */
async function logEvent(db, entry) {
  try {
    await db.collection(EVENTS).add({
      ...entry,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[dailyQuiz] event log write failed:", err?.message || err);
  }
}

/**
 * The approved pool for a grade.
 *
 * `masterEligible == true` is the Master Bank filter and is only ever set by
 * the server on approval, so it is the same "approved only" the quizzes
 * engine uses — a teacher's own pending row can never reach a learner.
 * Grade is stored as a STRING on bank rows; querying with a number matches
 * nothing and would report every grade as starved.
 */
async function fetchEligiblePool(db, grade) {
  const snap = await db.collection(BANK)
      .where("masterEligible", "==", true)
      .where("grade", "==", String(grade))
      .get();
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      subject: data.subject,
      difficulty: data.difficulty,
      topic: data.topic,
      grade: data.grade,
    };
  });
}

/**
 * The grade's quizzes inside the freshness window, for the "not served in
 * the last 30 days" rule. Bounded by the window, so this is ~30 documents.
 */
async function fetchRecentQuizDocs(db, grade, date) {
  const from = shiftDate(date, -FRESHNESS_WINDOW_DAYS);
  const snap = await db.collection(QUIZZES)
      .where("grade", "==", String(grade))
      .where("date", ">=", from)
      .where("date", "<", String(date))
      .get();
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {date: data.date, questionIds: data.questionIds || []};
  });
}

/**
 * Build (or return) the day's quiz for one grade.
 *
 * IDEMPOTENT IN TWO LAYERS, and it needs both. The transaction stops two
 * simultaneous self-heals both writing; the deterministic seed means that
 * even if a write somehow happened twice, the two documents would be
 * identical. Belt and braces here is cheap and the failure it prevents —
 * two learners in one grade on one leaderboard sitting different quizzes —
 * is invisible once it happens.
 *
 * Returns `{doc, created}` so the caller can log a self-heal distinctly
 * from a cache hit.
 */
async function ensureDailyQuiz(db, {grade, date, createdBy, actorUid = null}) {
  const ref = db.collection(QUIZZES).doc(quizDocId(grade, date));

  // Read once outside the transaction: the common case by far is "it already
  // exists", and that path should cost one read, not a transaction.
  const existing = await ref.get();
  if (existing.exists) return {doc: {id: existing.id, ...existing.data()}, created: false};

  // The pool queries are the expensive part and must not run inside the
  // transaction — Firestore retries the transaction body on contention, and
  // a whole-bank read per retry is how a self-heal turns into a cost
  // incident. The seed makes doing this outside safe: two builders reading
  // slightly different pools still agree on the five, unless the bank
  // changed mid-flight, and the transaction's create() settles that.
  const [pool, recentDocs] = await Promise.all([
    fetchEligiblePool(db, grade),
    fetchRecentQuizDocs(db, grade, date),
  ]);

  const selection = selectQuestions({pool, grade, date, recentDocs});
  const payload = buildQuizDoc({grade, date, selection, createdBy});

  let created = false;
  const written = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (fresh.exists) return {id: fresh.id, ...fresh.data()};
    tx.create(ref, {
      ...payload,
      poolSize: pool.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    created = true;
    return {id: ref.id, ...payload, poolSize: pool.length};
  });

  if (created) {
    await logEvent(db, {
      type: createdBy === "cron" ? "cron_write" : "selfheal_write",
      grade: String(grade),
      date: String(date),
      docId: ref.id,
      createdBy,
      // The LEARNER's uid is deliberately NOT recorded. What the log needs to
      // answer is "a learner's visit built this, so the cron missed" — which
      // learner is of no operational use, and a child's uid sitting in an
      // admin-readable log that outlives their account is a dangling
      // identifier the deletion path would then have to chase. An ADMIN's uid
      // IS recorded on the admin_* events below: that is an operator action,
      // the same distinction opsMonitorState draws.
      trigger: actorUid ? "learner_visit" : null,
      seed: payload.seed,
      status: payload.status,
      rulesRelaxed: payload.rulesRelaxed,
      poolSize: pool.length,
    });
  }
  return {doc: written, created};
}

/** Parse a bank row's JSON `data` payload. A broken row is dropped, not thrown on. */
function parseBankRow(docSnap) {
  const raw = docSnap.data() || {};
  let question = {};
  try {
    question = raw.data ? JSON.parse(raw.data) : {};
  } catch {
    return null;
  }
  if (!question || typeof question !== "object") return null;
  return {raw, question};
}

/**
 * Fetch the question documents for a list of ids, in the order given.
 *
 * `getAll` rather than a loop of gets: five round trips for a screen a child
 * is waiting on is three too many.
 */
async function fetchBankDocs(db, questionIds) {
  const ids = (questionIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];
  const refs = ids.map((id) => db.collection(BANK).doc(id));
  const snaps = await db.getAll(...refs);
  const byId = new Map();
  for (const s of snaps) if (s.exists) byId.set(s.id, s);
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * The learner-safe payload: id, subject, difficulty, stem, options. No key.
 *
 * A question the bank no longer holds is SKIPPED rather than rendered blank —
 * a five-question quiz that shows four is better than one that shows an empty
 * card, and the count the client displays comes from this array's length.
 */
async function loadLearnerQuestions(db, questionIds) {
  const snaps = await fetchBankDocs(db, questionIds);
  const out = [];
  for (const snap of snaps) {
    const parsed = parseBankRow(snap);
    if (!parsed) continue;
    const {raw, question} = parsed;
    const clean = {...question};
    for (const f of ANSWER_KEY_FIELDS) delete clean[f];
    out.push({
      id: snap.id,
      subject: normalizeSubject(raw.subject),
      difficulty: String(raw.difficulty || "") || null,
      topic: raw.topic || "",
      type: question.type || "mcq",
      text: clean.text || clean.question || "",
      options: Array.isArray(clean.options) ? clean.options.map(String) : [],
      marks: Number(question.marks) > 0 ? Number(question.marks) : 1,
    });
  }
  return out;
}

/**
 * The answer key, for scoring only. Never returned from a callable.
 * `explanation` rides along because the results screen shows it AFTER the
 * attempt is marked — which is the one moment it is safe to send.
 */
async function loadAnswerKey(db, questionIds) {
  const snaps = await fetchBankDocs(db, questionIds);
  const key = new Map();
  for (const snap of snaps) {
    const parsed = parseBankRow(snap);
    if (!parsed) continue;
    key.set(snap.id, {
      type: parsed.question.type || "mcq",
      correctAnswer: parsed.question.correctAnswer,
      explanation: parsed.question.explanation || "",
      options: Array.isArray(parsed.question.options)
        ? parsed.question.options.map(String)
        : [],
    });
  }
  return key;
}

/**
 * §5 — the practice set, and the ONLY thing a learner sees when the bank
 * cannot fill a ranked quiz.
 *
 * It draws from the same approved pool, dropping every rule except the
 * grade: freshness, spread and difficulty are what made the day thin in the
 * first place, so re-applying them here would produce the same emptiness
 * twice. Weakest-subject ordering is a PREFERENCE over that pool, not a
 * filter — a learner with no attempt history simply gets the seeded order.
 *
 * Flagged `ranked: false` all the way to the client, because a practice set
 * that looks ranked is worse than no quiz: the child plays it believing it
 * counts.
 */
async function buildPracticeSet(db, {grade, uid, date}) {
  const pool = await fetchEligiblePool(db, grade);
  if (!pool.length) return {questions: [], subjects: []};

  let weakest = [];
  try {
    weakest = await weakestSubjects(db, {uid});
  } catch (err) {
    // No history is the normal case for a new learner, and an unreadable
    // history is not a reason to withhold practice.
    console.warn("[dailyQuiz] weakest-subject lookup failed:", err?.message || err);
  }

  const rank = (row) => {
    const idx = weakest.indexOf(normalizeSubject(row.subject));
    return idx === -1 ? weakest.length : idx;
  };
  const ordered = [...pool].sort((a, b) => {
    const byWeak = rank(a) - rank(b);
    if (byWeak !== 0) return byWeak;
    return String(a.id).localeCompare(String(b.id));
  });

  // Seeded like the ranked quiz so a learner who reloads gets the same set
  // rather than a fresh five each time.
  const selection = selectQuestions({
    pool: ordered.slice(0, Math.max(DAILY_QUIZ_QUESTION_COUNT * 6, 30)),
    grade,
    date,
    recentDocs: [],
  });
  const questions = await loadLearnerQuestions(db, selection.questionIds);
  return {questions, subjects: [...new Set(questions.map((q) => q.subject))]};
}

/**
 * The learner's two weakest subjects, from their recent daily attempts.
 * Descriptive only — a subject nothing is known about simply does not rank.
 */
async function weakestSubjects(db, {uid, limit = 2}) {
  const snap = await db.collection(ATTEMPTS)
      .where("uid", "==", String(uid))
      .orderBy("date", "desc")
      .limit(30)
      .get();
  const tally = new Map();
  for (const d of snap.docs) {
    for (const r of d.data()?.perQuestion || []) {
      const subject = normalizeSubject(r.subject);
      if (!subject) continue;
      const t = tally.get(subject) || {correct: 0, total: 0};
      t.total += 1;
      if (r.correct) t.correct += 1;
      tally.set(subject, t);
    }
  }
  return [...tally.entries()]
      .filter(([, t]) => t.total >= 3) // too few answers is not evidence
      .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total))
      .slice(0, limit)
      .map(([subject]) => subject);
}

/**
 * Per-grade bank health. `eligible` is the whole approved pool; runway is
 * that ÷ 5. This is what fires weeks before a child ever meets an empty
 * card — the self-heal covers a dead cron, but nothing covers a starved bank
 * except noticing early.
 */
async function bankHealth(db, grades) {
  const rows = [];
  for (const grade of grades) {
    let eligible = 0;
    let error = null;
    try {
      const snap = await db.collection(BANK)
          .where("masterEligible", "==", true)
          .where("grade", "==", String(grade))
          .count()
          .get();
      eligible = snap.data().count || 0;
    } catch (err) {
      // A failed count is reported as unknown, never as zero — "zero" would
      // page the content team about a bank that may be perfectly healthy.
      error = err?.message || "count failed";
    }
    const days = error ? null : runwayFor(eligible);
    rows.push({
      grade: String(grade),
      eligible: error ? null : eligible,
      runwayDays: days,
      level: error ? "unknown" : runwayLevel(days),
      error,
    });
  }
  return rows;
}

/**
 * Record a runway alert at most once per grade per calendar month.
 *
 * The alert is worth sending and not worth sending daily: a starved bank
 * takes weeks of authoring to fix, so a nightly email about it is noise that
 * trains the team to filter the address. Returns true when this call is the
 * one that should actually send.
 */
async function claimRunwayAlert(db, {grade, date, runwayDays}) {
  const period = String(date).slice(0, 7); // YYYY-MM
  const ref = db.collection(ALERTS).doc(`${String(grade)}_${period}`);
  try {
    await ref.create({
      grade: String(grade),
      period,
      runwayDays,
      firstAlertedOn: String(date),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch {
    // create() fails when the doc exists — already alerted this month.
    return false;
  }
}

/**
 * Increment a learner's weekly leaderboard entry.
 *
 * Elapsed time accumulates as the TIE-BREAK between learners on equal
 * points. It is recorded and never shown as a countdown — the games rule.
 */
async function bumpLeaderboard(db, {grade, uid, date, points, elapsedMs, displayName}) {
  const weekId = weekIdFor(date);
  const ref = db.collection(LEADERBOARDS).doc(String(grade))
      .collection("weeks").doc(weekId)
      .collection("entries").doc(String(uid));
  await ref.set({
    uid: String(uid),
    grade: String(grade),
    weekId,
    displayName: displayName || null,
    points: admin.firestore.FieldValue.increment(Number(points) || 0),
    daysPlayed: admin.firestore.FieldValue.increment(1),
    totalElapsedMs: admin.firestore.FieldValue.increment(Number(elapsedMs) || 0),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return weekId;
}

module.exports = {
  QUIZZES,
  ATTEMPTS,
  EVENTS,
  ALERTS,
  BANK,
  LEADERBOARDS,
  ANSWER_KEY_FIELDS,
  quizDocId,
  attemptDocId,
  weekIdFor,
  today,
  shiftDate,
  lusakaNowParts,
  logEvent,
  fetchEligiblePool,
  fetchRecentQuizDocs,
  ensureDailyQuiz,
  loadLearnerQuestions,
  loadAnswerKey,
  buildPracticeSet,
  weakestSubjects,
  bankHealth,
  claimRunwayAlert,
  bumpLeaderboard,
};
