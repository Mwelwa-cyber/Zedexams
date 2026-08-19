// Learner Settings — information architecture (pure config).
//
// One entry per settings category, in the order they appear down the sidebar
// and the overview dashboard. `keywords` powers the top search box (the shell
// filters sections + surfaces matching keywords). `tone` picks one of the
// shared badge tone pairs (.lset-badge--* in learnerSettings.css). `desc` is the
// one-line subtitle shown under each sidebar label. Icons come from the shared
// heroicons wrapper so they inherit the app's icon sizing.

import {
  User,
  BookOpen,
  BarChart3,
  Bell,
  SwatchIcon,
  Eye,
  Sparkles,
  TrophyIcon,
  ShieldCheck,
  Info,
} from '../../shared/components/icons'

export const LEARNER_SETTINGS_SECTIONS = [
  {
    id: 'account',
    label: 'My Account',
    desc: 'Personal information and security',
    icon: User,
    tone: 'blue',
    keywords: ['profile', 'name', 'avatar', 'photo', 'school', 'grade', 'class', 'email', 'phone', 'username', 'parent', 'guardian', 'change password', 'delete account', 'download data'],
  },
  {
    id: 'learning',
    label: 'Learning Preferences',
    desc: 'Study goals and learning options',
    icon: BookOpen,
    tone: 'purple',
    keywords: ['difficulty', 'quiz', 'timed', 'practice', 'study goal', 'daily goal', 'text to speech', 'reading', 'audio', 'curriculum', 'hints', 'language', 'ai tutor'],
  },
  {
    id: 'progress',
    label: 'Progress & Performance',
    desc: 'View your stats and learning progress',
    icon: BarChart3,
    tone: 'green',
    keywords: ['progress', 'average', 'streak', 'xp', 'level', 'badges', 'study time', 'strongest', 'weakest', 'weak topics', 'strong topics', 'analytics', 'stats', 'questions answered'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    desc: 'Manage your notifications',
    icon: Bell,
    tone: 'orange',
    keywords: ['notifications', 'reminders', 'push', 'email', 'sms', 'exam', 'homework', 'assignment', 'badges', 'leaderboard', 'alerts', 'subscription reminder'],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    desc: 'Theme, font size and display',
    icon: SwatchIcon,
    tone: 'blue',
    keywords: ['theme', 'dark mode', 'light mode', 'system', 'colour', 'color', 'accent', 'font size', 'layout', 'background', 'card', 'animations', 'compact'],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    desc: 'Tools to support your learning',
    icon: Eye,
    tone: 'green',
    keywords: ['text size', 'larger text', 'contrast', 'dyslexia', 'screen reader', 'reduce motion', 'voice', 'read aloud', 'colour blind', 'color blind', 'keyboard'],
  },
  {
    id: 'ai',
    label: 'AI Learning Assistant',
    desc: 'Smart learning personalization',
    icon: Sparkles,
    tone: 'purple',
    keywords: ['ai', 'zed', 'assistant', 'learning goal', 'weak topics', 'daily challenge', 'weekly challenge', 'revision plan', 'timetable', 'homework helper', 'chat tutor', 'voice', 'personality'],
  },
  {
    id: 'premium',
    label: 'Premium',
    desc: 'Upgrade your plan and benefits',
    icon: TrophyIcon,
    tone: 'orange',
    keywords: ['premium', 'upgrade', 'plan', 'subscription', 'unlimited', 'pro', 'max', 'invoices', 'payment', 'benefits', 'offline'],
  },
  {
    id: 'security',
    label: 'Security & Privacy',
    desc: 'Password and login settings',
    icon: ShieldCheck,
    tone: 'blue',
    keywords: ['password', 'security', '2fa', 'two factor', 'devices', 'login', 'recovery', 'logout', 'sign out', 'sessions', 'privacy', 'data sharing', 'analytics', 'visibility'],
  },
  {
    id: 'help',
    label: 'Help & Support',
    desc: 'Get help and learn more',
    icon: Info,
    tone: 'slate',
    keywords: ['help', 'support', 'faq', 'faqs', 'contact', 'report a problem', 'feedback', 'suggest', 'tutorials', 'about', 'privacy policy', 'terms'],
  },
]

/**
 * Sections that exist as a PANEL but not as a card on the settings
 * dashboard.
 *
 * `parent` is the Guardian screen — the family code, the linked
 * guardians, and (since codes became child-confirmed) the "is this your
 * grown-up?" answer. It is not on the dashboard because the dashboard is
 * not part of the learner mockup at all; it is reached from the Guardian
 * row on the v6 Settings screen, which is where a child is told to look.
 *
 * Kept OUT of `LEARNER_SETTINGS_SECTIONS` rather than added to it,
 * because that array drives the dashboard's rail and scroll-spy: an entry
 * with no matching card would put a rail item on screen that scrolls
 * nowhere.
 */
export const PANEL_ONLY_SECTIONS = [
  {
    id: 'parent',
    label: 'Guardian',
    desc: 'Your family code and who can see your progress',
    icon: ShieldCheck,
    tone: 'green',
    keywords: ['guardian', 'parent', 'family code', 'link', 'grown-up', 'mum', 'dad'],
  },
]

export const SECTION_IDS = LEARNER_SETTINGS_SECTIONS.map((s) => s.id)

/** Every id that resolves to a panel, dashboard card or not. */
export const PANEL_SECTION_IDS = [
  ...SECTION_IDS,
  ...PANEL_ONLY_SECTIONS.map((s) => s.id),
]

// Search: returns the sections whose label, description, or any keyword matches
// the (trimmed, lower-cased) query. Empty query → all sections.
export function searchSections(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return LEARNER_SETTINGS_SECTIONS
  return LEARNER_SETTINGS_SECTIONS.filter((s) => {
    if (s.label.toLowerCase().includes(q)) return true
    if (s.desc.toLowerCase().includes(q)) return true
    return s.keywords.some((k) => k.includes(q))
  })
}

export function getSection(id) {
  return LEARNER_SETTINGS_SECTIONS.find((s) => s.id === id) ||
    PANEL_ONLY_SECTIONS.find((s) => s.id === id) ||
    null
}

// The only sections a learner can reach, because they are the only ones
// the prototype-v6 Settings rows link to: Name & avatar / Delete account
// → `account`, Report a problem / Get help → `help`, Guardian → `parent`.
// Everything else in the settings dashboard is not in the learner mockup.
//
// `parent` was added when family codes became single-use, 48-hour and
// CHILD-CONFIRMED. The parent app tells a guardian "your child finds this
// in their app under Settings → Guardian", and that sentence was simply
// untrue: the Guardian row on the v6 screen was an InfoRow with no
// destination, and the panel holding the code lived at a section a
// learner could not reach. A child could not mint a code, could not
// rotate one, and — once redemption started asking them to confirm — had
// nowhere to answer. The confirmation step needs a screen, so the screen
// is reachable.
export const LEARNER_REACHABLE_SECTIONS = ['account', 'help', 'parent']
