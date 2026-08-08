/**
 * Canonical Teacher Workspace studio registry.
 *
 * This is the SINGLE source of truth for the app-launcher: every studio's
 * id, title, description, route, category, icon, saved-count source, static
 * badge, permission and search keywords live here — no dashboard component
 * re-declares a tool name, route or description.
 *
 * Every `route` is a real /teacher route (guarded by
 * scripts/test-dashboard-v2-links.mjs). This module has NO React/Firebase
 * imports beyond the lucide icon components, so its pure companions
 * (teacherLauncherCore.js) test under plain `node`.
 */
import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  Compass,
  FileText,
  Files,
  FolderOpen,
  GraduationCap,
  Image,
  Layers,
  LayoutTemplate,
  ListChecks,
  NotebookPen,
  Users,
} from 'lucide-react'

// Bespoke 3D app-icon artwork. Where a studio has an `image`, the launcher
// renders it in place of the Lucide glyph + tint tile; studios without one
// fall back to their Lucide icon on a tinted tile. Drop a new webp in
// ../../../assets/teacher/studio-icons and add its `image` here.
//
// These are CUT-OUTS with a real alpha channel: the artwork floats directly
// on the glass tile, lit by a drop-shadow, with no rounded box of its own —
// a baked-in box reads as a second, harder-edged tile sitting on the glass
// one. A studio whose file still carries its background sets
// `boxedArtwork: true` so the mount clips it to the tile's radius instead.
import imgLessonPlans from '../../../../assets/teacher/studio-icons/lesson-plans.webp'
import imgNotes from '../../../../assets/teacher/studio-icons/notes.webp'
import imgWeeklyFocus from '../../../../assets/teacher/studio-icons/weekly-focus.webp'
import imgHomework from '../../../../assets/teacher/studio-icons/homework.webp'
import imgRecordOfWork from '../../../../assets/teacher/studio-icons/record-of-work.webp'
import imgWorksheets from '../../../../assets/teacher/studio-icons/worksheets.webp'
import imgVisualStudio from '../../../../assets/teacher/studio-icons/visual-studio.webp'
import imgFlashcards from '../../../../assets/teacher/studio-icons/flashcards.webp'
import imgCurriculum from '../../../../assets/teacher/studio-icons/curriculum.webp'
import imgClassTimetable from '../../../../assets/teacher/studio-icons/class-timetable.webp'
import imgSchemes from '../../../../assets/teacher/studio-icons/schemes.webp'
import imgAssessmentPapers from '../../../../assets/teacher/studio-icons/assessment-papers.webp'
import imgQuestionBank from '../../../../assets/teacher/studio-icons/question-bank.webp'
import imgMarkSchedule from '../../../../assets/teacher/studio-icons/mark-schedule.webp'
import imgSba from '../../../../assets/teacher/studio-icons/sba.webp'
import imgSyllabus from '../../../../assets/teacher/studio-icons/syllabus.webp'
import imgSchoolCalendar from '../../../../assets/teacher/studio-icons/school-calendar.webp'
import imgClassList from '../../../../assets/teacher/studio-icons/class-list.webp'
import imgClassRegister from '../../../../assets/teacher/studio-icons/class-register.webp'
import imgTemplateBank from '../../../../assets/teacher/studio-icons/template-bank.webp'

/** Ordered category definitions — drives the launcher's section order. */
export const STUDIO_CATEGORIES = [
  { id: 'planning', label: 'Planning' },
  { id: 'materials', label: 'Teaching Materials' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'setup', label: 'Planning & Setup' },
]

/**
 * Studio definitions.
 *  - id        stable key (also the favourites/recents key — never reuse)
 *  - countKey  Firestore tool id to look up a live "N saved" badge, or null
 *  - savedWorkTo where this studio's saved output lives (library deep link /
 *              list page), or null when the studio route IS the list — the
 *              info surfaces hide "View saved work" for those
 *  - badge     a STATIC badge ('new'); dynamic saved counts win when > 0
 *  - tint      icon-tile colour token (see teacherAppLauncher.css)
 *  - permission role gate ('teacher'); filtered by filterStudiosByPermission
 *  - keywords  extra search terms beyond title/description
 */
