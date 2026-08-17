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

export const SECTION_IDS = LEARNER_SETTINGS_SECTIONS.map((s) => s.id)

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
  return LEARNER_SETTINGS_SECTIONS.find((s) => s.id === id) || null
}

// The only sections a learner can reach, because they are the only ones
// the prototype-v6 Settings rows link to: Name & avatar / Delete account
// → `account`, Report a problem / Get help → `help`. Everything else in
// the settings dashboard is not in the learner mockup.
export const LEARNER_REACHABLE_SECTIONS = ['account', 'help']
