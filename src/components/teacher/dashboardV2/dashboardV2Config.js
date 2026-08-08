/**
 * Static configuration for Teacher Dashboard V2 — nav structure, tiles and
 * icon mappings. Shared by BOTH the live dashboard (/teacher) and the
 * mock-data preview (/teacher/dashboard-preview); everything here is real
 * links/labels, never data.
 */
import {
  BookOpen,
  BookOpenCheck,
  CalendarRange,
  ChartNoAxesColumnIncreasing,
  CircleHelp,
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
  UserRound,
  Users,
} from 'lucide-react'

/**
 * THE teacher navigation menu — one config, every surface.
 *
 * There used to be two: a curated NAV_GROUPS for the /teacher dashboard and a
 * full-map STUDIO_NAV_GROUPS for the studio shell. Because they were separate
 * arrays maintained by hand they said different things about the same tools —
 * the dashboard offered "Lesson Plan Studio", "Schemes Studio" and a
 * Worksheet/Homework pair the studio shell didn't list, so the sidebar
 * visibly changed items and labels the moment a teacher left the dashboard.
 * Merging them is the fix; a shared *component* rendering two different
 * configs was never one sidebar.
 *
 * Consumed by Sidebar (desktop) and NavDrawer (mobile) through TeacherLayout,
 * which is now the only thing that mounts either.
 *
 * Worksheet Studio and Homework Studio are deliberately absent: they stay
 * reachable from Quick Create and the all-tools grid (asserted by
 * dashboardV2Config.spec.js) rather than lengthening the permanent menu.
 */
export const TEACHER_NAV_GROUPS = [
  {
    id: 'root',
    label: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/teacher' },
    ],
  },
  {
    id: 'create',
    label: 'Create',
    items: [
      { id: 'lesson-plan', label: 'Lesson Plans', icon: NotebookPen, to: '/teacher/lesson-plans/new', activePrefix: '/teacher/lesson-plans' },
      { id: 'schemes', label: 'Schemes of Work', icon: CalendarRange, to: '/teacher/generate/scheme-of-work' },
      { id: 'weekly-focus', label: 'Weekly Focus', icon: ClipboardList, to: '/teacher/generate/weekly-forecast' },
      { id: 'record-of-work', label: 'Record of Work', icon: ChartNoAxesColumnIncreasing, to: '/teacher/generate/record-of-work' },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { id: 'library', label: 'My Library', icon: FolderOpen, to: '/teacher/library' },
      { id: 'assessments', label: 'Assessments', icon: FileText, to: '/teacher/assessment-papers' },
      { id: 'classes', label: 'My Classes', icon: Users, to: '/teacher/classes' },
      { id: 'register', label: 'Class List', icon: ListChecks, to: '/teacher/register' },
      { id: 'attendance', label: 'Class Register', icon: ClipboardCheck, to: '/teacher/attendance' },
      { id: 'syllabi', label: 'Syllabi Studio', icon: Files, to: '/teacher/syllabi' },
      { id: 'curriculum', label: 'Curriculum', icon: BookOpen, to: '/teacher/curriculum' },
      { id: 'calendar', label: 'School Calendar', icon: CalendarRange, to: '/teacher/calendar' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'subscription', label: 'Subscription', icon: CreditCard, to: '/teacher/subscription' },
      { id: 'profile', label: 'Profile', icon: UserRound, to: '/settings/profile' },
      { id: 'settings', label: 'Settings', icon: Settings, to: '/settings' },
      { id: 'help', label: 'Help & Support', icon: CircleHelp, to: '/teacher/help' },
    ],
  },
]

/**
 * The name a tool is called by, keyed on the route that opens it.
 *
 * Route, not id: the same tool carries different ids in the sidebar config,
 * the Quick Create tiles, the all-tools grid and the studio registry
 * (`lesson-plan` / `lesson-plans` / `lesson_plan`), so ids cannot join them.
 * The destination can, and it is also the thing a teacher actually
 * experiences as sameness — two cards that open the same page are one tool
 * and must not be called two things.
 *
 * Where a tool appears in TEACHER_NAV_GROUPS, the sidebar's label is
 * authoritative and is copied here verbatim (asserted, not trusted). The rest
 * are tools reachable only from Quick Create / the grid.
 *
 * "Studio" naming is deliberately kept for the PAGE headers — the product
 * identity is "Lesson Plan Studio" — but every navigation surface says
 * "Lesson Plans".
 */
