/**
 * autoPickDailyExams — scheduled job that promotes one short-quiz per grade
 * into the day's Daily Exam slot, and demotes yesterday's pick back to
 * Practice. Long quizzes (questionCount >= 50) are exam-only and are never
 * auto-picked here; admins still pin those manually from Manage Content.
 *
 * Daily flow (per grade in [4, 5, 6, 7]):
 *   1. Demote: any quiz with quizType == "daily_exam" whose
 *      dailyExamDate < today is moved back to quizType "practice"
 *      (isDailyExam=false, dailyExamDate=null). lastDailyExamDate is kept
 *      so the rotation stays fair.
 *   2. Skip if a daily exam for today already exists in this grade — the
 *      admin's manual pick wins.
 *   3. Pool: published quizzes for this grade with questionCount < 50 and
 *      quizType in ("practice", null). Long quizzes are never picked.
 *   4. Pick the candidate with the oldest lastDailyExamDate (or never used),
 *      tie-break by createdAt asc, then by id. Promote it: quizType
 *      "daily_exam", isDailyExam=true, dailyExamDate=today,
 *      lastDailyExamDate=today.
 *
 * The function never deletes anything; it only flips fields. If there are
 * no eligible quizzes for a grade (all of them are long, or the library
 * is empty), the grade is skipped silently.
 */

const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

const GRADES = ["4", "5", "6", "7"];
const EXAM_QUESTION_THRESHOLD = 50;

function todayString(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function compareForRotation(a, b) {
  const lastA = a.data().lastDailyExamDate || "";
  const lastB = b.data().lastDailyExamDate || "";
  if (lastA !== lastB) return lastA < lastB ? -1 : 1;
  const createdA = a.data().createdAt?.toMillis?.() || 0;
  const createdB = b.data().createdAt?.toMillis?.() || 0;
  if (createdA !== createdB) return createdA - createdB;
  return a.id < b.id ? -1 : 1;
}

async function demoteYesterdayPicks(db, grade, today) {
  const snap = await db.collection("quizzes")
    .where("grade", "==", grade)
    .where("quizType", "==", "daily_exam")
    .get();

  const stale = snap.docs.filter((d) => {
    const date = d.data().dailyExamDate;
    return !date || date < today;
  });

  if (stale.length === 0) return 0;

  const batch = db.batch();
  stale.forEach((doc) => {
    batch.update(doc.ref, {
      quizType: "practice",
      isDailyExam: false,
      dailyExamDate: null,
    });
  });
  await batch.commit();
  return stale.length;
}

async function findExistingPickForToday(db, grade, today) {
  const snap = await db.collection("quizzes")
    .where("grade", "==", grade)
    .where("quizType", "==", "daily_exam")
    .where("dailyExamDate", "==", today)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function findCandidatePool(db, grade) {
  const snap = await db.collection("quizzes")
    .where("grade", "==", grade)
    .where("isPublished", "==", true)
    .get();

  return snap.docs.filter((doc) => {
    const data = doc.data();
    const count = Number(data.questionCount) || 0;
    if (count <= 0 || count >= EXAM_QUESTION_THRESHOLD) return false;
    if (data.quizType === "daily_exam") return false; // skip already-pinned
    if (data.examOnly === true) return false;
    return true;
  });
}

async function promotePickForGrade(db, grade, today) {
  const existing = await findExistingPickForToday(db, grade, today);
  if (existing) {
    return {grade, status: "already_pinned", quizId: existing.id};
  }

  const candidates = await findCandidatePool(db, grade);
  if (candidates.length === 0) {
    return {grade, status: "no_candidates"};
  }

  candidates.sort(compareForRotation);
  const pick = candidates[0];

  await pick.ref.update({
    quizType: "daily_exam",
    isDailyExam: true,
    dailyExamDate: today,
    lastDailyExamDate: today,
  });

  return {grade, status: "promoted", quizId: pick.id, title: pick.data().title};
}

async function runAutoPick({today = todayString()} = {}) {
  const db = admin.firestore();
  const summary = {date: today, grades: []};

  for (const grade of GRADES) {
    try {
      const demoted = await demoteYesterdayPicks(db, grade, today);
      const result = await promotePickForGrade(db, grade, today);
      summary.grades.push({...result, demoted});
    } catch (error) {
      summary.grades.push({
        grade,
        status: "error",
        message: error?.message || String(error),
      });
      console.error("autoPickDailyExams grade error", {grade, error});
    }
  }

  console.log("autoPickDailyExams summary", JSON.stringify(summary));
  return summary;
}

const autoPickDailyExams = onSchedule(
  {
    // 05:00 Africa/Lusaka → just before learners start their day. Lusaka is
    // UTC+02:00 with no DST, so the timezone option keeps this stable.
    schedule: "every day 05:00",
    timeZone: "Africa/Lusaka",
    region: "us-central1",
    timeoutSeconds: 300,
  },
  async () => {
    await runAutoPick();
  },
);

module.exports = {
  autoPickDailyExams,
  runAutoPick,
  EXAM_QUESTION_THRESHOLD,
};
