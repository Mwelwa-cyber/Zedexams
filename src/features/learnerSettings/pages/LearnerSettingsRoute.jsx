// src/features/learnerSettings/pages/LearnerSettingsRoute.jsx
//
// What /settings/* serves a learner.
//
//   /settings                 the Settings index (the prototype-v6 screen)
//   /settings/profile         Name & avatar — and nothing else
//   /settings/security        password, recovery, sign-in
//   /settings/notifications   channels, categories, quiet hours
//   /settings/learning        study setup, quizzes, reading & audio
//   /settings/guardian        the family code, who is linked, "is this my grown-up?"
//   /settings/data            download a copy, privacy choices
//   /settings/help            FAQ, contact support, Childline 116
//   /settings/delete          deleting the account, on its own route
//
// ── Why these became routes ────────────────────────────────────────────────
//
// `?section=` was a parameter on ONE page, so "Name & avatar" and "Delete
// account" resolved to the same URL — the screen a child was sent to for a
// nickname also held their invoices, their payment history and an irreversible
// delete button. Each of those is now its own document with its own history
// entry, so a link means one thing and Back returns to Settings.
//
// ── The old parameter still works ──────────────────────────────────────────
//
// `?section=` is written into sent emails, push deep links and the parent app's
// own instructions to guardians, none of which can be edited now. Every value
// the app ever wrote redirects (`lib/settingsRoutes.js`, node-tested), and one
// we do not recognise lands on the index rather than on an unrelated screen.
// The redirect REPLACES the history entry: a child who follows an old link and
// presses Back should reach where they came from, not bounce off the redirect.
//
// ── The panels behind four of these are the existing ones ──────────────────
//
// Security, Notifications, Learning and Guardian render the panel bodies that
// were already wired to Firestore, `bare` — one panel, a back row, nothing
// else. Reimplementing four working forms to change their URL would be the
// expensive way to move a screen, and each carries real save logic.

import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import PageLoader from '../../../shared/components/PageLoader'
import { redirectForSection } from '../lib/settingsRoutes'
import LearnerSettingsPage from './LearnerSettingsPage'

const NameAvatarPage = lazy(() => import('./NameAvatarPage'))
const DeleteAccountPage = lazy(() => import('./DeleteAccountPage'))
const YourDataPage = lazy(() => import('./YourDataPage'))
const LearnerSettings = lazy(() => import('../LearnerSettings'))

/** One of the existing detail panels, alone inside the learner shell. */
function BarePanel({ section }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <LearnerSettings bare forceSection={section} />
    </Suspense>
  )
}

/**
 * The index. A `?section=` on it is an old link: send it to the route that
 * value now means, replacing the history entry so Back skips the redirect.
 */
function SettingsIndex() {
  const [params] = useSearchParams()
  const section = params.get('section')
  if (section) {
    const to = redirectForSection(section)
    if (to !== '/settings') return <Navigate to={to} replace />
  }
  return <LearnerSettingsPage />
}

export default function LearnerSettingsRoute() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route index element={<SettingsIndex />} />
        <Route path="profile" element={<NameAvatarPage />} />
        <Route path="delete" element={<DeleteAccountPage />} />
        <Route path="data" element={<YourDataPage />} />
        <Route path="security" element={<BarePanel section="security" />} />
        <Route path="notifications" element={<BarePanel section="notifications" />} />
        <Route path="learning" element={<BarePanel section="learning" />} />
        <Route path="guardian" element={<BarePanel section="parent" />} />
        <Route path="help" element={<BarePanel section="help" />} />
        {/* An unknown settings path is a settings link we cannot place, so it
            lands on the index — never on a 404, which would read as though the
            child's settings had gone missing. */}
        <Route path="*" element={<Navigate to="/settings" replace />} />
      </Routes>
    </Suspense>
  )
}