export const CANONICAL_TOOL_LABELS = {
  '/teacher/lesson-plans/new': 'Lesson Plans',
  '/teacher/generate/scheme-of-work': 'Schemes of Work',
  '/teacher/generate/weekly-forecast': 'Weekly Focus',
  '/teacher/generate/record-of-work': 'Record of Work',
  '/teacher/library': 'My Library',
  '/teacher/assessment-papers': 'Assessments',
  '/teacher/classes': 'My Classes',
  '/teacher/register': 'Class List',
  '/teacher/attendance': 'Class Register',
  '/teacher/syllabi': 'Syllabi Studio',
  '/teacher/curriculum': 'Curriculum',
  '/teacher/calendar': 'School Calendar',
  '/teacher/subscription': 'Subscription',
  // The create route of a tool the sidebar already names: one tool, so it
  // takes the sidebar's word rather than a second one ("Test Paper") for the
  // same studio.
  '/teacher/assessment-papers/new': 'Assessments',
  // Not in the sidebar — named here so the tiles and the grid still agree.
  '/teacher/generate/worksheet': 'Worksheets',
  '/teacher/generate/homework': 'Homework',
  '/teacher/generate/notes': 'Teacher Notes',
  '/teacher/generate/flashcards': 'Flashcards',
  '/teacher/generate/mark-schedule': 'Mark Schedule',
  '/teacher/generate/class-timetable': 'Class Timetable',
  '/teacher/question-bank': 'Question Bank',
  '/teacher/templates': 'Paper Templates',
  '/teacher/drafts': 'Drafts',
}

/** The canonical name for a destination, or null if it isn't a named tool. */
export function canonicalToolLabel(to) {
  if (!to) return null
  return CANONICAL_TOOL_LABELS[to.split('?')[0]] || null
}

/**
 * Quick Create shows FOUR tiles; five are declared.
 *
 * Worksheets is withdrawn behind a feature flag, and a curated row of four
 * that silently becomes three is a worse answer than a substitute — Homework
 * Studio is the practice-generation surface while worksheets are away. So the
 * consumer filters by availability and takes the first four: with the flag off
 * Homework fills the slot, with it on the row is exactly what it was before
 * the studio was withdrawn. Order is therefore load-bearing — Homework is last
 * because it is the one that yields.
 */
export const QUICK_CREATE_TILE_COUNT = 4

export const QUICK_CREATE_TILES = [
  {
    id: 'lesson-plan',
    title: 'Lesson Plans',
    description: 'Plan lessons with stages, resources and assessment.',
    icon: NotebookPen,
    to: '/teacher/lesson-plans/new',
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
    title: 'Worksheets',
    description: 'Create classroom practice, exercises and consolidation tasks.',
    icon: Files,
    to: '/teacher/generate/worksheet',
    tone: 'green',
  },
  {
    id: 'test-paper',
    title: 'Assessments',
    description: 'Build weekly, mid-term and end-of-term tests.',
    icon: FileText,
    to: '/teacher/assessment-papers/new',
    tone: 'blue',
  },
  {
    id: 'homework',
    title: 'Homework',
    description: 'Set homework with model answers and marking guidance.',
    icon: BookOpenCheck,
    to: '/teacher/generate/homework',
    tone: 'copper',
  },
]

/* Planning tiles; `countKey` looks up the live saved-count badge. */
export const WORKSPACE_TILES = [
  {
    id: 'schemes',
    title: 'Schemes of Work',
    description: 'Map term pacing, outcomes, and weekly checkpoints.',
    countKey: 'scheme_of_work',
    icon: CalendarRange,
    to: '/teacher/generate/scheme-of-work',
  },
  {
    id: 'weekly-focus',
    title: 'Weekly Focus',
    description: 'Plan the week day by day from your scheme, syllabus and timetable.',
    countKey: 'weekly_forecast',
    icon: ClipboardList,
    to: '/teacher/generate/weekly-forecast',
  },
  {
    id: 'lesson-plans',
    title: 'Lesson Plans',
    description: 'Prepare CBC lessons with stages, resources and assessment.',
    countKey: 'lesson_plan',
    icon: NotebookPen,
    to: '/teacher/lesson-plans/new',
  },
  {
    id: 'record-of-work',
    title: 'Record of Work',
    description: 'Log what you actually taught, checked against your scheme.',
    countKey: 'record_of_work',
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
      { id: 'assessment-papers', label: 'Assessments', to: '/teacher/assessment-papers' },
      { id: 'sba', label: 'SBA Tasks', to: '/teacher/generate/sba' },
      { id: 'mark-schedule', label: 'Mark Schedule', to: '/teacher/generate/mark-schedule' },
    ],
  },
]

