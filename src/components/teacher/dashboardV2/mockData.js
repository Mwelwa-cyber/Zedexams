/**
 * Mock data for the Teacher Dashboard V2 preview surface.
 *
 * Everything on /teacher/dashboard-preview renders from this module — no
 * Firestore reads — so the preview can be reviewed (and screenshotted in CI)
 * without a signed-in session. Icon fields are lucide-react component
 * references; consumers render them with a size/strokeWidth of their own.
 */
import {
  BookOpen,
  BookOpenCheck,
  CalendarRange,
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Files,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  NotebookPen,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react'

export const TEACHER = {
  name: 'Mahenga Mwelwa',
  firstName: 'Mahenga',
  shortName: 'Mr. Mwelwa',
  initials: 'MM',
  role: 'Teacher',
  email: 'mahenga@example.com',
}

export const TERM_CHIP = '15 Jul — Term 2 • Week 10'

export const NAV_GROUPS = [
  {
    id: 'root',
    label: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/teacher/dashboard-preview', active: true },
    ],
  },
  {
    id: 'create',
    label: 'Create',
    items: [
      { id: 'lesson-plan', label: 'Lesson Plan Studio', icon: NotebookPen, to: '/teacher/generate/lesson-plan' },
      { id: 'test-paper', label: 'Test Paper Studio', icon: FileText, to: '/teacher/assessment-papers/new' },
      { id: 'exam', label: 'Exam Studio', icon: ClipboardCheck, to: '/teacher/assessment-papers/new' },
      { id: 'worksheet', label: 'Worksheet Studio', icon: Files, to: '/teacher/generate/worksheet' },
      { id: 'homework', label: 'Homework Studio', icon: BookOpenCheck, to: '/teacher/generate/homework' },
      { id: 'schemes', label: 'Schemes Studio', icon: CalendarRange, to: '/teacher/generate/scheme-of-work' },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { id: 'library', label: 'My Library', icon: FolderOpen, to: '/teacher/library' },
      { id: 'classes', label: 'My Classes', icon: Users, to: '/teacher/classes' },
      { id: 'assessments', label: 'Assessments', icon: ListChecks, to: '/teacher/assessment-papers' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'subscription', label: 'Subscription', icon: CreditCard, to: '/pricing' },
      { id: 'profile', label: 'Profile', icon: UserRound, to: '/teacher/settings' },
      { id: 'settings', label: 'Settings', icon: Settings, to: '/teacher/settings' },
      { id: 'help', label: 'Help & Support', icon: CircleHelp, to: '/preferences' },
    ],
  },
]

export const LAST_OPENED = {
  subject: 'Integrated Science',
  grade: 'Grade 4',
  ago: '5d ago',
}

export const QUICK_CREATE_TILES = [
  {
    id: 'lesson-plan',
    title: 'Lesson Plan',
    description: 'Plan lessons with stages, resources and assessment.',
    icon: NotebookPen,
    to: '/teacher/generate/lesson-plan',
    tone: 'copper',
  },
  {
    id: 'weekly-focus',
    title: 'Weekly Focus',
    description: 'Prepare the week from your Scheme of Work and timetable.',
    icon: CalendarRange,
    to: '/teacher/generate/weekly-forecast',
    tone: 'teal',
  },
  {
    id: 'worksheet',
    title: 'Worksheet',
    description: 'Create classroom practice, exercises and consolidation tasks.',
    icon: Files,
    to: '/teacher/generate/worksheet',
    tone: 'green',
  },
  {
    id: 'test-paper',
    title: 'Test Paper',
    description: 'Build weekly, mid-term and end-of-term tests.',
    icon: FileText,
    to: '/teacher/assessment-papers/new',
    tone: 'blue',
  },
]

export const AI_RECOMMENDATION = {
  heading: 'Mathematics is not planned yet',
  body: 'Create a Scheme of Work using the Grade 4 syllabus and current school calendar.',
  cta: 'Create Scheme',
  to: '/teacher/generate/scheme-of-work',
}

export const RECENT_DOCUMENTS = [
  {
    id: 'doc-1',
    title: 'GRADE FOUR END OF TERM 2 TEST - 2026',
    meta: 'Test Paper • Grade 4 • Integrated Science',
    date: '5d ago',
    status: 'Ready',
    icon: FileText,
  },
  {
    id: 'doc-2',
    title: 'Reading Comprehension — Identifying Main Ideas',
    meta: 'Lesson Plan • Grade 6 • English',
    date: '6d ago',
    status: 'Ready',
    icon: NotebookPen,
  },
  {
    id: 'doc-3',
    title: 'Mock Examination — Integrated Science',
    meta: 'Test Paper • Grade 4 • Integrated Science',
    date: '6d ago',
    status: 'Ready',
    icon: FileText,
  },
  {
    id: 'doc-4',
    title: 'GRADE FOUR MOCK EXAMINATION - 2026',
    meta: 'Test Paper • Grade 4 • Integrated Science',
    date: '6d ago',
    status: 'Ready',
    icon: FileText,
  },
  {
    id: 'doc-5',
    title: 'G5 Integrated Science — Term 1 Scheme of Work',
    meta: 'Scheme of Work • Grade 5 • Integrated Science',
    date: '10 Jul',
    status: 'Ready',
    icon: CalendarRange,
  },
]

