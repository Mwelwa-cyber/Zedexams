/**
 * /ask-zed — the full-screen Ask Zed chat (prototype-v5 #view-askzed,
 * learner redesign step 9). The floating pill and the note reader's
 * "Stuck? Ask Zed about this" pill both land here; `?topic=…` carries
 * the note context so the greeting and suggestion chips are about what
 * the learner was just reading (the prototype's openAskZed({type:'note'})).
 *
 * The back button returns to wherever the learner came from — the
 * prototype's azReturn — via history; a direct deep link with no
 * history falls back to Home.
 */

import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ZedChat from '../components/ZedChat'
import '../../../shared/styles/learnerTheme.css'
import '../askZed.css'

export default function ZedChatPage() {
  const { currentUser, loading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const topic = (searchParams.get('topic') || '').trim() || null

  if (loading) return null
  // Auth required. A signed-out visitor reaching /ask-zed directly
  // bounces to login with the original target preserved.
  if (!currentUser) {
    return <Navigate to="/login?next=/ask-zed" replace />
  }

  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/dashboard')
  }

  return (
    <div className="lhx lhx-az">
      <SeoHelmet
        title="Ask Zed"
        description="Chat with Zed, your friendly study helper. Ask questions about Maths, English, Science and more — get clear, simple answers any time."
        path="/ask-zed"
      />
      <ZedChat topic={topic} onBack={goBack} />
    </div>
  )
}
