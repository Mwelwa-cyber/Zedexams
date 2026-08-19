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
 *   - For a parent account, everywhere. Ask Zed is the learner's helper,
 *     not the household's; see shouldHideFabForRole.
 *   - On focused/immersive surfaces (runners, viewers, games, results)
 *     and non-learner areas — the prototype's fabHidden list, ported to
 *     routes in lib/askZedCore.js. Notably the pill DOES stay visible in
 *     the note reader, where it pairs with the inline "Stuck? Ask Zed
 *     about this" pill.
 *   - When the learner has turned Ask Zed off in Settings, OR when their
 *     guardian has turned it off in the Guardian Zone. Both answers come
 *     from `isAllowed`, which composes them the way the guardian control
 *     is specified: the guardian's OFF wins, and the guardian's ON does
 *     not override a child who switched it off themselves.
 *
 *     This is a COURTESY, not the enforcement. `consentGuard.
 *     assertLearnerCapability` refuses the chat turn server-side whether
 *     or not this pill renders — which is what a Families reviewer tests,
 *     and what a modified client cannot get around. What hiding the pill
 *     buys is that a child whose parent switched Ask Zed off does not tap
 *     a button that then apologises: the refusal is real either way, and
 *     meeting it mid-conversation is a worse way to learn about it.
 */

import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import { isAllowed } from '../../../utils/guardianControls'
import { shouldHideFab, shouldHideFabForRole } from '../lib/askZedCore'
import '../askZed.css'

const ZED_ART = '/images/characters/poses/zed-waving.webp'

export default function ZedChatLauncher() {
  const { currentUser, userProfile } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // Called before every early return: a hook cannot be conditional, and
  // the returns below depend on props/route rather than on this value.
  const hidden = useHideOnScroll()

  if (!currentUser) return null
  // A parent never gets the pill, on any route. See shouldHideFabForRole —
  // Ask Zed is metered against a LEARNER's allowance and prompted for a
  // child, so a guardian tapping it spends their child's quota on an
  // answer written for their child. Help for a parent is Account → Help
  // & support.
  if (shouldHideFabForRole(userProfile?.role)) return null
  if (shouldHideFab(pathname)) return null
  // Settings → Learning → "Ask Zed" is the learner's own switch; the
  // Guardian Zone's is their guardian's. `isAllowed` is the one place the
  // two are combined, so the pill cannot disagree with the server.
  const learnerChoice = userProfile?.learnerSettings?.zedAi?.enabled !== false
  if (!isAllowed(userProfile, 'askZed', learnerChoice)) return null

  return (
    <button
      type="button"
      className={`lhx-zed-fab ${hidden ? 'is-hidden' : ''}`}
      aria-label="Ask Zed, your study helper"
      tabIndex={hidden ? -1 : 0}
      onClick={() => navigate('/ask-zed')}
    >
      <img src={ZED_ART} alt="" aria-hidden="true" />
      <span>Ask&nbsp;Zed</span>
    </button>
  )
}
