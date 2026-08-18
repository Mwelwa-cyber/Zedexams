/**
 * LearnerGradeGate — holds a learner whose grade has not opened yet.
 *
 * WHY IT LIVES INSIDE `LearnerOnlyRoute` RATHER THAN ON EACH ROUTE LINE.
 * `LearnerSetupGate` wraps `/dashboard` alone, which is enough for its job:
 * it redirects to a wizard, and a learner with no grade arrives at the landing
 * page first. This gate cannot borrow that placement, because "only Grade 7
 * should be using the learner app" has to hold for a deep link into /quizzes,
 * a bookmarked /notes and a push notification into /exams too — the door is
 * every learner route, not the front one. `LearnerOnlyRoute` already runs on
 * all of them and already renders exactly this shape of interstitial for the
 * wrong-role case, so composing here covers the surface without touching
 * thirty route lines (which the route-parsing guards read one line at a time).
 *
 * Three things it deliberately does NOT do:
 *
 *   1. IT DOES NOT TOUCH THE STORED GRADE. A rollout is not a reason to
 *      rewrite a child's profile. See `resolveLearnerGradeAccess`.
 *
 *   2. IT DOES NOT CATCH A LEARNER WITH NO GRADE. That is `LearnerSetupGate`'s
 *      case and it wants the wizard, not a "coming soon" screen that is both
 *      untrue and inescapable. `GRADE_ACCESS.UNKNOWN` passes through here.
 *
 *   3. IT DOES NOT APPLY TO ADMINS OR PARENTS. They reach learner screens
 *      through `LearnerOnlyRoute` and have no grade of their own, so every one
 *      of them would otherwise land on a waitlist for a grade they are not in.
 *      Same reasoning as `LearnerSetupGate`'s rule 3.
 *
 * `/setup` passes through unconditionally: it is where the waitlist screen's
 * "Change my grade" button goes, and a gate that swallowed it would be the
 * dead end the screen exists to avoid.
 */
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { GRADES, LEARNER_GRADES } from '../../config/curriculum'
import {
  GRADE_ACCESS,
  GradeWaitlistScreen,
  resolveLearnerGradeAccess,
} from '../../features/learnerOnboarding'

export default function LearnerGradeGate({ children }) {
  const { userProfile, isLearner } = useAuth()
  const location = useLocation()

  if (!isLearner) return children
  if (location.pathname.startsWith('/setup')) return children

  const access = resolveLearnerGradeAccess(userProfile, LEARNER_GRADES, GRADES)
  if (access !== GRADE_ACCESS.WAITLIST) return children

  return <GradeWaitlistScreen />
}
