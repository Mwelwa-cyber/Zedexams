"use strict";

/**
 * runTeacherTrialExpiryReminder — one email, once, before a teacher's free
 * trial ends.
 *
 * Only the BODY lives here; the trigger (`onSchedule({schedule: "0 8 * * *",
 * region: "us-central1", secrets: [emailSmtpUser, emailSmtpPassword], ...},
 * ...)`) is built in functions/index.js, reusing the emailSmtpUser /
 * emailSmtpPassword secret params already declared there — see the
 * `test:functions-manifest` comment on why the builder+options stay in
 * index.js rather than being re-exported whole from here.
 *
 * Runs daily. Every trial is checked against isTrialReminderDue()
 * (teacherTrialCore.js): due when teacherTrialEndsAt falls inside the next
 * REMINDER_WINDOW_HOURS and no reminder has been sent yet. A 48h window on a
 * daily cron means every trial is caught by exactly one run, even one that
 * lands right before the boundary — narrower would risk a trial ending
 * inside the gap between two runs with nothing ever sent.
 *
 * The query is a single equality filter (teacherPlan == 'trial'), which
 * needs no composite index — Firestore's automatic single-field index
 * covers it. The trial population is small by construction (a 7-day window
 * of recent teacher signups), so filtering the window + already-sent state
 * in memory costs nothing and avoids a firestore.indexes.json change for a
 * query this narrow.
 */

const admin = require("firebase-admin");
// nodemailer is required lazily at its use site — see invoiceGenerator.js.

const {isTrialReminderDue, buildTrialReminderEmail} = require("./teacherTrialCore");

// Defensive cap — the trial population is expected to be tiny, but a stuck
// reminder flag (or a burst of signups) must not turn one run into an
// unbounded scan + send loop against the timeout.
const MAX_PER_RUN = 500;

let cachedTransporter = null;
function getTransporter(senderEmail, senderPassword) {
  if (cachedTransporter) return cachedTransporter;
  if (!senderEmail || !senderPassword) return null;
  const nodemailer = require("nodemailer");
  cachedTransporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {user: senderEmail, pass: senderPassword},
    tls: {minVersion: "TLSv1.2", servername: "mail.privateemail.com"},
  });
  return cachedTransporter;
}

/**
 * @param {{senderEmail: string, senderPassword: string, now?: Date}} deps
 * @return {Promise<{checked: number, sent: number, skipped: number, failed: number}>}
 */
async function runTeacherTrialExpiryReminder({senderEmail, senderPassword, now = new Date()}) {
  const summary = {checked: 0, sent: 0, skipped: 0, failed: 0};
  const db = admin.firestore();

  const snap = await db.collection("users")
      .where("teacherPlan", "==", "trial")
      .limit(MAX_PER_RUN)
      .get();

  if (snap.empty) return summary;

  const transporter = getTransporter(senderEmail, senderPassword);

  for (const doc of snap.docs) {
    summary.checked += 1;
    const user = doc.data() || {};

    const endsAt = user.teacherTrialEndsAt;
    const endsAtMs = endsAt && typeof endsAt.toDate === "function"
      ? endsAt.toDate().getTime()
      : null;
    const sentAt = user.teacherTrialReminderSentAt;
    const sentAtMs = sentAt && typeof sentAt.toDate === "function"
      ? sentAt.toDate().getTime()
      : null;

    const due = isTrialReminderDue({
      teacherPlan: user.teacherPlan,
      teacherTrialEndsAtMs: endsAtMs,
      teacherTrialReminderSentAtMs: sentAtMs,
    }, now);

    if (!due) {
      summary.skipped += 1;
      continue;
    }

    const email = typeof user.email === "string" ? user.email.trim() : "";
    if (!email || !transporter) {
      // No address to send to, or SMTP not configured — skip rather than
      // fail; a missing reminder is never worse than a crashed run that
      // reminds nobody for the rest of the batch.
      summary.skipped += 1;
      continue;
    }

    const {subject, text, html} = buildTrialReminderEmail({
      displayName: user.displayName,
      endsAtMs,
      now,
    });

    try {
      await transporter.sendMail({
        from: `"ZedExams" <${senderEmail}>`,
        to: email,
        subject,
        text,
        html,
      });
      // Stamp ONLY on success — a failed send must be retried by tomorrow's
      // run, not silently marked done (mirrors sendExpiryReminders' cooldown
      // stamp in messagingHandlers.js).
      await doc.ref.set({
        teacherTrialReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      summary.sent += 1;
    } catch (err) {
      console.warn("[teacherTrialExpiryReminder] send failed", doc.id, err?.message);
      summary.failed += 1;
    }
  }

  return summary;
}

/**
 * Builds the onSchedule handler, given the SAME emailSmtpUser /
 * emailSmtpPassword secret param instances index.js binds via `secrets:` —
 * `.value()` only resolves at runtime for the exact instance the trigger was
 * bound with, so this takes them as an explicit dependency rather than
 * declaring its own (which would silently create a second, unbound secret).
 *
 * @param {{emailSmtpUser: import('firebase-functions/params').SecretParam,
 *           emailSmtpPassword: import('firebase-functions/params').SecretParam}} deps
 */
function buildTeacherTrialExpiryReminderHandler({emailSmtpUser, emailSmtpPassword}) {
  return async () => {
    const summary = await runTeacherTrialExpiryReminder({
      senderEmail: emailSmtpUser.value() || process.env.EMAIL_SMTP_USER || "",
      senderPassword: emailSmtpPassword.value() || process.env.EMAIL_SMTP_PASSWORD || "",
    });
    console.log("[teacherTrialExpiryReminder] done", summary);
  };
}

module.exports = {runTeacherTrialExpiryReminder, buildTeacherTrialExpiryReminderHandler};
