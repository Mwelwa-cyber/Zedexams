/**
 * Mock data for the Teacher Dashboard V2 PREVIEW surface only
 * (/teacher/dashboard-preview). The live /teacher dashboard derives the
 * same prop shapes from real Firestore data via useTeacherDashboardData.
 * Static nav/tile configuration lives in dashboardV2Config.js.
 */

export const TEACHER = {
  name: 'Mahenga Mwelwa',
  firstName: 'Mahenga',
  shortName: 'Mr. Mwelwa',
  initials: 'MM',
  role: 'Teacher',
  email: 'mahenga@example.com',
}

export const TERM_CHIP = '15 Jul — Term 2 • Week 10'

/** Mobile hero context — school, term progress, plan badge. */
export const HERO = {
  schoolName: 'Jemareen Academy',
  term: { termNumber: 2, weekNumber: 10, totalWeeks: 14, daysLeft: 18 },
  nextTermOpens: null,
  plan: { tier: 'max', label: 'Max Plan' },
}

export const LAST_OPENED = {
  title: 'Integrated Science',
  subject: 'Integrated Science',
  grade: 'Grade 4',
  ago: '5d ago',
  agoDays: 5,
  to: '/teacher/library',
}

export const AI_RECOMMENDATION = {
  id: 'scheme-mathematics',
  title: 'Mathematics is not planned yet',
  text: 'Create a Scheme of Work using the Grade 4 syllabus and current school calendar.',
  actionLabel: 'Create Scheme',
  to: '/teacher/generate/scheme-of-work',
  context: { grade: 'Grade 4', subject: 'Mathematics' },
}

export const RECENT_DOCUMENTS = [
  {
    id: 'doc-1',
    title: 'GRADE FOUR END OF TERM 2 TEST - 2026',
    meta: 'Test Paper • Grade 4 • Integrated Science',
    date: '5d ago',
    status: 'Ready',
    tool: 'assessment',
    to: '/teacher/library',
  },
  {
    id: 'doc-2',
    title: 'Reading Comprehension — Identifying Main Ideas',
    meta: 'Lesson Plan • Grade 6 • English',
    date: '6d ago',
    status: 'Ready',
    tool: 'lesson_plan',
    to: '/teacher/library',
  },
  {
    id: 'doc-3',
    title: 'Mock Examination — Integrated Science',
    meta: 'Test Paper • Grade 4 • Integrated Science',
    date: '6d ago',
    status: 'Ready',
    tool: 'assessment',
    to: '/teacher/library',
  },
  {
    id: 'doc-4',
    title: 'GRADE FOUR MOCK EXAMINATION - 2026',
    meta: 'Test Paper • Grade 4 • Integrated Science',
    date: '6d ago',
    status: 'Ready',
    tool: 'assessment',
    to: '/teacher/library',
  },
  {
    id: 'doc-5',
    title: 'G5 Integrated Science — Term 1 Scheme of Work',
    meta: 'Scheme of Work • Grade 5 • Integrated Science',
    date: '10 Jul',
    status: 'Ready',
    tool: 'scheme_of_work',
    to: '/teacher/library',
  },
]

export const SAVED_COUNTS = {
  scheme_of_work: 2,
  weekly_forecast: 1,
  lesson_plan: 11,
  record_of_work: 2,
}

export const CHECKLIST_ITEMS = [
  { id: 'weekly-focus', label: 'Weekly Focus: 2 of 5 days', done: 2, total: 5, to: '/teacher/generate/weekly-forecast' },
  { id: 'lesson-plans', label: 'Lesson Plans', done: 1, total: 6, to: '/teacher/lesson-plans/new' },
  { id: 'homework', label: 'Homework', done: 0, total: 6, to: '/teacher/generate/homework' },
  { id: 'record-of-work', label: 'Record of Work', done: 0, total: 1, to: '/teacher/generate/record-of-work' },
]

export const FEED_ITEMS = [
  {
    id: 'feed-success',
    kind: 'success',
    title: 'Audit acknowledged',
    body: 'Removed from the approval queue.',
  },
  {
    id: 'feed-warning',
    kind: 'warning',
    title: 'Issue reported',
    body: 'A GitHub issue has been created successfully.',
  },
  {
    id: 'feed-error',
    kind: 'error',
    title: 'Couldn’t save changes',
    body: 'Check your connection and try again.',
    retry: true,
  },
]

export const ACTIVITY_ITEMS = [
  {
    id: 'act-1',
    title: 'Lesson Plan created',
    meta: 'Science • Grade 5',
    time: 'Today, 09:41',
    tool: 'lesson_plan',
    to: '/teacher/library',
  },
  {
    id: 'act-2',
    title: 'Worksheet updated',
    meta: 'Friction • Practice Set',
    time: 'Today, 09:12',
    tool: 'worksheet',
    to: '/teacher/library',
  },
  {
    id: 'act-3',
    title: 'Test Paper created',
    meta: 'Term 2 • Quiz 1',
    time: 'Yesterday, 16:30',
    tool: 'assessment',
    to: '/teacher/library',
  },
]

