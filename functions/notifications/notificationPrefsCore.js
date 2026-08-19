/**
 * Pure notification-preference + gating logic for the Smart Notification System.
 *
 * NO firebase-admin / firebase-functions imports — this module is loadable and
 * unit-testable under plain `node` (the repo's `*Core.js` split convention, see
 * functions/metaWhatsAppCore.js). All the "should this notification go out, and
 * on which channel" decisions live here so they can be tested without Firestore.
 *
 * Channel model:
 *   • in-app  — a doc written to notifications/{uid}/items so it shows in the
 *               Notification Center. Persists across logout.
 *   • push    — an FCM web-push to the user's devices (best-effort, transient).
 *
 * Critical categories (payments / account / system) are ALWAYS written in-app —
 * a learner must not be able to hide "payment failed" or "password changed" from
 * their own record. Their category toggle gates PUSH only. Every other category
 * is fully opt-out (master switch + category switch + in-app channel).
 */

// Canonical category keys. Kept in sync with the client master-switch list in
// src/components/settings/zedexams-settings.jsx and the rule/index work.
const CATEGORIES = [
  "learning",
  "lessonPlans",
  "assessments",
  "payments",
  "account",
  "system",
  "announcements",
  // Guardian-only. The Sunday family report is the one thing this
  // product sends on a schedule to somebody who did not ask for it that
  // week, and until this category existed there was no switch behind it
  // at all — /family/account told a parent they could turn it off in
  // Alerts, and Alerts had nothing to turn off. A promise in the UI with
  // no field behind it is worse than no promise: the parent believes
  // they opted out and the email keeps arriving.
  "guardianReports",
];

// In-app is force-on for these regardless of the master / category / channel
// switches; only their PUSH is user-gated.
const ALWAYS_IN_APP_CATEGORIES = ["payments", "account", "system"];

// Default heroicon key per category (resolved to a component client-side).
const DEFAULT_CATEGORY_ICON = {
  learning: "academic-cap",
  lessonPlans: "document-text",
  assessments: "clipboard-check",
  payments: "credit-card",
  account: "user-circle",
  system: "cog",
  announcements: "megaphone",
  guardianReports: "chart-bar",
};

// Zambia is UTC+2 year-round (no DST). Quiet-hours are expressed in the user's
// local civil time; we evaluate them against Africa/Lusaka rather than UTC so a
// "22:00–06:00" window means what the learner expects.
const LUSAKA_OFFSET_MIN = 120;

function isCategory(category) {
  return CATEGORIES.includes(category);
}

function defaultIconFor(category) {
  return DEFAULT_CATEGORY_ICON[category] || "bell";
}

function isCriticalCategory(category) {
  return ALWAYS_IN_APP_CATEGORIES.includes(category);
}