export const TEACHER_STUDIOS = [
  // ── Planning ─────────────────────────────────────────────────────────
  {
    id: 'schemes',
    title: 'Schemes of Work',
    description: 'Map term pacing, outcomes and weekly checkpoints from the syllabus.',
    route: '/teacher/generate/scheme-of-work',
    savedWorkTo: '/teacher/library?type=schemes_of_work',
    category: 'planning',
    icon: CalendarRange,
    image: imgSchemes,
    tint: 'teal',
    countKey: 'scheme_of_work',
    badge: null,
    permission: 'teacher',
    keywords: ['scheme', 'pacing', 'term plan', 'sow'],
  },
  {
    id: 'weekly-focus',
    title: 'Weekly Focus',
    description: 'Plan the week day by day from your scheme, syllabus and timetable.',
    route: '/teacher/generate/weekly-forecast',
    savedWorkTo: '/teacher/library?type=weekly_forecasts',
    category: 'planning',
    icon: ClipboardList,
    image: imgWeeklyFocus,
    tint: 'purple',
    countKey: 'weekly_forecast',
    badge: null,
    permission: 'teacher',
    keywords: ['weekly', 'forecast', 'week plan'],
  },
  {
    id: 'lesson-plans',
    title: 'Lesson Plans',
    description: 'Prepare CBC lessons with stages, resources and assessment.',
    route: '/teacher/lesson-plans/new',
    savedWorkTo: '/teacher/library?type=lesson_plans',
    category: 'planning',
    icon: NotebookPen,
    image: imgLessonPlans,
    tint: 'orange',
    countKey: 'lesson_plan',
    badge: null,
    permission: 'teacher',
    keywords: ['lesson', 'plan', 'teach'],
  },
  {
    id: 'record-of-work',
    title: 'Record of Work',
    description: 'Log what you actually taught, checked against your scheme.',
    route: '/teacher/generate/record-of-work',
    savedWorkTo: '/teacher/library?type=records_of_work',
    category: 'planning',
    icon: BarChart3,
    image: imgRecordOfWork,
    tint: 'rose',
    countKey: 'record_of_work',
    badge: null,
    permission: 'teacher',
    keywords: ['record', 'coverage', 'taught'],
  },
  {
    id: 'class-timetable',
    title: 'Class Timetable',
    description: 'Build a weekly timetable across your subjects and periods.',
    route: '/teacher/generate/class-timetable',
    savedWorkTo: '/teacher/library?type=class_timetables',
    category: 'planning',
    icon: CalendarClock,
    image: imgClassTimetable,
    tint: 'blue',
    countKey: 'class_timetable',
    badge: null,
    permission: 'teacher',
    keywords: ['timetable', 'periods', 'schedule'],
  },

  // ── Teaching Materials ───────────────────────────────────────────────
  {
    id: 'worksheets',
    title: 'Worksheets',
    description: 'Create classroom practice, exercises and consolidation tasks.',
    route: '/teacher/generate/worksheet',
    savedWorkTo: '/teacher/library',
    category: 'materials',
    icon: Files,
    image: imgWorksheets,
    tint: 'green',
    countKey: 'worksheet',
    badge: null,
    permission: 'teacher',
    keywords: ['worksheet', 'practice', 'exercise'],
  },
  {
    id: 'notes',
    title: 'Notes Studio',
    description: 'Write clear CBC notes learners can revise from.',
    route: '/teacher/generate/notes',
    savedWorkTo: '/teacher/library?type=notes',
    category: 'materials',
    icon: BookOpen,
    image: imgNotes,
    tint: 'teal',
    countKey: 'notes',
    badge: null,
    permission: 'teacher',
    keywords: ['notes', 'revision'],
  },
  {
    id: 'homework',
    title: 'Homework Studio',
    description: 'Set homework with model answers and marking guidance.',
    route: '/teacher/generate/homework',
    savedWorkTo: '/teacher/library',
    category: 'materials',
    icon: BookOpenCheck,
    image: imgHomework,
    tint: 'orange',
    countKey: 'homework',
    badge: null,
    permission: 'teacher',
    keywords: ['homework', 'assignment'],
  },
  {
    id: 'visual-studio',
    title: 'Visual Studio',
    description: 'Generate diagrams and picture sets for lessons and papers.',
    route: '/teacher/visual-studio',
    savedWorkTo: null,
    category: 'materials',
    icon: Image,
    image: imgVisualStudio,
    tint: 'purple',
    countKey: null,
    badge: 'new',
    permission: 'teacher',
    keywords: ['visual', 'diagram', 'image', 'picture'],
  },
  {
    id: 'flashcards',
    title: 'Flashcards',
    description: 'Make quick-recall flashcard decks for revision.',
    route: '/teacher/generate/flashcards',
    savedWorkTo: '/teacher/library',
    category: 'materials',
    icon: Layers,
    image: imgFlashcards,
    tint: 'blue',
    countKey: 'flashcards',
    badge: null,
    permission: 'teacher',
    keywords: ['flashcards', 'cards', 'recall'],
  },
  {
    id: 'template-bank',
    title: 'Template Bank',
    description: 'Start from a saved paper template you can reuse and adapt.',
    route: '/teacher/templates',
    savedWorkTo: null,
    category: 'materials',
    icon: LayoutTemplate,
    image: imgTemplateBank,
    tint: 'rose',
    countKey: null,
    badge: null,
    permission: 'teacher',
    keywords: ['template', 'bank', 'reuse'],
  },

  // ── Assessment ───────────────────────────────────────────────────────
  {
    id: 'assessment-papers',
    title: 'Assessment Paper Studio',
    description: 'Build topic tests, mid-terms, end-of-terms, mocks and examinations.',
    route: '/teacher/assessment-papers/new',
    savedWorkTo: '/teacher/assessment-papers',
    category: 'assessment',
    icon: FileText,
    image: imgAssessmentPapers,
    tint: 'orange',
    countKey: 'assessment',
    badge: 'new',
    permission: 'teacher',
    keywords: ['assessment', 'test', 'exam', 'paper', 'mock', 'examination'],
  },
  {
    id: 'question-bank',
    title: 'Question Bank',
    description: 'Browse and reuse reviewed questions from the central bank.',
    route: '/teacher/question-bank',
    savedWorkTo: null,
    category: 'assessment',
    icon: ListChecks,
    image: imgQuestionBank,
    tint: 'teal',
    countKey: null,
    badge: 'new',
    permission: 'teacher',
    keywords: ['question', 'bank', 'items'],
  },
  {
    id: 'mark-schedule',
    title: 'Mark Schedule',
    description: 'Produce a marking scheme and mark allocation for a paper.',
    route: '/teacher/generate/mark-schedule',
    savedWorkTo: '/teacher/library?type=mark_schedules',
    category: 'assessment',
    icon: Calculator,
    image: imgMarkSchedule,
    tint: 'green',
    countKey: 'mark_schedule',
    badge: null,
    permission: 'teacher',
    keywords: ['mark', 'schedule', 'marking scheme'],
  },
  // Rubrics was here. The studio is retired (2026-08) — 4-level descriptor
  // rubrics are not part of the Zambian curriculum or the school teaching
  // file. Its saved documents are still in My Library; nothing creates a new
  // one, so the registry no longer declares it.
  {
    id: 'sba',
    title: 'School-Based Assessment',
    description: 'Plan SBA tasks, year plans and mark tracking.',
    route: '/teacher/sba',
    routeAliases: ['/teacher/generate/sba', '/teacher/generate/sba-planner', '/teacher/generate/sba-tracker'],
    savedWorkTo: '/teacher/library?type=sba_tasks',
    category: 'assessment',
    icon: GraduationCap,
    image: imgSba,
    tint: 'purple',
    countKey: null,
    badge: null,
    permission: 'teacher',
    keywords: ['sba', 'school based assessment', 'coursework'],
  },

  // ── Planning & Setup ─────────────────────────────────────────────────
  {
    id: 'syllabus',
    title: 'Syllabus Studio',
    description: 'Upload, version and manage the syllabi you teach from.',
    route: '/teacher/syllabi',
    savedWorkTo: null,
    category: 'setup',
    icon: FolderOpen,
    image: imgSyllabus,
    // The ONE studio whose artwork still has its rounded-square background
    // baked into the file — no transparent source exists for it yet. Every
    // other icon is a cut-out that floats on the glass, so this one opts
    // back into the rounded clip rather than printing its box's hard edge
    // over the tile. Remove this flag the moment syllabus.webp is replaced;
    // `npm run test:studio-artwork` fails if the flag and the file disagree.
    boxedArtwork: true,
    tint: 'teal',
    countKey: null,
    badge: null,
    permission: 'teacher',
    keywords: ['syllabus', 'syllabi', 'curriculum upload'],
  },
  {
    id: 'curriculum',
    title: 'Curriculum',
    description: 'Explore the CBC curriculum by phase, grade and subject.',
    route: '/teacher/curriculum',
    savedWorkTo: null,
    category: 'setup',
    icon: Compass,
    image: imgCurriculum,
    tint: 'orange',
    countKey: null,
    badge: null,
    permission: 'teacher',
    keywords: ['curriculum', 'cbc', 'outcomes'],
  },
  {
    id: 'school-calendar',
    title: 'School Calendar',
    description: 'See MoE terms, weeks and holidays for your planning.',
    route: '/teacher/calendar',
    savedWorkTo: null,
    category: 'setup',
    icon: CalendarDays,
    image: imgSchoolCalendar,
    tint: 'blue',
    countKey: null,
    badge: null,
    permission: 'teacher',
    keywords: ['calendar', 'term', 'holidays', 'moe'],
  },
  {
    id: 'class-list',
    title: 'Class List',
    description: 'Keep class rosters, marks and reports in one place.',
    route: '/teacher/register',
    savedWorkTo: null,
    category: 'setup',
    icon: Users,
    image: imgClassList,
    tint: 'green',
    countKey: null,
    badge: 'new',
    permission: 'teacher',
    keywords: ['class list', 'roster', 'register', 'marks'],
  },
  {
    id: 'class-register',
    title: 'Class Register',
    description: 'Mark daily attendance and print official registers.',
    route: '/teacher/attendance',
    savedWorkTo: null,
    category: 'setup',
    icon: ClipboardCheck,
    image: imgClassRegister,
    tint: 'rose',
    countKey: null,
    badge: null,
    permission: 'teacher',
    keywords: ['attendance', 'register', 'present', 'absent'],
  },
]

/** Fast id → studio lookup. */
export const STUDIO_BY_ID = TEACHER_STUDIOS.reduce((acc, s) => {
  acc[s.id] = s
  return acc
}, {})

/** The default filter chips shown under the header. */
export const LAUNCHER_CHIPS = [
  { id: 'recent', label: 'Recent' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'all', label: 'All Tools' },
]
