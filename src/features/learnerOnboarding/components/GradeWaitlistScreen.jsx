/**
 * GradeWaitlistScreen — what a learner sees when their grade exists in the
 * curriculum but has not opened yet.
 *
 * The screen this replaces is the one we would have shipped by accident.
 * Narrowing the wizard's grade list on its own bounces an existing Grade 5
 * learner back into onboarding, where the only grade on offer is 7 — so a
 * rollout decision silently rewrites a child's profile. This screen exists so
 * that the grade is kept and the choice is theirs.
 *
 * Two rules the copy holds to:
 *
 *   1. IT PROMISES NOTHING WE HAVE NOT BUILT. There is no "we'll email you the
 *      moment it opens", because nothing sends that email. What it says is
 *      true today: the account is saved and the grade is kept.
 *
 *   2. IT IS NEVER A DEAD END. Two ways out — change grade (which reaches the
 *      wizard, the one place a grade is chosen) and sign out. A screen a child
 *      cannot leave is the failure mode `LearnerOnlyRoute` was careful about
 *      for teachers, and it applies here too.
 */
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import { Clock, ArrowRight, LogOut } from '../../../shared/components/icons'
import { LEARNER_GRADES } from '../../../config/curriculum'

/** "Grade 7" / "Grade 4 and Grade 5" / "Grades 4, 5 and 7" — for the copy. */
function liveGradeList() {
  const labels = LEARNER_GRADES.map((g) => `Grade ${g}`)
  if (labels.length <= 1) return labels[0] ?? 'another grade'
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

export default function GradeWaitlistScreen() {
  const { userProfile, logout } = useAuth()
  const navigate = useNavigate()
  const grade = userProfile?.grade

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-6">
      <div className="theme-card border theme-border rounded-3xl shadow-xl w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
          <Icon as={Clock} size="lg" strokeWidth={2.1} />
        </div>

        <h1 className="text-display-md theme-text mb-2">
          {grade ? `Grade ${grade} is coming soon` : 'Your grade is coming soon'}
        </h1>

        <p className="theme-text-muted text-body-sm mb-2">
          We’re building {grade ? `Grade ${grade}` : 'your grade'}’s lessons, quizzes and
          exam papers right now, and we’d rather open it with real work in it than open it empty.
        </p>
        <p className="theme-text-muted text-body-sm mb-6">
          Your account is saved and your grade is kept — nothing is lost. {liveGradeList()} is
          ready today if you’d like to study there in the meantime.
        </p>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          trailingIcon={<Icon as={ArrowRight} size="sm" />}
          onClick={() => navigate('/setup?step=grade')}
        >
          Change my grade
        </Button>

        <Button
          variant="ghost"
          size="md"
          fullWidth
          className="mt-3"
          leadingIcon={<Icon as={LogOut} size="sm" />}
          onClick={() => logout()}
        >
          Sign out
        </Button>
      </div>
    </div>
  )
}
