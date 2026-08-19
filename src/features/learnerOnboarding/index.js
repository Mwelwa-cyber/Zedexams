/**
 * learnerOnboarding — the first-run setup wizard (prototype v16's
 * `view-pick-grade → view-pick-subjects → view-meet-zed → view-notif-ask`).
 *
 * The PAGE is deliberately not exported. It is mounted by the route table
 * with `lazy(() => import('…/pages/LearnerSetupPage'))`; a page behind a
 * front door lands in the chunk of every consumer, and this door's consumer
 * is a route guard that runs on every learner navigation.
 *
 * What IS exported is the pure rule the guard needs, and nothing else — so
 * importing this door costs the rules module and no React, no Firebase and
 * no CSS.
 */
export {
  needsSetup,
  normalizeGrade,
  resolveSetupSubjects,
  resolveLearnerGradeAccess,
  GRADE_ACCESS,
} from './lib/setupWizardCore'

/**
 * The waitlist screen IS exported, where the page above is not, and the
 * difference is what each one drags in. The page is the whole wizard —
 * Firebase, the profile write, the four steps and onboarding.css — and it is
 * route-mounted lazily so none of that reaches a guard. This is a static card
 * with two buttons whose only imports are Button, Icon and the grade config,
 * and its consumer is `LearnerGradeGate`, which renders it directly on any
 * learner route: there is no lazy boundary available to hide it behind and
 * nothing worth hiding.
 */
export { default as GradeWaitlistScreen } from './components/GradeWaitlistScreen'
