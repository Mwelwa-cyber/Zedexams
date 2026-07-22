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

export const NAV_GROUPS = [
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
      { id: 'subscription', label: 'Subscription', icon: CreditCard, to: '/my-subscription' },
      { id: 'profile', label: 'Profile', icon: UserRound, to: '/settings/profile' },
      { id: 'settings', label: 'Settings', icon: Settings, to: '/settings' },
      { id: 'help', label: 'Help & Support', icon: CircleHelp, to: '/teacher/help' },
    ],
  },
]

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
    to: '/teacher/generate/lesson-plan',
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
      { id: 'assessment-papers', label: 'Assessment Papers', to: '/teacher/assessment-papers' },
      { id: 'rubrics', label: 'Rubrics', to: '/teacher/generate/rubric' },
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
  { id: 'lesson-plan', label: 'Lesson Plan Studio', icon: NotebookPen, to: '/teacher/generate/lesson-plan' },
  { id: 'scheme-of-work', label: 'Schemes of Work', icon: CalendarRange, to: '/teacher/generate/scheme-of-work' },
  { id: 'weekly-focus', label: 'Weekly Focus', icon: ClipboardList, to: '/teacher/generate/weekly-forecast' },
  { id: 'record-of-work', label: 'Record of Work', icon: ChartNoAxesColumnIncreasing, to: '/teacher/generate/record-of-work' },
  { id: 'worksheet', label: 'Worksheet Studio', icon: Files, to: '/teacher/generate/worksheet' },
  { id: 'homework', label: 'Homework Studio', icon: BookOpenCheck, to: '/teacher/generate/homework' },
  { id: 'notes', label: 'Teacher Notes', icon: BookOpen, to: '/teacher/generate/notes' },
  { id: 'flashcards', label: 'Flashcards', icon: Files, to: '/teacher/generate/flashcards' },
  { id: 'assessment-papers', label: 'Assessment Papers', icon: FileText, to: '/teacher/assessment-papers' },
  { id: 'rubric', label: 'Rubric Studio', icon: ClipboardCheck, to: '/teacher/generate/rubric' },
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
