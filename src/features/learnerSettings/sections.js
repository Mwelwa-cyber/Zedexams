// Learner Settings — information architecture (pure config).
//
// One entry per settings category. `keywords` powers the top search box (the
// shell filters sections + surfaces matching keywords). `tone` picks one of the
// shared badge tone pairs (.lset-badge--* in learnerSettings.css). Icons come
// from the shared heroicons wrapper so they inherit the app's icon sizing.

import {
  User,
  ShieldCheck,
  Bell,
  BookOpen,
  Eye,
  Users,
  CreditCard,
  BarChart3,
  SwatchIcon,
  Sparkles,
  LockClosedIcon,
} from '../../components/ui/icons'

export const LEARNER_SETTINGS_SECTIONS = [
  {
    id: 'profile',
    label: 'Profile',
    desc: 'Your name, school, grade and avatar',
    icon: User,
    tone: 'green',
    keywords: ['name', 'avatar', 'photo', 'school', 'grade', 'class', 'birthday', 'gender', 'language', 'country'],
  },
  {
    id: 'security',
    label: 'Password & Security',
    desc: 'Password, recovery and account safety',
    icon: ShieldCheck,
    tone: 'blue',
    keywords: ['password', 'security', '2fa', 'two factor', 'devices', 'login', 'recovery', 'logout'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    desc: 'Reminders, results and announcements',
    icon: Bell,
    tone: 'orange',
    keywords: ['notifications', 'reminders', 'push', 'email', 'sms', 'exam', 'homework', 'badges', 'alerts'],
  },
  {
    id: 'learning',
    label: 'Learning Preferences',
    desc: 'Difficulty, quiz mode and audio',
    icon: BookOpen,
    tone: 'purple',
    keywords: ['difficulty', 'quiz', 'timed', 'practice', 'text to speech', 'reading', 'audio', 'curriculum', 'hints'],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    desc: 'Text size, contrast and reading aids',
    icon: Eye,
    tone: 'green',
    keywords: ['text size', 'contrast', 'dyslexia', 'screen reader', 'motion', 'voice', 'colour blind', 'color blind'],
  },
  {
    id: 'parent',
    label: 'Parent / Guardian',
    desc: 'Connect a parent to your progress',
    icon: Users,
    tone: 'blue',
    keywords: ['parent', 'guardian', 'invite', 'progress', 'results', 'attendance'],
  },
  {
    id: 'account',
    label: 'Account',
    desc: 'Subscription, data and deletion',
    icon: CreditCard,
    tone: 'orange',
    keywords: ['subscription', 'plan', 'upgrade', 'premium', 'storage', 'download data', 'delete account', 'email'],
  },
  {
    id: 'dashboard',
    label: 'Learning Dashboard',
    desc: 'Your progress at a glance',
    icon: BarChart3,
    tone: 'purple',
    keywords: ['progress', 'average', 'streak', 'study time', 'strongest', 'weakest', 'recommendations', 'stats'],
  },
  {
    id: 'personalisation',
    label: 'Personalisation',
    desc: 'Theme, colours and layout',
    icon: SwatchIcon,
    tone: 'green',
    keywords: ['theme', 'dark mode', 'light mode', 'colour', 'color', 'accent', 'layout', 'background', 'card'],
  },
  {
    id: 'zed-ai',
    label: 'Zed AI Assistant',
    desc: 'Voice, personality and memory',
    icon: Sparkles,
    tone: 'blue',
    keywords: ['zed', 'ai', 'assistant', 'voice', 'personality', 'memory', 'chat', 'speaking'],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    desc: 'Data sharing and visibility',
    icon: LockClosedIcon,
    tone: 'orange',
    keywords: ['privacy', 'data', 'analytics', 'recommendations', 'visibility', 'blocked', 'report'],
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
