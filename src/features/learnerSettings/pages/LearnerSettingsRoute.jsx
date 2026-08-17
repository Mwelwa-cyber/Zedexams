// src/features/learnerSettings/pages/LearnerSettingsRoute.jsx
//
// What /settings serves a learner.
//
//   no ?section            → the prototype-v6 Settings screen
//   ?section=account|help  → that one panel, BARE (no dashboard chrome)
//   anything else          → the v6 screen
//
// Two of the mockup's rows open a flow it would be reckless to
// reimplement — the account panel carries the LEGAL-003 delete
// re-authentication, the help panel the contact dialog — so those still
// render, but stripped of the old settings dashboard around them.
//
// That dashboard (a rail of ten sections, a settings search, a card
// grid covering Progress, Premium, Accessibility, AI, Security…) is not
// in the learner mockup, so a learner is never dropped into it: an
// unknown or non-reachable section falls back to the mockup screen
// instead. The dashboard itself is untouched for the roles that still
// use it.

import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageLoader from '../../../shared/components/PageLoader'
import { LEARNER_REACHABLE_SECTIONS } from '../sections'
import LearnerSettingsPage from './LearnerSettingsPage'

const LearnerSettings = lazy(() => import('../LearnerSettings'))

export default function LearnerSettingsRoute() {
  const [params] = useSearchParams()
  const section = params.get('section')

  if (LEARNER_REACHABLE_SECTIONS.includes(section)) {
    return (
      <Suspense fallback={<PageLoader />}>
        <LearnerSettings bare />
      </Suspense>
    )
  }
  return <LearnerSettingsPage />
}
