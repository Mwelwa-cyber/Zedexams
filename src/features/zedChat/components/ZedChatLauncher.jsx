/**
 * ZedChatLauncher — the floating "Ask Zed" pill (prototype-v5 #zed-fab,
 * learner redesign step 9).
 *
 * Mounted globally inside <App />. An indigo pill with Zed's face and
 * the words "Ask Zed", docked bottom-right above the learner tab bar
 * (right 16 / bottom 96 on phones; right 24 / bottom 24 on desktop —
 * the prototype's exact placement). Tapping it navigates to the
 * full-screen /ask-zed chat; the old slide-over panel is gone, because
 * the mockup's Ask Zed is a full view with its own header and return
 * path, not an overlay.
 *
 * Self-hides:
 *   - When the user isn't signed in (chat would just show "sign in").
 *   - On focused/immersive surfaces (runners, viewers, games, results)
 *     and non-learner areas — the prototype's fabHidden list, ported to
 *     routes in lib/askZedCore.js. Notably the pill DOES stay visible in
 *     the note reader, where it pairs with the inline "Stuck? Ask Zed
 *     about this" pill.
 */

import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { canLearnerUse, CAPABILITY } from '../../../utils/guardianConsent'
import { shouldHideFab } from '../lib/askZedCore'
import '../askZed.css'

const ZED_ART = '/images/characters/poses/zed-waving.webp'

export default function ZedChatLauncher() {
  const { currentUser, userProfile } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  if (!currentUser) return null
  if (shouldHideFab(pathname)) return null
  // The guardian's switch, and limited mode, reach the pill.
  //
  // This is a COURTESY, not the enforcement: `assertLearnerCapability` refuses
  // the call server-side whether or not the button is on screen, which is what
  // a Families reviewer tests. What hiding it buys is that a child whose parent
  // switched Ask Zed off does not tap a button that then apologises — the same
  // reasoning as the consent banner, which explains a refusal rather than
  // creating one.
  if (!canLearnerUse(CAPABILITY.AI_CHAT, userProfile)) return null

  return (
    <button
      type="button"
      className="lhx-zed-fab"
      aria-label="Ask Zed, your study helper"
      onClick={() => navigate('/ask-zed')}
    >
      <img src={ZED_ART} alt="" aria-hidden="true" />
      <span>Ask&nbsp;Zed</span>
    </button>
  )
}
