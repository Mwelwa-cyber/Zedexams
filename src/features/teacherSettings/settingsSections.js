// Teacher Settings — information architecture (pure config).
//
// Five calm sections ("Me / My School / My Teaching / My AI / My Account"),
// each rendered as one rounded white card of rows. A row is a Link to its
// detail panel route under /settings/<path>. Icons come from the shared
// heroicons wrapper; `tone` picks one of the dashboard's five badge tone
// pairs (see .tset-row__badge--* in teacherSettings.css, mirroring
// .teacher-activity-card__badge--*).

import {
  User,
  ShieldCheck,
  Home,
  ImageIcon,
  Layers,
  GraduationCap,
  Clock,
  ClipboardList,
  CalendarDays,
  Bot,
  Sparkles,
  SlidersHorizontal,
  Bell,
  Palette,
  CreditCard,
  Settings,
} from '../../shared/components/icons'

export const SETTINGS_SECTIONS = [
  {
    id: 'me',
    label: 'Me',
    rows: [
      {
        id: 'profile',
        path: 'profile',
        title: 'Profile',
        desc: 'Your personal information, photo and biography',
        icon: User,
        tone: 'green',
      },
      {
        id: 'security',
        path: 'security',
        title: 'Security',
        desc: 'Password, sign-in activity and account safety',
        icon: ShieldCheck,
        tone: 'blue',
      },
    ],
  },
  {
    id: 'school',
    label: 'My School',
    rows: [
      {
        id: 'school',
        path: 'school',
        title: 'School',
        desc: 'School details that appear on every generated document',
        icon: Home,
        tone: 'blue',
      },
      {
        id: 'branding',
        path: 'branding',
        title: 'Branding',
        desc: 'Logo, letterhead and document defaults',
        icon: ImageIcon,
        tone: 'orange',
      },
      {
        id: 'resources',
        path: 'resources',
        title: 'Resources',
        desc: 'How well-equipped your school is — shapes every lesson',
        icon: Layers,
        tone: 'green',
      },
    ],
  },
  {
    id: 'teaching',
    label: 'My Teaching',
    rows: [
      {
        id: 'teachingProfile',
        path: 'teaching-profile',
        title: 'Teaching Profile',
        desc: 'Your school calendar, grades, subjects and classes you teach',
        icon: GraduationCap,
        tone: 'orange',
      },
      {
        id: 'timetable',
        path: 'timetable',
        title: 'My Teaching Timetable',
        desc: 'Your weekly teaching schedule, workload and assignment coverage',
        icon: Clock,
        tone: 'orange',
      },
      {
        id: 'curriculum',
        path: 'curriculum',
        title: 'Curriculum',
        desc: 'Default curriculum, grade and subject for every studio',
        icon: ClipboardList,
        tone: 'blue',
      },
      {
        id: 'calendar',
        path: 'calendar',
        title: 'Calendar',
        desc: 'Academic year and current term',
        icon: CalendarDays,
        tone: 'green',
      },
    ],
  },
  {
    id: 'ai',
    label: 'My AI',
    rows: [
      {
        id: 'ai',
        path: 'ai',
        title: 'AI Preferences',
        desc: 'Tune how your lesson plans and materials are written',
        icon: Bot,
        tone: 'green',
      },
      {
        id: 'memory',
        path: 'memory',
        title: 'AI Memory',
        desc: 'What your assistant remembers, and your usage',
        icon: Sparkles,
        tone: 'purple',
      },
      {
        id: 'defaults',
        path: 'defaults',
        title: 'Smart Defaults',
        desc: 'Difficulty and duration defaults that pre-fill every studio',
        icon: SlidersHorizontal,
        tone: 'blue',
      },
    ],
  },
  {
    id: 'account',
    label: 'My Account',
    rows: [
      {
        id: 'notifications',
        path: 'notifications',
        title: 'Notifications',
        desc: 'Choose what you want to be notified about',
        icon: Bell,
        tone: 'orange',
      },
      {
        id: 'appearance',
        path: 'appearance',
        title: 'Appearance',
        desc: 'Theme, motion and display preferences',
        icon: Palette,
        tone: 'purple',
      },
      {
        id: 'subscription',
        path: 'subscription',
        title: 'Subscription',
        desc: 'Your plan, billing and upgrade options',
        icon: CreditCard,
        tone: 'blue',
      },
      {
        id: 'advanced',
        path: 'advanced',
        title: 'Advanced',
        desc: 'Power-user options and what’s coming next',
        icon: Settings,
        tone: 'slate',
      },
    ],
  },
]

// Legacy deep links (`/settings?tab=<id>` — e.g. AssessmentBlocks links to
// ?tab=school) → new nested paths. Unknown tabs land on the hub. The old
// "account" tab's only content was the delete-account flow, which now lives
// on the Security panel.
export const LEGACY_TAB_TO_PATH = {
  school: 'school',
  notifications: 'notifications',
  appearance: 'appearance',
  accessibility: 'appearance',
  account: 'security',
  // The standalone "Teaching" panel was folded into the Teaching Profile
  // (its grades/subjects/classes are the same data); old links redirect there.
  teaching: 'teaching-profile',
}

// Flat row lookup used by the router + specs.
export const ALL_SETTINGS_ROWS = SETTINGS_SECTIONS.flatMap((s) => s.rows)