export const WORKSPACE_TILES = [
  {
    id: 'schemes',
    title: 'Schemes of Work',
    description: 'Map term pacing, outcomes, and weekly checkpoints.',
    saved: 2,
    icon: CalendarRange,
    to: '/teacher/generate/scheme-of-work',
  },
  {
    id: 'weekly-focus',
    title: 'Weekly Focus',
    description: 'Plan the week day by day from your scheme, syllabus and timetable.',
    saved: 1,
    icon: ClipboardList,
    to: '/teacher/generate/weekly-forecast',
  },
  {
    id: 'lesson-plans',
    title: 'Lesson Plans',
    description: 'Prepare CBC lessons with stages, resources and assessment.',
    saved: 11,
    icon: NotebookPen,
    to: '/teacher/generate/lesson-plan',
  },
  {
    id: 'record-of-work',
    title: 'Record of Work',
    description: 'Log what you actually taught, checked against your scheme.',
    saved: 2,
    icon: ChartNoAxesColumnIncreasing,
    to: '/teacher/generate/record-of-work',
  },
]

export const WORKSPACE_EXPANDABLE = [
  {
    id: 'teaching-materials',
    title: 'Teaching Materials',
    icon: BookOpen,
    items: [
      { id: 'worksheets', label: 'Worksheets', to: '/teacher/generate/worksheet' },
      { id: 'homework', label: 'Homework', to: '/teacher/generate/homework' },
      { id: 'notes', label: 'Teacher Notes', to: '/teacher/generate/notes' },
      { id: 'flashcards', label: 'Flashcards', to: '/teacher/generate/flashcards' },
    ],
  },
  {
    id: 'assessment',
    title: 'Assessment',
    icon: ClipboardCheck,
    items: [
      { id: 'assessment-papers', label: 'Assessment Papers', to: '/teacher/assessment-papers' },
      { id: 'rubrics', label: 'Rubrics', to: '/teacher/generate/rubric' },
      { id: 'sba', label: 'SBA Tasks', to: '/teacher/generate/sba' },
      { id: 'mark-schedule', label: 'Mark Schedule', to: '/teacher/generate/mark-schedule' },
    ],
  },
]

export const CHECKLIST_ITEMS = [
  { id: 'weekly-focus', label: 'Weekly Focus: 2 of 5 days', done: 2, total: 5 },
  { id: 'lesson-plans', label: 'Lesson Plans', done: 1, total: 6 },
  { id: 'worksheets', label: 'Worksheets', done: 0, total: 6 },
  { id: 'record-of-work', label: 'Record of Work', done: 0, total: 1 },
]

export const FEED_ITEMS = [
  {
    id: 'feed-success',
    kind: 'success',
    title: 'Audit acknowledged',
    body: 'Removed from the approval queue.',
    icon: CircleCheck,
  },
  {
    id: 'feed-warning',
    kind: 'warning',
    title: 'Issue reported',
    body: 'A GitHub issue has been created successfully.',
    icon: TriangleAlert,
  },
  {
    id: 'feed-error',
    kind: 'error',
    title: 'Couldn’t save changes',
    body: 'Check your connection and try again.',
    icon: CircleX,
    retry: true,
  },
]

export const ACTIVITY_ITEMS = [
  {
    id: 'act-1',
    title: 'Lesson Plan created',
    meta: 'Science • Grade 5',
    time: 'Today, 09:41',
    icon: NotebookPen,
  },
  {
    id: 'act-2',
    title: 'Worksheet updated',
    meta: 'Friction • Practice Set',
    time: 'Today, 09:12',
    icon: Files,
  },
  {
    id: 'act-3',
    title: 'Test Paper created',
    meta: 'Term 2 • Quiz 1',
    time: 'Yesterday, 16:30',
    icon: FileText,
  },
]

export const PERFORMANCE_SERIES = [
  { date: 'Jun 22', classAverage: 46, yourClass: 38 },
  { date: 'Jun 25', classAverage: 52, yourClass: 44 },
  { date: 'Jun 29', classAverage: 58, yourClass: 41 },
  { date: 'Jul 02', classAverage: 55, yourClass: 52 },
  { date: 'Jul 06', classAverage: 61, yourClass: 57 },
  { date: 'Jul 09', classAverage: 59, yourClass: 66 },
  { date: 'Jul 13', classAverage: 64, yourClass: 72 },
]

// Referenced by the chart legend and lines; keep in sync with the CSS vars.
export const CHART_COLORS = {
  classAverage: '#2563EB',
  yourClass: '#C65A24',
}
