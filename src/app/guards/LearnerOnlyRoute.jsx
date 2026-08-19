import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../../shared/components/Button'
import Icon from '../../shared/components/Icon'
import FullScreenLoader from '../../shared/components/FullScreenLoader'
import { Sparkles, ArrowLeft } from '../../shared/components/icons'
import LearnerGradeGate from './LearnerGradeGate'
import { resolveLearnerPortalDenial } from './learnerPortalDenial'

export default function LearnerOnlyRoute({ children }) {
  const { userProfile, loading, authReady, isAdmin, isLearner, isTeacher, isParent, canAccessLearnerPortal } = useAuth()
  const navigate = useNavigate()

  // Wait for auth AND the profile before evaluating role. `authReady` first:
  // every role flag below is derived from a profile that cannot exist before
  // Firebase has emitted, so deciding here while auth is unresolved would show
  // a returning learner the "teacher accounts stay in the teacher portal" card
  // on their own dashboard. The profile wait is the original reason — otherwise
  // a teacher (or any non-learner) briefly renders the learner-only children
  // while userProfile is still null.
  if (!authReady || loading || !userProfile) return <FullScreenLoader label="Loading your dashboard…" />

  // Admins and learners always pass through the ROLE check. Learners then meet
  // the staged-rollout gate: `LearnerGradeGate` is composed here rather than on
  // each route line because it has to hold on every learner route (deep links,
  // bookmarks, notification targets), and this guard is the one thing already
  // on all of them. It is a no-op for admins and for any learner whose grade is
  // open — see the file header there.
  if (isAdmin || isLearner) return <LearnerGradeGate>{children}</LearnerGradeGate>

  // Any other role with learner-portal access (e.g. parents on a premium plan)
  // passes through. Teachers are intentionally excluded — the two portals are
  // fully separate, so a teacher account can never access the learner side.
  if (!isTeacher && canAccessLearnerPortal) return children

  // Blocked. WHO is blocked decides both the words and the way out: this card
  // used to be written for a teacher and shown to everyone the guard turned
  // away, so a parent was told their account was a teacher's and given a
  // button to a portal they cannot open. `resolveLearnerPortalDenial` answers
  // both from one look at the role — see the header there.
  const denial = resolveLearnerPortalDenial({ role: userProfile?.role, isTeacher, isParent })

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-6 relative">
      <div className="theme-card border theme-border rounded-3xl shadow-xl w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-100 text-yellow-700">
          <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
        </div>
        <h1 className="text-display-md theme-text mb-2">{denial.title}</h1>
        <p className="theme-text-muted text-body-sm mb-6">{denial.body}</p>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          leadingIcon={<Icon as={ArrowLeft} size="sm" />}
          onClick={() => navigate(denial.actionPath)}
        >
          {denial.actionLabel}
        </Button>
      </div>
    </div>
  )
}
