/**
 * LearnerErrorCard — the prototype's view-error, rendered inside the learner
 * shell when a page crashes: the "Oops" face, a calm explanation, Try again
 * and Go to Home. Mounted as the fallback of the ErrorBoundary in
 * LearnerLayout, so a broken page never blanks the navigation.
 *
 * "Your progress is safe" is a claim the app actually backs: quiz answers and
 * paper attempts persist to local drafts before results render, and Firestore
 * queues writes offline — a render crash loses none of that.
 */
import { useNavigate } from 'react-router-dom'

export default function LearnerErrorCard({ onRetry }) {
  const navigate = useNavigate()
  return (
    <div className="lhx-err" role="alert">
      <span className="lhx-err-face" aria-hidden="true">😵</span>
      <h1 className="lhx-err-title">Oops — something went wrong</h1>
      <p className="lhx-err-sub">
        We couldn’t load this right now. Check your connection and try again — your progress is safe.
      </p>
      <button type="button" className="lhx-btn lhx-btn-primary lhx-err-btn" onClick={onRetry}>
        ↻&nbsp; Try again
      </button>
      <button type="button" className="lhx-btn lhx-btn-white lhx-err-btn" onClick={() => navigate('/dashboard')}>
        Go to Home
      </button>
    </div>
  )
}
