// src/features/notes/components/LearnerGate.jsx
//
// Wraps every /notes route. Mounted INSIDE <ProtectedRoute><LearnerOnlyRoute>
// in App.jsx, so by the time we get here the user is signed in and either a
// learner or admin. This gate only handles the "user has no grade yet" case
// by showing the LearnerOnboarding screen.

import { Navigate } from 'react-router-dom'
import { Loader2 } from '../../../components/ui/icons'
import { useLearnerProfile } from '../hooks/useLearnerProfile'
import { LearnerOnboarding } from './LearnerOnboarding'

const LOGIN_PATH = '/login'

export function LearnerGate({ children }) {
  const { status, user, refresh } = useLearnerProfile()

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500" style={{ backgroundColor: '#FAFAF7' }}>
        <Loader2 size={20} className="animate-spin" />
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