/**
 * The complete teacher tool directory — powers the "View all teacher tools"
 * expansion on the Workspace card. Every route is real; keep this list in
 * sync with the /teacher routes in App.jsx (guarded by
 * scripts/test-dashboard-v2-links.mjs).
 */
export const ALL_TOOLS = [
  { id: 'lesson-plan', label: 'Lesson Plans', icon: NotebookPen, to: '/teacher/lesson-plans/new' },
  { id: 'scheme-of-work', label: 'Schemes of Work', icon: CalendarRange, to: '/teacher/generate/scheme-of-work' },
  { id: 'weekly-focus', label: 'Weekly Focus', icon: ClipboardList, to: '/teacher/generate/weekly-forecast' },
  { id: 'record-of-work', label: 'Record of Work', icon: ChartNoAxesColumnIncreasing, to: '/teacher/generate/record-of-work' },
  { id: 'worksheet', label: 'Worksheets', icon: Files, to: '/teacher/generate/worksheet' },
  { id: 'homework', label: 'Homework', icon: BookOpenCheck, to: '/teacher/generate/homework' },
  { id: 'notes', label: 'Teacher Notes', icon: BookOpen, to: '/teacher/generate/notes' },
  { id: 'flashcards', label: 'Flashcards', icon: Files, to: '/teacher/generate/flashcards' },
  { id: 'assessment-papers', label: 'Assessments', icon: FileText, to: '/teacher/assessment-papers' },
  { id: 'mark-schedule', label: 'Mark Schedule', icon: ListChecks, to: '/teacher/generate/mark-schedule' },
  { id: 'sba', label: 'SBA Tasks', icon: ClipboardCheck, to: '/teacher/generate/sba' },
  { id: 'sba-planner', label: 'SBA Year Plan', icon: CalendarRange, to: '/teacher/generate/sba-planner' },
  { id: 'sba-tracker', label: 'SBA Mark Tracker', icon: ChartNoAxesColumnIncreasing, to: '/teacher/generate/sba-tracker' },
  { id: 'class-timetable', label: 'Class Timetable', icon: CalendarRange, to: '/teacher/generate/class-timetable' },
  { id: 'question-bank', label: 'Question Bank', icon: ListChecks, to: '/teacher/question-bank' },
  { id: 'register', label: 'Class List', icon: Users, to: '/teacher/register' },
  { id: 'attendance', label: 'Class Register', icon: ClipboardCheck, to: '/teacher/attendance' },
  { id: 'calendar', label: 'School Calendar', icon: CalendarRange, to: '/teacher/calendar' },
  { id: 'syllabi', label: 'Syllabi Studio', icon: FolderOpen, to: '/teacher/syllabi' },
  { id: 'curriculum', label: 'Curriculum', icon: BookOpen, to: '/teacher/curriculum' },
  { id: 'templates', label: 'Paper Templates', icon: Files, to: '/teacher/templates' },
  { id: 'drafts', label: 'Drafts', icon: FileText, to: '/teacher/drafts' },
  { id: 'library', label: 'My Library', icon: FolderOpen, to: '/teacher/library' },
  { id: 'classes', label: 'My Classes', icon: Users, to: '/teacher/classes' },
]

/* Document/activity row icon per tool id (defaults to FileText). */
const TOOL_ICONS = {
  lesson_plan: NotebookPen,
  scheme_of_work: CalendarRange,
  weekly_forecast: CalendarRange,
  record_of_work: ChartNoAxesColumnIncreasing,
  worksheet: Files,
  homework: BookOpenCheck,
  notes: BookOpen,
  assessment: FileText,
  exam_paper: FileText,
  class_timetable: CalendarRange,
}

export function iconForTool(tool) {
  return TOOL_ICONS[tool] || FileText
}
