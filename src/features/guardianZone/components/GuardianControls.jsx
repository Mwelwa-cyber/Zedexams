/**
 * GuardianControls — the switches, and the only writes in the zone.
 *
 * Three rows, and each one is honest about what it does:
 *
 *   Ask Zed             narrows CAPABILITY.AI_CHAT. Enforced server-side by
 *                       consentGuard on every gated call, not by hiding a
 *                       button — a Families reviewer tests the API, not the UI.
 *   Live challenges     narrows CAPABILITY.SOCIAL, which today is Race Zed.
 *   Daily time limit    ADVISORY, and labelled as such. It is a nudge the
 *                       child's app shows, not a capability, because a server
 *                       that hard-stopped a child mid-question at minute 90
 *                       would lose their answer to enforce a preference. A
 *                       control that claims to be a lock and is not is worse
 *                       than no control.
 *
 * Every change posts the PIN with it. There is no unlocked session on the
 * server, so a change made an hour after the PIN was typed is verified exactly
 * as the first one was.
 *
 * Optimism is deliberate and bounded: the switch moves at once and rolls back
 * on failure, because a toggle that waits on a round trip on a Zambian mobile
 * connection reads as broken.
 */

import { useCallback, useState } from 'react'
import { Bot, Swords, Timer } from 'lucide-react'
import { DAILY_LIMIT_OPTIONS, normalizeGuardianControls } from '../../../utils/guardianControls'
import { formatDailyLimit } from '../lib/parentalGateCore'
import { saveGuardianControls, guardianZoneErrorMessage } from '../services/guardianZoneService'

export default function GuardianControls({ childName, controls, pin, onSaved }) {
  const current = normalizeGuardianControls(controls)
  const [draft, setDraft] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = !pin

  const commit = useCallback(async (next) => {
    const previous = draft
    setDraft(next)          // optimistic
    setBusy(true)
    setError('')
    try {
      const res = await saveGuardianControls({ pin, controls: next })
      // The SERVER's normalised copy wins over our optimistic one: it is what
      // actually landed on the document, and it is what the child's app will
      // read back.
      const saved = normalizeGuardianControls(res?.controls ?? next)
      setDraft(saved)
      onSaved?.(saved)
    } catch (err) {
      setDraft(previous)    // roll back — the switch must not lie
      setError(guardianZoneErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [draft, pin, onSaved])

  const name = childName || 'this account'

  return (
    <>
      <div className="gz-head">What {name} can do</div>
      <div className="gz-group">
        <ControlRow
          icon={<Bot size={19} aria-hidden="true" />}
          title="Ask Zed helper"
          desc="AI study answers, online only"
          checked={draft.askZed}
          disabled={busy || locked}
          locked={locked}
          onChange={(v) => commit({ ...draft, askZed: v })}
        />
        <ControlRow
          icon={<Swords size={19} aria-hidden="true" />}
          title="Live challenges"
          desc="Race the ZedExams robot — no chatting with other children, ever"
          checked={draft.challenges}
          disabled={busy || locked}
          locked={locked}
          onChange={(v) => commit({ ...draft, challenges: v })}
        />

        <div className={`gz-row${locked ? ' is-locked' : ''}`}>
          <div className="gz-ic"><Timer size={19} aria-hidden="true" /></div>
          <div className="gz-row-main">
            <div className="gz-row-title">Daily time limit</div>
            <div className="gz-row-desc">
              A reminder shown to {name} once they reach it. It does not close the
              app mid-question.
            </div>
          </div>
          <div className="gz-row-val">{formatDailyLimit(draft.dailyLimitMinutes)}</div>
        </div>

        <div className="gz-limits" role="group" aria-label="Daily time limit">
          {DAILY_LIMIT_OPTIONS.map((minutes) => (
            <button
              key={String(minutes)}
              type="button"
              className="lhx-pick"
              aria-pressed={draft.dailyLimitMinutes === minutes}
              disabled={busy || locked}
              onClick={() => commit({ ...draft, dailyLimitMinutes: minutes })}
            >
              {formatDailyLimit(minutes)}
            </button>
          ))}
        </div>
      </div>

      {locked && (
        <p className="gz-note">
          Enter the Guardian PIN above to change these. They are stored on our
          servers and applied to every device {name} signs in on — not just this one.
        </p>
      )}
      {error && <p className="gz-error" role="alert">{error}</p>}
    </>
  )
}

function ControlRow({ icon, title, desc, checked, disabled, locked, onChange }) {
  return (
    <div className={`gz-row${locked ? ' is-locked' : ''}`}>
      <div className="gz-ic">{icon}</div>
      <div className="gz-row-main">
        <div className="gz-row-title">{title}</div>
        <div className="gz-row-desc">{desc}</div>
      </div>
      <button
        type="button"
        className="lhx-switch"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}
