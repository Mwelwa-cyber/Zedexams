import {
  BookOpen,
  CalendarDays,
  ClipboardCheckList,
  ClipboardList,
  FileText,
  FolderOpen,
  GraduationCap,
  Home,
  LayoutDashboard,
  PencilLine,
  Settings,
  Sparkles,
  Target,
  Users,
} from '../../shared/components/icons'

/**
 * Single source of truth for the teacher navigation surfaces.
 *
 * Three surfaces show three different subsets on purpose (an 11-item sidebar
 * doesn't fit a 4-tab bottom bar), but they used to define their items in
 * three separate files, so routes and labels drifted apart. Every teacher
 * destination now lives in ROUTES below, and each surface list picks from it —
 * change a route or label here and every surface follows.
 */
export const ROUTES = {
  dashboard:      '/teacher',
  lessonPlans:    '/teacher/lesson-plans/new',
  schemesOfWork:  '/teacher/generate/scheme-of-work',
  weeklyForecast: '/teacher/generate/weekly-forecast',
  recordOfWork:   '/teacher/generate/record-of-work',
  notes:          '/teacher/generate/notes',
  flashcards:     '/teacher/generate/flashcards',
  library:          '/teacher/library',
  assessmentPapers: '/teacher/assessment-papers',
  newAssessmentPaper: '/teacher/assessment-papers/new',
  syllabi:        '/teacher/syllabi',
  curriculum:     '/teacher/curriculum',
  calendar:       '/teacher/calendar',
  register:       '/teacher/register',
  attendance:     '/teacher/attendance',
  settings:       '/settings',
}

// Desktop sidebar (TeacherLayout) — the full map of the teacher section.
export const SIDEBAR_NAV = [
  { to: ROUTES.dashboard,      icon: LayoutDashboard,    label: 'My Dashboard', end: true },
  { to: ROUTES.lessonPlans,    icon: FileText,           label: 'Lesson Plans' },
  { to: ROUTES.schemesOfWork,  icon: BookOpen,           label: 'Schemes of Work' },
  { to: ROUTES.weeklyForecast, icon: Target,             label: 'Weekly Focus' },
  { to: ROUTES.recordOfWork,   icon: ClipboardList,      label: 'Record of Work' },
  { to: ROUTES.library,        icon: FolderOpen,         label: 'My Library' },
  { to: ROUTES.assessmentPapers, icon: PencilLine,       label: 'Assessment Papers' },
  { to: ROUTES.register,       icon: Users,              label: 'Class List' },
  { to: ROUTES.attendance,     icon: ClipboardCheckList, label: 'Class Register' },
  { to: ROUTES.syllabi,        icon: FolderOpen,         label: 'Syllabi Studio' },
  { to: ROUTES.curriculum,     icon: GraduationCap,      label: 'Curriculum' },
  { to: ROUTES.calendar,       icon: CalendarDays,       label: 'School Calendar' },
  { to: ROUTES.settings,       icon: Settings,           label: 'Settings' },
]

// Mobile/tablet bottom tab bar (TeacherBottomNav) — the four highest-traffic
// destinations only.
export const BOTTOM_NAV = [
  { to: ROUTES.dashboard,  icon: Home,               label: 'Home',        end: true },
  { to: ROUTES.library,    icon: FolderOpen,         label: 'Library',     end: false },
  { to: ROUTES.assessmentPapers, icon: ClipboardCheckList, label: 'Assessments', end: false },
  { to: ROUTES.register,   icon: Users,              label: 'Class List',  end: false },
]

// Desktop "Create" menu (TeacherTopBar) — quick jumps into the studios a
// teacher reaches for daily.
export const QUICK_CREATE = [
  { to: ROUTES.lessonPlans,  icon: BookOpen,   label: 'Lesson Plan',   accent: '#fde2c4' },
  { to: ROUTES.notes,        icon: FileText,   label: 'Teacher Notes', accent: '#dbe7f4' },
  { to: ROUTES.newAssessmentPaper, icon: PencilLine, label: 'Assessment Paper', accent: '#e8d8f0' },
  { to: ROUTES.flashcards,   icon: Sparkles,   label: 'Flashcards',    accent: '#fde9b8' },
]
