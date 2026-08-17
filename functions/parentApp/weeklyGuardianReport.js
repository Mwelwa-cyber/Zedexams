/**
 * weeklyGuardianReport — the Sunday email, for parent ACCOUNTS.
 *
 * There is already a Sunday digest (`weeklyParentDigest`), and this is
 * not a duplicate of it: that one fans out over `progressShares`, the
 * anonymous link a learner hands to a parent who has no account. This
 * one fans out over `parentLinks`, the real guardian accounts the parent
 * app is built on. The two populations do not overlap — a parent with an
 * account never has a share link for the same child — so a family gets
 * one email, not two.
 *
 * The words are the SAME words the Reports screen renders
 * (parentAppCore.buildWeeklyReport), because a parent who reads the
 * email and then opens the app must not find a different account of the
 * same week.
 *
 * ── Three rules it inherits from the digest that already works ──────
 *
 *   1. A quiet week is NOT emailed. `report.quiet` says there is nothing
 *      to report, and a cheerful message about a week in which nothing
 *      happened is how a weekly email becomes a blocked sender.
 *   2. Idempotent per link. `lastGuardianReportAt` on the link doc, with
 *      a 5-day floor, so a retried run cannot double-send.
 *   3. Capped per run. SMTP rate-limits us naturally; a hard cap keeps
 *      one run inside the timeout rather than half-finishing silently.
 */

const admin = require("firebase-admin");
const {aggregateProgress} = require("../parentPortalShared");
const {buildReportEmail, buildWeeklyReport, toMillis} = require("./parentAppCore");

const WINDOW_DAYS = 7;
const RESEND_FLOOR_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_LINKS_PER_RUN = 200;

// Secrets are read from the environment: the SCHEDULE BUILDER lives in
// functions/index.js, per test:functions-manifest, and it is what binds them.
const SMTP_USER_ENV = "EMAIL_SMTP_USER";
const SMTP_PASSWORD_ENV = "EMAIL_SMTP_PASSWORD";

async function sendMail({to, subject, text}) {
  const senderEmail = String(process.env[SMTP_USER_ENV] || "").trim();
  if (!senderEmail || !to) return false;
  const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
  const crypto = require("crypto");
  const nodemailer = require("nodemailer"); // lazy, matching invoiceGenerator.js
  const transporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {user: senderEmail, pass: process.env[SMTP_PASSWORD_ENV]},
    tls: {minVersion: "TLSv1.2", servername: "mail.privateemail.com"},
  });
  await transporter.sendMail({
    from: `ZedExams <${senderEmail}>`,
    sender: senderEmail,
    to,
    replyTo: senderEmail,
    subject,
    text,
    envelope: {from: senderEmail, to: [to]},
    messageId: `<guardian-report-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });
  return true;
}

/**
 * One link's report. Exported for the manual trigger and so the decision
 * ("send / skip, and why") is inspectable rather than buried in a loop.
 */
async function reportForLink(db, link, now = Date.now()) {
  const lastSent = toMillis(link.lastGuardianReportAt);
  if (lastSent != null && now - lastSent < RESEND_FLOOR_MS) {
    return {sent: false, reason: "already-sent-this-week"};
  }

  const [childSnap, parentSnap, statsSnap, progress] = await Promise.all([
    db.collection("users").doc(link.learnerUid).get(),
    db.collection("users").doc(link.parentUid).get(),
    db.collection("learnerStats").doc(link.learnerUid).get().catch(() => null),
    aggregateProgress(db, link.learnerUid, {windowDays: WINDOW_DAYS}),
  ]);

  const parent = parentSnap.exists ? (parentSnap.data() || {}) : {};
  const to = String(parent.email || "").trim();
  if (!to) return {sent: false, reason: "no-parent-email"};

  const child = childSnap.exists ? (childSnap.data() || {}) : {};
  const stats = statsSnap && statsSnap.exists ? (statsSnap.data() || {}) : {};

  const quizzes = Number(progress.summary?.attempts) || 0;
  const averageScore = Number.isFinite(Number(progress.summary?.averageScore)) ?
    Number(progress.summary.averageScore) : null;
  const strongest = (progress.subjectBreakdown || [])
      .filter((s) => Number.isFinite(Number(s.percent ?? s.averageScore)))
      .map((s) => ({label: s.label || s.subject, percent: Number(s.percent ?? s.averageScore)}))
      .sort((a, b) => b.percent - a.percent);

  const report = buildWeeklyReport({
    childName: child.firstName || (child.displayName || "").split(" ")[0] || child.displayName,
    quizzes,
    notes: 0,
    streak: Number(stats.currentStreak) || 0,
    averageScore,
    strongest,
    weakTopics: progress.weakTopics || [],
  });

  // Nothing happened; say nothing. See rule 1 in the header.
  if (report.quiet) return {sent: false, reason: "quiet-week"};

  const mail = buildReportEmail({
    childName: child.displayName || child.firstName,
    report,
    quizzes,
    notes: 0,
  });

  await sendMail({to, ...mail});
  return {sent: true, to};
}

async function runWeeklyGuardianReport() {
  const db = admin.firestore();
  const now = Date.now();

  const snap = await db.collection("parentLinks").limit(MAX_LINKS_PER_RUN).get();
  let sent = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const link = {id: doc.id, ...doc.data()};
    try {
      const result = await reportForLink(db, link, now);
      if (result.sent) {
        sent += 1;
        await doc.ref.set({
          lastGuardianReportAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
      } else {
        skipped += 1;
      }
    } catch (err) {
      // One family's failure must not end the run for everybody else.
      skipped += 1;
      console.error("[weeklyGuardianReport] link failed", doc.id, err?.message || err);
    }
  }

  console.log(`[weeklyGuardianReport] sent=${sent} skipped=${skipped} of ${snap.size}`);
}

module.exports = {
  RESEND_FLOOR_MS,
  reportForLink,
  runWeeklyGuardianReport,
};
