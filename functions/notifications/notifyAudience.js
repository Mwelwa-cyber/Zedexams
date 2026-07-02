/**
 * Audience fan-out helpers for the Smart Notification System.
 *
 * notifyAdmins() is the in-app complement to the existing email ops alerts
 * (opsAlert.js) — it drops an operational notification into every admin's
 * notification centre so the team sees registrations, payments, bug reports
 * and incidents without leaving the app.
 *
 * The pure message builder (buildAdminNotification) is split out so the
 * title/body/priority mapping is unit-testable with no firebase-admin dep.
 */

const { createNotification } = require("./createNotification");

const ADMIN_ROLES = ["admin", "superAdmin"];
// Admins are a tiny set; cap defensively so a misconfigured role field can't
// turn a fan-out into a huge scan.
const MAX_ADMINS = 50;

/**
 * Map an admin-event kind + data to a notification payload. Pure.
 * @returns {{type, title, body, priority, icon, action, dedupeKey}}
 */
function buildAdminNotification(kind, data = {}) {
  const d = data || {};
  switch (kind) {
    case "new_teacher":
      return {
        type: "admin_new_teacher",
        title: "New teacher registered",
        body: `${d.name || d.email || "A teacher"} just created a teacher account.`,
        priority: "low",
        icon: "user-circle",
        action: { label: "View learners", url: "/admin/learners" },
        dedupeKey: d.uid ? `admin-new-teacher-${d.uid}` : null,
      };
    case "new_learner":
      return {
        type: "admin_new_learner",
        title: "New learner registered",
        body: `${d.name || d.email || "A learner"} just signed up${d.grade ? ` (Grade ${d.grade})` : ""}.`,
        priority: "low",
        icon: "user-circle",
        action: { label: "View learners", url: "/admin/learners" },
        dedupeKey: d.uid ? `admin-new-learner-${d.uid}` : null,
      };
    case "payment_received":
      return {
        type: "admin_payment_received",
        title: "Payment received",
        body: `${d.amount ? `${d.amount} ` : ""}subscription payment confirmed${d.email ? ` from ${d.email}` : ""}.`,
        priority: "medium",
        icon: "credit-card",
        action: { label: "View payments", url: "/admin/payments" },
        dedupeKey: d.paymentId ? `admin-payment-ok-${d.paymentId}` : null,
      };
    case "payment_failed":
      return {
        type: "admin_payment_failed",
        title: "Payment failed",
        body: `A subscription payment failed${d.email ? ` for ${d.email}` : ""}${d.reason ? `: ${d.reason}` : ""}.`,
        priority: "medium",
        icon: "credit-card",
        action: { label: "View payments", url: "/admin/payments" },
        dedupeKey: d.paymentId ? `admin-payment-fail-${d.paymentId}` : null,
      };
    case "new_feedback":
      return {
        type: "admin_new_feedback",
        title: d.feedbackType === "bug" ? "New bug report" : "New feedback",
        body: `${d.role || "A user"} submitted ${d.feedbackType || "feedback"}: ${(d.message || "").slice(0, 120)}`,
        priority: d.feedbackType === "bug" ? "high" : "medium",
        icon: "megaphone",
        action: { label: "Open feedback", url: "/admin/feedback" },
        dedupeKey: d.feedbackId ? `admin-feedback-${d.feedbackId}` : null,
      };
    case "incident":
      return {
        type: "admin_incident",
        title: d.title || "System alert",
        body: (d.body || "An operational alert was raised.").slice(0, 500),
        priority: "high",
        icon: "cog",
        action: { label: "Open agents", url: "/admin/agents" },
        dedupeKey: d.dedupeKey || null,
      };
    default:
      return {
        type: "admin_notice",
        title: d.title || "Admin notice",
        body: (d.body || "").slice(0, 500),
        priority: "medium",
        icon: "cog",
        action: d.action || null,
        dedupeKey: d.dedupeKey || null,
      };
  }
}

/** Resolve the uids of every admin / superAdmin (small set). */
async function resolveAdminUids(db) {
  try {
    const snap = await db
        .collection("users")
        .where("role", "in", ADMIN_ROLES)
        .limit(MAX_ADMINS)
        .get();
    return snap.docs.map((d) => d.id);
  } catch (err) {
    console.warn("[notifyAdmins] admin lookup failed", (err && err.message) || err);
    return [];
  }
}

/**
 * Deliver an operational notification to every admin's in-app centre.
 * Best-effort — never throws back to the caller. `category` is always 'system'
 * so it is force-written in-app (admins can still gate push).
 */
async function notifyAdmins(kind, data = {}, opts = {}) {
  const admin = require("firebase-admin");
  const db = opts.db || admin.firestore();
  const uids = await resolveAdminUids(db);
  if (uids.length === 0) return { delivered: 0 };
  const payload = buildAdminNotification(kind, data);
  const results = await Promise.allSettled(
      uids.map((uid) =>
        createNotification({
          uid,
          category: "system",
          type: payload.type,
          title: payload.title,
          body: payload.body,
          priority: payload.priority,
          icon: payload.icon,
          action: payload.action,
          dedupeKey: payload.dedupeKey,
          source: `admin:${kind}`,
        }),
      ),
  );
  return {
    delivered: results.filter(
        (r) => r.status === "fulfilled" && r.value && r.value.written,
    ).length,
  };
}

module.exports = { buildAdminNotification, resolveAdminUids, notifyAdmins, ADMIN_ROLES };
