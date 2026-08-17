/**
 * GuardianPinPanel — establishing and entering the Guardian PIN.
 *
 * Two modes, chosen by `guardianZoneStatus`, never guessed:
 *
 *   no PIN yet  — "send my guardian a code", then code + new PIN. The code
 *                 goes to the address the consent flow already verified, and
 *                 that inbox is the one asymmetry we have against a child who
 *                 is holding the phone. There is deliberately no route to a
 *                 first PIN without it.
 *   PIN exists  — enter it. The five-attempt lockout lives on the server; this
 *                 surfaces the refusal rather than counting alongside it, so
 *                 the UI can never disagree with the enforcement.
 *
 * The PIN is held in the parent component's memory for the session and passed
 * back with every write. It is never written to localStorage, sessionStorage
 * or a cookie: the device belongs to the child, and a PIN cached on it is a
 * PIN the child can read out of devtools.
 */

import { useCallback, useState } from 'react'
import { KeyRound, MailCheck } from 'lucide-react'
import {
  requestGuardianPinSetup,
  setGuardianPin,
  verifyGuardianPin,
  guardianZoneErrorMessage,
} from '../services/guardianZoneService'
import { isWellFormedGuardianPin } from '../../../utils/guardianControls'

export default function GuardianPinPanel({ status, onUnlocked, onStatusChange }) {
  const hasPin = Boolean(status?.hasPin)
  return hasPin
    ? <EnterPin onUnlocked={onUnlocked} onStatusChange={onStatusChange} />
    : <SetUpPin status={status} onUnlocked={onUnlocked} onStatusChange={onStatusChange} />
}

// ── enter an existing PIN ─────────────────────────────────────────────────

function EnterPin({ onUnlocked, onStatusChange }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forgot, setForgot] = useState(false)

  const submit = useCallback(async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await verifyGuardianPin(pin)
      // The PIN itself travels up, because every subsequent write re-verifies
      // it server-side. There is no "unlocked" session on the server, and that
      // is deliberate: a session token stored on the child's device would be
      // the thing worth stealing.
      onUnlocked?.(pin)
    } catch (err) {
      setError(guardianZoneErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [pin, onUnlocked])

  if (forgot) {
    return <SetUpPin forgotten onUnlocked={onUnlocked} onStatusChange={onStatusChange} onCancel={() => setForgot(false)} />
  }

  return (
    <form className="gz-pin" onSubmit={submit}>
      <div className="gz-pin-title">Enter the Guardian PIN</div>
      <p className="gz-pin-desc">
        Progress is visible without it. The PIN is only needed to change what this
        account can do.
      </p>
      <div className="gz-pin-fields">
        <div className="gz-pin-field">
          <label className="gz-pin-label" htmlFor="gz-pin">Guardian PIN</label>
          <input
            id="gz-pin"
            className="gz-pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>
      {error && <p className="gz-error" role="alert">{error}</p>}
      <div className="gz-pin-actions">
        <button type="submit" className="lhx-btn lhx-btn-primary" disabled={busy || pin.length < 4}>
          {busy ? 'Checking…' : 'Unlock controls'}
        </button>
      </div>
      <button type="button" className="gz-linkbtn" onClick={() => setForgot(true)}>
        Forgotten the PIN? Email a new code
      </button>
    </form>
  )
}

// ── set a first PIN, or reset a forgotten one ─────────────────────────────

function SetUpPin({ status, forgotten = false, onUnlocked, onStatusChange, onCancel }) {
  const [stage, setStage] = useState('idle') // idle → sent
  const [sentTo, setSentTo] = useState(status?.guardianContact || '')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canEmail = forgotten ? true : status?.canEmailCode !== false

  const sendCode = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const res = await requestGuardianPinSetup()
      setSentTo(res?.sentTo || '')
      setStage('sent')
    } catch (err) {
      setError(guardianZoneErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const submit = useCallback(async (event) => {
    event.preventDefault()
    if (!isWellFormedGuardianPin(pin)) {
      setError("Choose 4 to 6 digits that aren't 1234 or all the same digit.")
      return
    }
    setBusy(true)
    setError('')
    try {
      await setGuardianPin({ pin, code })
      onStatusChange?.({ hasPin: true })
      onUnlocked?.(pin)
    } catch (err) {
      setError(guardianZoneErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [pin, code, onUnlocked, onStatusChange])

  if (!canEmail) {
    // A guardian who approved over WhatsApp has no address on file, and we do
    // not invent one. Saying so beats a "send code" button that always fails.
    return (
      <div className="gz-pin">
        <div className="gz-pin-title">Controls need an email address</div>
        <p className="gz-pin-desc">
          This account was approved over WhatsApp, so we have no email address to
          send a code to. Progress below is fully visible. To change what the
          account can do, ask us to send a fresh approval by email from the
          learner&apos;s Settings → Parent &amp; guardian.
        </p>
      </div>
    )
  }

  return (
    <form className="gz-pin" onSubmit={submit}>
      <div className="gz-pin-title">
        {forgotten ? 'Reset the Guardian PIN' : 'Set up a Guardian PIN'}
      </div>
      <p className="gz-pin-desc">
        The PIN protects the controls from the person most likely to want them
        changed. We email a one-time code to the guardian who approved this
        account{sentTo ? '' : ''}; use it here to choose a PIN.
      </p>

      {stage === 'idle' ? (
        <>
          {error && <p className="gz-error" role="alert">{error}</p>}
          <div className="gz-pin-actions">
            <button type="button" className="lhx-btn lhx-btn-primary" onClick={sendCode} disabled={busy}>
              <MailCheck size={17} aria-hidden="true" />
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
            {onCancel && (
              <button type="button" className="lhx-btn lhx-btn-soft" onClick={onCancel}>
                Back
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="gz-ok" role="status">
            Code sent{sentTo ? ` to ${sentTo}` : ''}. It expires in 15 minutes.
          </p>
          <div className="gz-pin-fields">
            <div className="gz-pin-field">
              <label className="gz-pin-label" htmlFor="gz-code">Code from the email</label>
              <input
                id="gz-code"
                className="gz-pin-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="gz-pin-field">
              <label className="gz-pin-label" htmlFor="gz-newpin">Choose a PIN</label>
              <input
                id="gz-newpin"
                className="gz-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
          {error && <p className="gz-error" role="alert">{error}</p>}
          <div className="gz-pin-actions">
            <button type="submit" className="lhx-btn lhx-btn-primary" disabled={busy}>
              <KeyRound size={17} aria-hidden="true" />
              {busy ? 'Saving…' : 'Save PIN'}
            </button>
            <button type="button" className="lhx-btn lhx-btn-soft" onClick={sendCode} disabled={busy}>
              Resend code
            </button>
          </div>
        </>
      )}
    </form>
  )
}
