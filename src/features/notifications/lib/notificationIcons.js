import {
  Bell,
  GraduationCap,
  FileText,
  ListChecks,
  CreditCard,
  User,
  Settings,
  Sparkles,
} from '../../../components/ui/icons'

/**
 * Maps the string icon key stored on a notification doc (set server-side by
 * createNotification / notificationPrefsCore.defaultIconFor) to a heroicon
 * component. Storing a string rather than a component keeps Firestore docs
 * serialisable and lets the server pick a sensible per-category default.
 */
const ICON_BY_KEY = {
  'academic-cap': GraduationCap,
  'document-text': FileText,
  'clipboard-check': ListChecks,
  'credit-card': CreditCard,
  'user-circle': User,
  cog: Settings,
  megaphone: Sparkles,
  bell: Bell,
}

export function resolveNotificationIcon(key) {
  return ICON_BY_KEY[key] || Bell
}

const CATEGORY_LABELS = {
  learning: 'Learning',
  lessonPlans: 'Lesson Plans',
  assessments: 'Assessments',
  payments: 'Payments',
  account: 'Account',
  system: 'System',
  announcements: 'Announcements',
}

export const NOTIFICATION_CATEGORIES = Object.keys(CATEGORY_LABELS)

export function categoryLabel(key) {
  return CATEGORY_LABELS[key] || 'General'
}

/** Firestore Timestamp | {seconds} | null → short relative time string. */
export function relativeTime(ts, now = Date.now()) {
  let d = null
  if (ts && typeof ts.toDate === 'function') d = ts.toDate()
  else if (ts && typeof ts.seconds === 'number') d = new Date(ts.seconds * 1000)
  if (!d) return 'Just now'
  const diff = now - d.getTime()
  if (diff < 60_000) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return d.toLocaleDateString()
}
