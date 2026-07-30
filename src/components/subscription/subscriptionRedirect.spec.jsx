/**
 * /my-subscription → /teacher/subscription for teachers.
 *
 * Both directions are tested, because the failure modes are opposite and
 * equally bad: a teacher stranded on a chrome-less page the sidebar points
 * away from, or a learner bounced into a teacher-only route they cannot open.
 *
 * The component under test is the one App.jsx routes to, not a restatement of
 * its rule here — a paraphrase would keep passing after the real rule changed.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MySubscriptionRoute from './MySubscriptionRoute'

const auth = { isAdmin: false, isTeacher: false }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))
// The standalone page pulls the subscription/billing stack (and Firebase with
// it); which page renders is the subject here, not what is on it.
vi.mock('./MySubscriptionPage', () => ({
  default: () => <div>Standalone subscription page</div>,
}))

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/my-subscription" element={<MySubscriptionRoute />} />
        <Route path="/teacher/subscription" element={<div>In-shell subscription page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('/my-subscription', () => {
  it('lands a teacher on /teacher/subscription', () => {
    auth.isAdmin = false
    auth.isTeacher = true
    renderAt('/my-subscription')
    expect(screen.getByText('In-shell subscription page')).toBeInTheDocument()
  })

  it('still serves learners the standalone page', () => {
    auth.isAdmin = false
    auth.isTeacher = false
    renderAt('/my-subscription')
    expect(screen.getByText('Standalone subscription page')).toBeInTheDocument()
  })

  it('does not push admins into the teacher shell', () => {
    // isTeacher includes superAdmins (AuthContext), so the admin check has to
    // come first or every admin would be redirected into the teacher area.
    auth.isAdmin = true
    auth.isTeacher = true
    renderAt('/my-subscription')
    expect(screen.getByText('Standalone subscription page')).toBeInTheDocument()
  })
})
