/**
 * Parent portal — share-link infrastructure (audit A3 PR 1).
 *
 * Three callables:
 *
 *   createProgressShare({ parentEmail?, parentPhone?, parentDisplayName? })
 *     - Authenticated learner self-issues a share. Mints a 12-char
 *       token, sets a 90-day TTL, and returns { token, url }.
 *
 *   revokeProgressShare({ token })
 *     - Authenticated learner — sets revokedAt on their own share.
 *
 *   getProgressShare({ token })
 *     - PUBLIC (no auth) — admin SDK reads progressShares/{token},
 *       validates not revoked / not expired, then aggregates a
 *       parent-friendly summary of the learner's last 30 days
 *       (recent scores, subject breakdown, streak, current grade).
 *     - Bumps viewCount + lastViewedAt on the share doc.
 *     - Returns the rendered shape so the public /parent/:token
 *       route can render without doing N+1 reads through admin SDK.
 *
 * Note on `getProgressShare` being public: this matches the existing
 * `/shares/{token}` pattern — the token IS the permission. Tokens are
 * 12 chars from a 32-char alphabet (~10^18 combinations) so brute
 * forcing is infeasible.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const REGION = "us-central1";
const TOKEN_LENGTH = 12;
const SHARE_TTL_DAYS = 90;
const STATS_WINDOW_DAYS = 30;
const MAX_RECENT_RESULTS = 12;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Same alphabet as class invite codes — readable + voice-friendly,
// though parent share tokens are link-only so this is just defensive.
const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomToken() {
  const bytes = require("node:crypto").randomBytes(TOKEN_LENGTH);
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i += 1) {
    token += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return token;
}

async function mintUniqueToken(db) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = randomToken();
    const snap = await db.collection("progressShares").doc(token).get();
    if (!snap.exists) return token;
  }
  throw new HttpsError("internal", "Could not mint a unique share token. Please try again.");
}

const createProgressShare = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const parentEmail = request.data?.parentEmail
      ? String(request.data.parentEmail).trim().toLowerCase().slice(0, 200)
      : null;
  const parentPhone = request.data?.parentPhone
      ? String(request.data.parentPhone).trim().slice(0, 30)
      : null;
  const parentDisplayName = request.data?.parentDisplayName
      ? String(request.data.parentDisplayName).trim().slice(0, 80)
      : null;

  const db = admin.firestore();
  const token = await mintUniqueToken(db);
  const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + SHARE_TTL_DAYS * ONE_DAY_MS,
  );

  await db.collection("progressShares").doc(token).set({
    learnerUid: uid,
    createdBy: uid,
    parentEmail,
    parentPhone,
    parentDisplayName,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    revokedAt: null,
    lastViewedAt: null,
    viewCount: 0,
  });

  return {
    token,
    expiresAt: expiresAt.toMillis(),
    url: `https://zedexams.com/parent/${token}`,
  };
});

const revokeProgressShare = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const token = String(request.data?.token || "").trim().toUpperCase();
  if (!token) throw new HttpsError("invalid-argument", "token is required.");

  const db = admin.firestore();
  const ref = db.collection("progressShares").doc(token);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Share not found.");
  const data = snap.data() || {};
  if (data.learnerUid !== uid) {
    throw new HttpsError("permission-denied", "You can only revoke your own share.");
  }
  await ref.update({
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true};
});

/**
 * Aggregate the learner's last 30 days of activity into a parent-
 * friendly shape. Mirrors getClassStats's bounded-read approach.
 */
