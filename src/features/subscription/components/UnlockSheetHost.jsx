/**
 * UnlockSheetHost — the single mount for the contextual unlock sheet.
 *
 * Mounted once at the app root and otherwise inert: it renders nothing until
 * something calls `unlockSheet.open`, which only `useUnlockFlow.requestUnlock`
 * does, which only a tapped lock does. Same host-plus-bus shape as the
 * existing `PaywallHost`, so there is one overlay owner rather than a sheet
 * per screen that can stack on its neighbour.
 *
 * It also installs the `interruption_suppressed` bridge, because this is the
 * one component guaranteed to be mounted for the whole session. Proving the
 * caps fire matters as much as the caps: a surface that stopped appearing
 * because of a bug and one that stopped because a cooldown fired look
 * identical in the funnel without it.
 */

import { useEffect, useState } from 'react'
import { interruptionBudget, onSuppressed, unlockSheet, useUnlockFlow } from '../../../services/entitlements'
import { useAuth } from '../../../contexts/AuthContext'
import { capture } from '../../../utils/analytics'
import ContextualUnlockSheet from './ContextualUnlockSheet'

export default function UnlockSheetHost() {
  const [request, setRequest] = useState(null)
  const { closeUnlock } = useUnlockFlow()
  const { userProfile, updateProfileFields } = useAuth()

  useEffect(() => unlockSheet.subscribe(setRequest), [])

  useEffect(() => onSuppressed(({ surface, reason }) => {
    capture('interruption_suppressed', { surface, reason })
  }), [])

  // Cross-device cooldowns. The budget's own copy is localStorage, which
  // survives offline and works signed-out; this mirrors it onto the profile so
  // the 24h / 7d / 72h promises hold across devices — a cooldown that resets
  // when the learner opens the app on their mother's phone is not a cooldown.
  //
  // Stored as ONE field on users/{uid} rather than a subcollection: the
  // profile's self-update rule is a blocklist, so a new key needs no rules
  // change, and AuthContext already subscribes to the doc so the hydrate
  // arrives without a second listener. `hydrate` merges rather than
  // overwrites — see that method for why a fresh device must not be able to
  // wipe a cooldown just by signing in.
  useEffect(() => {
    if (!userProfile) return
    interruptionBudget.hydrate(userProfile.interruptions)
  }, [userProfile])

  useEffect(() => {
    if (!userProfile) {
      interruptionBudget.setRemoteSync(null)
      return undefined
    }
    interruptionBudget.setRemoteSync((patch) => updateProfileFields({ interruptions: patch }))
    return () => interruptionBudget.setRemoteSync(null)
  }, [userProfile, updateProfileFields])

  if (!request) return null

  return (
    <ContextualUnlockSheet
      gate={request.gate}
      route={request.route}
      context={request.context}
      onClose={() => closeUnlock(request.gate)}
    />
  )
}
