// src/features/notes/hooks/useLearnerProfile.js
//
// Thin adapter over the app's AuthContext that maps to the four states
// the LearnerGate cares about:
//
//   'checking'         — auth state still resolving
//   'unauthenticated'  — no user signed in
//   'needs-onboarding' — user exists but profile is missing or has no grade
//   'ready'            — user + profile loaded; safe to render learner UI
//
// The ProtectedRoute + LearnerOnlyRoute wrappers in App.jsx already gate
// access by auth and role. This hook adds the grade-onboarding check on
// top of that, so a learner whose profile lacks `grade` (e.g. signed up
// via Google) gets a one-time pick-your-grade screen.

import { useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'

export function useLearnerProfile() {
  const { currentUser, userProfile, loading, refreshProfile } = useAuth()

  let status
  if (loading) {
    status = 'checking'
  } else if (!currentUser) {
    status = 'unauthenticated'
  } else if (!userProfile || userProfile.grade == null || userProfile.grade === '') {
    status = 'needs-onboarding'
  } else {
    status = 'ready'
  }

  const refresh = useCallback(() => refreshProfile?.(), [refreshProfile])

  return { status, user: currentUser, profile: userProfile, refresh }
}