async function aggregateProgress(db, learnerUid) {
  const now = Date.now();
  const sinceTs = admin.firestore.Timestamp.fromMillis(now - STATS_WINDOW_DAYS * ONE_DAY_MS);

  // results in window
  const resultsSnap = await db.collection("results")
      .where("userId", "==", learnerUid)
      .where("completedAt", ">=", sinceTs)
      .orderBy("completedAt", "desc")
      .get()
      .catch((err) => {
        console.warn("[parentPortal] results read failed", err);
        return null;
      });
  const results = resultsSnap ? resultsSnap.docs.map((d) => d.data()) : [];

  let percentageSum = 0;
  let percentageCount = 0;
  const subjectBuckets = new Map();
  const dayKeys = new Set(); // for streak calculation
  for (const r of results) {
    if (typeof r.percentage === "number") {
      percentageSum += r.percentage;
      percentageCount += 1;
    }
    if (r.subject) {
      const b = subjectBuckets.get(r.subject) || {count: 0, sum: 0};
      b.count += 1;
      if (typeof r.percentage === "number") b.sum += r.percentage;
      subjectBuckets.set(r.subject, b);
    }
    const ms = r.completedAt?.toMillis ? r.completedAt.toMillis() : 0;
    if (ms > 0) {
      const d = new Date(ms);
      d.setUTCHours(0, 0, 0, 0);
      dayKeys.add(d.getTime());
    }
  }

  // Streak — count back from today (or yesterday) for consecutive days
  // with at least one result.
  let streak = 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let cursor = today.getTime();
  if (!dayKeys.has(cursor)) {
    cursor -= ONE_DAY_MS;
  }
  while (dayKeys.has(cursor)) {
    streak += 1;
    cursor -= ONE_DAY_MS;
  }

  return {
    summary: {
      totalAttempts: results.length,
      averagePercentage: percentageCount > 0
          ? Math.round(percentageSum / percentageCount)
          : null,
      currentStreak: streak,
      windowDays: STATS_WINDOW_DAYS,
    },
    subjectBreakdown: [...subjectBuckets.entries()]
        .map(([subject, b]) => ({
          subject,
          count: b.count,
          averagePercentage: b.count > 0 ? Math.round(b.sum / b.count) : null,
        }))
        .sort((a, b) => b.count - a.count),
    recentResults: results.slice(0, MAX_RECENT_RESULTS).map((r) => ({
      quizId: r.quizId || null,
      quizTitle: r.quizTitle || r.title || null,
      subject: r.subject || null,
      grade: r.grade || null,
      percentage: typeof r.percentage === "number" ? r.percentage : null,
      score: typeof r.score === "number" ? r.score : null,
      totalMarks: typeof r.totalMarks === "number" ? r.totalMarks : null,
      completedAtMs: r.completedAt?.toMillis ? r.completedAt.toMillis() : null,
    })),
  };
}

const getProgressShare = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  // PUBLIC — no auth required. The token IS the permission.
  const token = String(request.data?.token || "").trim().toUpperCase();
  if (!token || token.length < 6 || token.length > 32) {
    throw new HttpsError("invalid-argument", "A share token is required.");
  }

  const db = admin.firestore();
  const ref = db.collection("progressShares").doc(token);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "This progress link is invalid.");
  }
  const share = snap.data() || {};
  if (share.revokedAt) {
    throw new HttpsError("failed-precondition", "This progress link has been revoked.");
  }
  if (share.expiresAt && share.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "This progress link has expired.");
  }

  // Best-effort: bump view tally so the learner can see how often
  // their parent has checked. Doesn't block on failure.
  ref.update({
    viewCount: admin.firestore.FieldValue.increment(1),
    lastViewedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[parentPortal] view bump failed", err));

  // Learner profile — display name + grade. Admin SDK bypasses
  // user-doc read rules (which are normally self+admin only).
  const learnerSnap = await db.collection("users").doc(share.learnerUid).get();
  const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};

  const stats = await aggregateProgress(db, share.learnerUid);

  return {
    learnerDisplayName: learner.displayName || "your learner",
    learnerGrade: learner.grade || null,
    learnerSchool: learner.school || null,
    parentDisplayName: share.parentDisplayName || null,
    summary: stats.summary,
    subjectBreakdown: stats.subjectBreakdown,
    recentResults: stats.recentResults,
    sharedAtMs: share.createdAt?.toMillis ? share.createdAt.toMillis() : null,
    expiresAtMs: share.expiresAt?.toMillis ? share.expiresAt.toMillis() : null,
  };
});

module.exports = {
  createProgressShare,
  revokeProgressShare,
  getProgressShare,
};
