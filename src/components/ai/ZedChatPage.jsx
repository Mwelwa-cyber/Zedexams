/**
 * /ask-zed — full-page Zed chat. Same component as the slide-over
 * launcher (audit A6), just rendered without an onClose handler so the
 * UI doesn't show the close button. Useful when:
 *   - A learner wants more screen space than the slide-over.
 *   - A teacher links the page directly from a lesson plan.
 *   - We add Zed to the marketing page CTA later — deep-link target.
 */

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import SeoHelmet from '../seo/SeoHelmet'
import ZedChat from './ZedChat'

export default function ZedChatPage() {
  const { currentUser, loading } = useAuth()

  if (loading) return null
  // Auth required. The launcher self-hides on the welcome route, so a
  // signed-out visitor reaching /ask-zed directly bounces to login with
  // the original target preserved.
  if (!currentUser) {
    return <Navigate to="/login?next=/ask-zed" replace />
  }

  return (
    <>
      <SeoHelmet
        title="Ask Zed"
        description="Chat with Zed, your CBC-aligned AI study buddy. Ask questions about Maths, English, Science and more — get clear, friendly answers any time."
        path="/ask-zed"
      />
      <div className="min-h-screen theme-bg flex flex-col">
        <div className="flex-1 max-w-3xl w-full mx-auto flex flex-col">
          <ZedChat mode="page" />
        </div>
      </div>
    </>
  )
}
