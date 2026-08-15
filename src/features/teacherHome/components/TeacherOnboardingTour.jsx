/**
 * TeacherOnboardingTour — first-session tour for teachers (audit A8).
 *
 * The teacher dashboard exposes the highest-complexity surface in the
 * app: AI lesson plan / worksheet / scheme-of-work generators, the
 * assessment studio, classroom rosters, agent-job submissions. A
 * first-time visitor confronted with all of that without context
 * bounces. Four short tooltip-style cards highlight the workflow the
 * audit identified as the biggest discovery gap.
 *
 * Re-uses <OnboardingOverlay /> with teacher-specific copy + a
 * dedicated localStorage key so dismissing the learner tour doesn't
 * suppress this one (or vice versa).
 *
 * Mount on the teacher dashboard root. Self-suppresses after the
 * first dismissal.
 */

import OnboardingOverlay from '../../../shared/components/OnboardingOverlay'

const TEACHER_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to ZedExams Teacher 👋',
    body: 'This is your CBC-aligned co-pilot. Generate lesson plans, build class lists, and track every learner from one dashboard.',
    icon: '🎓',
  },
  {
    id: 'generate',
    title: 'AI lesson plans + teaching materials',
    body: 'Open any generator from the sidebar — lesson plan, scheme of work, homework, flashcards, notes. Each one exports to DOCX or PDF, ready to print.',
    icon: '✨',
  },
  {
    id: 'classes',
    title: 'Build a class list',
    body: 'The Class List tab lets you build an official roster once — it then feeds SBA, mark schedules, reports and progress, so you never retype a class.',
    icon: '🎒',
  },
]

export default function TeacherOnboardingTour() {
  return (
    <OnboardingOverlay
      steps={TEACHER_STEPS}
      storageKey="zedexams:teacher-onboarded"
      finishLabel="Open dashboard 🚀"
    />
  )
}
