import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../../shared/components/Button'
import Icon from '../../shared/components/Icon'
import FullScreenLoader from '../../shared/components/FullScreenLoader'
import { Sparkles, ArrowLeft } from '../../shared/components/icons'

export default function LearnerOnlyRoute({ children }) {
  const { userProfile, loading, isAdmin, isLearner, isTeacher, canAccessLearnerPortal } = useAuth()
  const navigate = useNavigate()

  // Wait for the profile to load before evaluating role — otherwise a teacher
  // (or any non-learner) briefly renders the learner-only children while
  // userProfile is still null.
  if (loading || !userProfile) return <FullScreenLoader label="Loading your dashboard…" />

  // Admins and learners always pass through.
  if (isAdmin || isLearner) return children

  // Any other role with learner-portal access (e.g. parents on a premium plan)
  // passes through. Teachers are intentionally excluded — the two portals are
  // fully separate, so a teacher account can never access the learner side.
  if (!isTeacher && canAccessLearnerPortal) return children

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-6 relative">
      <div className="theme-card border theme-border rounded-3xl shadow-xl w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-100 text-yellow-700">
          <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
        </div>
        <h1 className="text-display-md theme-text mb-2">Teacher accounts stay in the teacher portal</h1>
        <p className="theme-text-muted text-body-sm mb-6">
          The teacher and learner experiences are separate. Your teacher account
          works from the teacher portal — the learner dashboard, quizzes, lessons
          and exams aren’t part of it.
        </p>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          leadingIcon={<Icon as={ArrowLeft} size="sm" />}
          onClick={() => navigate('/teacher')}
        >
          Back to Teacher Portal
        </Button>
      </div>
    </div>
  )
}
