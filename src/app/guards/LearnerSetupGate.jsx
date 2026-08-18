/**
 * LearnerSetupGate — sends a learner who has not been set up to the wizard.
 *
 * Three things make this safe to put in front of the whole learner shell:
 *
 *   1. IT KEYS ON A MISSING GRADE, NOT ON A "COMPLETED" FLAG. Every learner
 *      who signed up before the wizard existed has a grade and no flag, so a
 *      flag test would redirect the entire existing learner base on the day
 *      it shipped. See `needsSetup` for the full reasoning.
 *
 *   2. IT WAITS FOR THE PROFILE. `needsSetup(null)` is false, so a learner
 *      mid-load is never bounced — the failure being avoided is a one-frame
 *      redirect to /setup on every cold start.
 *
 *   3. IT ONLY APPLIES TO LEARNERS. Admins and parents reach learner screens
 *      through `LearnerOnlyRoute` and have no grade of their own; sending
 *      them to a child's setup wizard would be a dead end they cannot leave.
 */
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { GRADES } from '../../config/curriculum'
import { needsSetup } from '../../features/learnerOnboarding'

export default function LearnerSetupGate({ children }) {
  const { userProfile, isLearner, authReady } = useAuth()
  const location = useLocation()

  // The wizard lives outside this gate, but guard the loop anyway — a future
  // route move must not be able to make /setup redirect to itself.
  if (location.pathname.startsWith('/setup')) return children
  //   4. IT NEVER NAVIGATES BEFORE AUTH RESOLVES. `isLearner` is false while
  //      auth is unresolved, so today this already falls through — but it falls
  //      through by accident, on a flag that means "not a learner" rather than
  //      "not known yet". Stated explicitly so a future rewrite of the role
  //      flags cannot turn a cold start into a redirect to /setup.
  if (!authReady) return children
  if (!isLearner) return children
  if (!needsSetup(userProfile, GRADES)) return children

  return <Navigate to="/setup" replace />
}
