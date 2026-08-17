/**
 * learnerHome — the learner's Home, subject screen, profile and the
 * shell they all render in.
 *
 * The PAGES are deliberately not exported. Every one is route-mounted
 * with `lazy(() => import('…/pages/X'))`; a page behind a front door
 * lands in the chunk of everything that imports the door.
 *
 * What IS exported is what a sibling feature legitimately needs. Today
 * that is `features/learnerProgress`, which renders the same view-model
 * (My Progress and the Study Plan are a second reading of the dashboard's
 * data, not a second fetch of it) and the same primitives, so its empty
 * and loading states are the ones the learner already knows.
 */
export { default as useLearnerDashboard } from './hooks/useLearnerDashboard'
export { default as LearnerIcon, subjectIconName } from './components/LearnerIcon'
export {
  EmptyState,
  ErrorState,
  ProgressBar,
  SectionSkeleton,
} from './components/LearnerPrimitives'
