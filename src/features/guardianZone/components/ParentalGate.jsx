/**
 * ParentalGate — "ask a grown-up" before the Guardian Zone opens.
 *
 * Friction, not authentication. The decision logic is in
 * lib/parentalGateCore.js and says so at length; what this component adds is
 * the honesty of the copy. It tells the child, in the room, that this is a
 * parents' area — which is most of what a gate like this actually achieves —
 * and it does NOT claim to be secure, because the controls behind it are
 * protected by a PIN the child cannot obtain, and that is the claim we can
 * actually keep.
 *
 * A wrong answer draws a NEW sum. Otherwise the gate is one fixed question per
 * mount, and a child who gets it wrong once has learned the answer.
 */

import { useCallback, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { makeGateChallenge, checkGateAnswer } from '../lib/parentalGateCore'

export default function ParentalGate({ onPass }) {
  const [challenge, setChallenge] = useState(() => makeGateChallenge())
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)
  const inputRef = useRef(null)

  const submit = useCallback((event) => {
    event?.preventDefault?.()
    if (checkGateAnswer(value, challenge)) {
      onPass?.()
      return
    }
    // A new sum, not a retry of the same one.
    setChallenge(makeGateChallenge())
    setValue('')
    setWrong(true)
    inputRef.current?.focus()
  }, [value, challenge, onPass])

  return (
    <form className="gz-gate" onSubmit={submit}>
      <div className="gz-lock" aria-hidden="true"><Lock size={26} strokeWidth={2.4} /></div>
      <h2>Ask a grown-up</h2>
      <p>
        This area is for parents and guardians. Answer the question to continue.
      </p>

      <div className="gz-q" id="gz-gate-question">{challenge.prompt}</div>
      <label className="sr-only" htmlFor="gz-gate-answer">{challenge.prompt}</label>
      <input
        id="gz-gate-answer"
        ref={inputRef}
        className="gz-input"
        // `inputMode` rather than `type="number"`: a number input on Android
        // brings spinners and accepts "e", and this field takes exactly the
        // digits of a product.
        inputMode="numeric"
        autoComplete="off"
        aria-describedby={wrong ? 'gz-gate-error' : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="?"
      />

      {wrong && (
        <p className="gz-error" id="gz-gate-error" role="status">
          Not quite — here is another one.
        </p>
      )}

      <button type="submit" className="lhx-btn lhx-btn-primary" style={{ maxWidth: 220 }}>
        Continue
      </button>

      <p className="gz-note">
        This is a friendly check, not a password. The controls inside are protected
        by a Guardian PIN, and the code to set that PIN is emailed to the guardian
        who approved this account.
      </p>
    </form>
  )
}
