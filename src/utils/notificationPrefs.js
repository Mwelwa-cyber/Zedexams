// Notification preferences — shared pure helpers (no Firebase).
//
// Extracted from features/accountSettings/pages/zedexams-settings.jsx so the learner
// settings page and the Teacher Settings → Notifications panel share one
// normalizer + category list. Order + labels mirror
// functions/notifications/notificationPrefsCore.js (server) and
// components/notifications/notificationIcons.js (client).
//
// `critical: true` categories are always delivered in-app (a learner cannot
// hide "payment failed" / "password changed"); their toggle gates PUSH only.

export const NOTIFICATION_CATEGORY_META = [
  { key: 'learning',      label: 'Learning',      hint: 'Quizzes, results, streaks, daily practice.' },
  { key: 'lessonPlans',   label: 'Lesson Plans',  hint: 'Teacher tools and generation updates.' },
  { key: 'assessments',   label: 'Assessments',   hint: 'Assigned work and graded results.' },
  { key: 'payments',      label: 'Payments',      hint: 'Receipts, renewals and failures.', critical: true },
  { key: 'account',       label: 'Account',       hint: 'Sign-ins, password and security.', critical: true },
  { key: 'system',        label: 'System',        hint: 'Maintenance and important service notices.', critical: true },
  { key: 'announcements', label: 'Announcements', hint: 'New features and platform news.' },
]

// Coerce a stored (possibly legacy / partial) notificationPrefs into the full
// structured client shape. Mirrors functions/notifications/notificationPrefsCore
// normalizeServerPrefs so what we save round-trips through the server gate
// unchanged. Legacy flat booleans are honoured where they map to a category.
export function normalizeNotificationPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  const cats = p.categories && typeof p.categories === 'object' ? p.categories : {}
  const ch = p.channels && typeof p.channels === 'object' ? p.channels : {}
  const qh = p.quietHours && typeof p.quietHours === 'object' ? p.quietHours : {}

  const legacyLearning =
    p.dailyStreak === false && p.examReminders === false ? false : undefined
  const legacyAssessments = p.resultsReleased === false ? false : undefined
  const legacyAnnouncements = p.announcements === false ? false : undefined
  const pick = (val, legacy) =>
    typeof val === 'boolean' ? val : typeof legacy === 'boolean' ? legacy : true

  return {
    master: typeof p.master === 'boolean' ? p.master : true,
    categories: {
      learning:      pick(cats.learning, legacyLearning),
      lessonPlans:   pick(cats.lessonPlans),
      assessments:   pick(cats.assessments, legacyAssessments),
      payments:      pick(cats.payments),
      account:       pick(cats.account),
      system:        pick(cats.system),
      announcements: pick(cats.announcements, legacyAnnouncements),
    },
    channels: {
      push:  typeof ch.push === 'boolean' ? ch.push : true,
      inApp: typeof ch.inApp === 'boolean' ? ch.inApp : true,
    },
    quietHours: {
      enabled: qh.enabled === true,
      start: typeof qh.start === 'string' ? qh.start : '22:00',
      end: typeof qh.end === 'string' ? qh.end : '06:00',
    },
    muteUntil: Number.isFinite(Number(p.muteUntil)) ? Number(p.muteUntil) : null,
  }
}
