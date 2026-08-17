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
} from './lib/setupWizardCore'