// Parse "HH:MM" → minutes since midnight, or null when malformed.
function parseHhmm(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Minutes-since-midnight in Africa/Lusaka for a given Date (defaults to now).
function lusakaMinutesOfDay(now = new Date()) {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return ((utcMinutes + LUSAKA_OFFSET_MIN) % 1440 + 1440) % 1440;
}

/**
 * Coerce an arbitrary (possibly legacy / partial / undefined) stored
 * notificationPrefs object into the full server shape with safe defaults.
 * Defaults are "everything on" so a user who never touched settings still
 * receives notifications. Legacy flat booleans (examReminders, resultsReleased,
 * dailyStreak, announcements) are honoured where they map to a category so an
 * existing opt-out isn't silently re-enabled.
 */
function normalizeServerPrefs(input) {
  const p = input && typeof input === "object" ? input : {};
  const cats = p.categories && typeof p.categories === "object" ? p.categories : {};
  const ch = p.channels && typeof p.channels === "object" ? p.channels : {};
  const qh = p.quietHours && typeof p.quietHours === "object" ? p.quietHours : {};

  // Legacy → category fallback (only consulted when the new key is absent).
  const legacyLearning =
    p.dailyStreak === false && p.examReminders === false ? false : undefined;
  const legacyAssessments = p.resultsReleased === false ? false : undefined;
  const legacyAnnouncements = p.announcements === false ? false : undefined;

  const pick = (val, legacy) =>
    typeof val === "boolean" ? val : typeof legacy === "boolean" ? legacy : true;

  return {
    master: typeof p.master === "boolean" ? p.master : true,
    categories: {
      learning: pick(cats.learning, legacyLearning),
      lessonPlans: pick(cats.lessonPlans),
      assessments: pick(cats.assessments, legacyAssessments),
      payments: pick(cats.payments),
      account: pick(cats.account),
      system: pick(cats.system),
      announcements: pick(cats.announcements, legacyAnnouncements),
      guardianReports: pick(cats.guardianReports),
    },
    channels: {
      push: typeof ch.push === "boolean" ? ch.push : true,
      inApp: typeof ch.inApp === "boolean" ? ch.inApp : true,
      // Email is a real delivery channel (the Sunday family report, and
      // whatever else grows an email path), so it is normalized here
      // rather than being decided per sender. Default on, matching the
      // other two: an existing profile that predates the field has not
      // opted out of anything.
      email: typeof ch.email === "boolean" ? ch.email : true,
    },
    quietHours: {
      enabled: qh.enabled === true,
      start: typeof qh.start === "string" ? qh.start : "22:00",
      end: typeof qh.end === "string" ? qh.end : "06:00",
    },
    muteUntil: Number.isFinite(Number(p.muteUntil)) ? Number(p.muteUntil) : null,
  };
}

/**
 * May we EMAIL this user about this category?
 *
 * Deliberately stricter than `categoryEnabled`: an email lands in an
 * inbox the person did not open for us and cannot dismiss with a swipe,
 * so it needs the channel switch as well as the category one. There is
 * no critical-category override here — nothing this product emails on a
 * schedule is something a recipient may not decline. A transactional
 * message tied to an action the user just took (a receipt, a password
 * reset) is not routed through preferences at all and never was.
 */
function emailEnabled(prefs, category) {
  const np = normalizeServerPrefs(prefs);
  if (!np.master) return false;
  if (np.channels.email === false) return false;
  if (category && isCategory(category)) return np.categories[category] !== false;
  return true;
}

// Is the user's category switch on? (master + the specific category)
function categoryEnabled(prefs, category) {
  const np = normalizeServerPrefs(prefs);
  if (!np.master) return false;
  return np.categories[category] !== false;
}

/**
 * Should an in-app doc be written? Critical categories: always yes. Otherwise
 * the master switch, the category switch and the in-app channel must all be on.
 */
function shouldWriteInApp(prefs, category) {
  if (isCriticalCategory(category)) return true;
  const np = normalizeServerPrefs(prefs);
  if (!np.channels.inApp) return false;
  return categoryEnabled(np, category);
}

// Is `now` inside the user's quiet-hours window? Handles wrap-around windows
// (e.g. 22:00 → 06:00 spanning midnight). Disabled or malformed → false.
function isWithinQuietHours(prefs, now = new Date()) {
  const np = normalizeServerPrefs(prefs);
  if (!np.quietHours.enabled) return false;
  const start = parseHhmm(np.quietHours.start);
  const end = parseHhmm(np.quietHours.end);
  if (start == null || end == null || start === end) return false;
  const t = lusakaMinutesOfDay(now);
  if (start < end) return t >= start && t < end; // same-day window
  return t >= start || t < end; // wraps past midnight
}

// Is the user inside a temporary mute window?
function isMuted(prefs, now = new Date()) {
  const np = normalizeServerPrefs(prefs);
  if (np.muteUntil == null) return false;
  const ts = now instanceof Date ? now.getTime() : Number(now);
  return ts < np.muteUntil;
}

/**
 * Should an FCM push be sent for this category right now? Push requires:
 * master on, push channel on, category on, AND not in quiet hours / muted.
 * (Critical categories still respect the push gates — only their in-app write
 * is forced.)
 */
function shouldSendPush(prefs, category, now = new Date()) {
  const np = normalizeServerPrefs(prefs);
  if (!np.master) return false;
  if (!np.channels.push) return false;
  if (np.categories[category] === false) return false;
  if (isWithinQuietHours(np, now)) return false;
  if (isMuted(np, now)) return false;
  return true;
}

/**
 * A stable, per-topic notification tag. Passing the same `tag` on the webpush
 * notification makes a fresh push REPLACE the previous one of that topic in the
 * OS tray instead of stacking beside it. Un-collapsed piles of notifications
 * from one origin are exactly the "Possible spam (N)" signal Chrome's abusive-
 * notification heuristic keys on, so every push we send carries one. We tag by
 * the fine-grained `type` when present (a re-sent streak reminder collapses onto
 * the previous one) and fall back to `category` so distinct topics still surface
 * separately. Always prefixed so it can't collide with any other origin's tags.
 */
function notificationTag({ tag, type, category } = {}) {
  const key = String(tag || type || category || "general")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .slice(0, 60);
  return `zedexams-${key}`;
}

/**
 * Build the FCM message body (sans `tokens`, which the sender fills in),
 * mirroring the webpush shape used by functions/dailyReminders.js so the
 * service worker (public/firebase-messaging-sw.js) renders it consistently.
 *
 * `category` / `type` (or an explicit `tag`) drive the collapse tag — see
 * notificationTag(). Omitting them still yields a valid ("general") tag so a
 * payload is never sent un-collapsed.
 */
function buildFcmPayload(
    { title, body, action, category, type, tag } = {},
    origin = "https://zedexams.com",
) {
  const link = resolveActionLink(action, origin);
  const safeTitle = String(title || "ZedExams");
  const safeBody = String(body || "");
  const collapseTag = notificationTag({ tag, type, category });
  return {
    notification: {
      title: safeTitle,
      body: safeBody,
    },
    // Web (service-worker) delivery: link + icon/badge for the rendered toast.
    // `tag` collapses same-topic pushes; `renotify` is left off (default false)
    // so a silent replacement doesn't re-buzz the device.
    webpush: {
      fcmOptions: { link },
      notification: {
        icon: "/zedexams-logo.png?v=4",
        badge: "/zedexams-logo.png?v=4",
        tag: collapseTag,
      },
    },
    // Native (Android) delivery. `data` values MUST be strings for the Admin
    // SDK; the tap target rides along as `link` so a native tap can deep-link
    // (the OS renders the `notification` block above automatically when the app
    // is backgrounded/killed). `priority: high` keeps reminders timely.
    // `collapseKey` is the native equivalent of the web `tag`.
    android: {
      priority: "high",
      collapseKey: collapseTag,
    },
    data: {
      link,
      title: safeTitle,
      body: safeBody,
      tag: collapseTag,
    },
  };
}

// An action.url is an in-app route ("/dashboard"); turn it into an absolute URL
// for the push notification tap target. Absolute URLs pass through unchanged.
function resolveActionLink(action, origin = "https://zedexams.com") {
  const url = action && typeof action.url === "string" ? action.url.trim() : "";
  if (!url) return `${origin}/dashboard`;
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

module.exports = {
  CATEGORIES,
  ALWAYS_IN_APP_CATEGORIES,
  DEFAULT_CATEGORY_ICON,
  LUSAKA_OFFSET_MIN,
  isCategory,
  isCriticalCategory,
  defaultIconFor,
  parseHhmm,
  lusakaMinutesOfDay,
  normalizeServerPrefs,
  categoryEnabled,
  emailEnabled,
  shouldWriteInApp,
  isWithinQuietHours,
  isMuted,
  shouldSendPush,
  buildFcmPayload,
  notificationTag,
  resolveActionLink,
};
