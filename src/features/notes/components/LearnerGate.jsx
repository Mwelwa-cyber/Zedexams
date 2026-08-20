// src/features/notes/components/LearnerGate.jsx
//
// Wraps every /notes route. Mounted INSIDE <ProtectedRoute><LearnerOnlyRoute>
// in App.jsx, so by the time we get here the user is signed in and either a
// learner or admin. This gate only handles the "user has no grade yet" case
// by showing the LearnerOnboarding screen.

import { Navigate } from 'react-router-dom'
import TopLine from '../../../shared/components/TopLine'
import { useLearnerProfile } from '../hooks/useLearnerProfile'
import { LearnerOnboarding } from './LearnerOnboarding'

const LOGIN_PATH = '/login'

export function LearnerGate({ children }) {
  const { status, user, refresh } = useLearnerProfile()

  if (status === 'checking') {
    // A profile read, not a page load — usually well under the delay gate,
    // so TopLine paints nothing at all for most learners rather than
    // flashing a spinner they never needed to see. The blank hold is
    // deliberate: this gate resolves into the notes hub or the onboarding
    // screen, and a spinner between two screens is a third screen.
    return (
      <div className="notes-studio min-h-screen" aria-busy="true">
        <TopLine fixed label="Loading your notes" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to={LOGIN_PATH} replace />
  }

  if (status === 'needs-onboarding') {
    return <LearnerOnboarding user={user} onDone={refresh} />
  }

  return children
}
