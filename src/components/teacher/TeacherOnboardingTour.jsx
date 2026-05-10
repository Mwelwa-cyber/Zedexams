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

import OnboardingOverlay from '../ui/OnboardingOverlay'

const TEACHER_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to ZedExams Teacher 👋',
    body: 'This is your CBC-aligned co-pilot. Generate lesson plans, build classes, and track every learner from one dashboard.',
    icon: '🎓',
  },
  {
    id: 'generate',
    title: 'AI lesson plans + worksheets',
    body: 'Open any generator from the sidebar — lesson plan, worksheet, scheme of work, rubric, flashcards, notes. Each one exports to DOCX or PDF, ready to print.',
    icon: '✨',
  },
  {
    id: 'classes',
    title: 'Build a class roster',
    body: 'The Classes tab lets you create a class, share an invite code with learners, and assign quizzes. Learners see assigned work on their dashboard.',
    icon: '🎒',
  },
  {
    id: 'analytics',
    title: 'Track progress per learner',
    body: 'Tap "Details" on any assigned quiz to see who finished, who hasn\'t, and how each learner scored. One-tap WhatsApp nudge for those who haven\'t started.',
    icon: '📊',
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
