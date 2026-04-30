import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import UpgradeModal from '../subscription/UpgradeModal'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Sparkles, ArrowLeft } from '../ui/icons'

export default function LearnerOnlyRoute({ children }) {
  const { userProfile, isAdmin, isLearner, canAccessLearnerPortal } = useAuth()
  const navigate = useNavigate()
  const [showUpgrade, setShowUpgrade] = useState(true)

  if (!userProfile) return children

  // Admins and learners always pass through.
  if (isAdmin || isLearner) return children

  // Teachers must have a SEPARATE active learner-portal subscription. Their
  // teacher-portal premium does NOT grant learner access.
  if (canAccessLearnerPortal) return children

  return (
    <>
      <div className="min-h-screen theme-bg flex items-center justify-center p-6 relative">
        <div className="theme-card border theme-border rounded-3xl shadow-xl w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-100 text-yellow-700">
            <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
          </div>
          <h1 className="text-display-md theme-text mb-2">Learner Portal Subscription Required</h1>
          <p className="theme-text-muted text-body-sm mb-6">
            Your teacher account doesn’t include the learner portal. Subscribe to the
            learner portal to access the learner dashboard, quizzes, lessons and exams.
          </p>
          <div className="flex flex-col gap-3">
            <Button variant="primary" size="lg" fullWidth onClick={() => setShowUpgrade(true)}>
              Subscribe to Learner Portal
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leadingIcon={<Icon as={ArrowLeft} size="sm" />}
              onClick={() => navigate('/teacher')}
            >
              Back to Teacher Portal
            </Button>
          </div>
        </div>
      </div>
      {showUpgrade && (
        <UpgradeModal
          portal="learner"
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </>
  )
}
