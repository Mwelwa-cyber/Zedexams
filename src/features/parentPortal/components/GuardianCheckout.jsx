/**
 * GuardianCheckout — the parent pays, the child is credited.
 *
 * The one thing this component must never do is let a parent believe
 * they have bought something for a child when the money went somewhere
 * else. So `beneficiaryUid` is passed on every initiation and the
 * confirmation names the child; the server authorises the pairing
 * against `parentLinks` before charging anything, and refuses a
 * co-guardian (see functions/guardianBillingCore.js).
 *
 * Polling exists because the webhook is authoritative but not prompt: a
 * parent watching a spinner needs to be told when the prompt on their
 * phone has been approved. The poll grants nothing — it only reads.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  OPERATORS,
  detectOperator,
  initiateLencoPayment,
  looksLikeZambianPhone,
  pollLencoStatus,
  submitLencoOtp,
} from '../../../utils/lenco'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { capture } from '../../../utils/analytics'

// Zamtel is offered by the server but the prototype shows two; all three
// are listed because refusing a network somebody actually uses is worse
// than one extra button.
const METHODS = OPERATORS

export default function GuardianCheckout({
  plan,
  childUid,
  childName,
  guardianRequestId,
  disabled,
  onPaid,
}) {
  const [phone, setPhone] = useState('')
  const [operator, setOperator] = useState('')
  const [operatorTouched, setOperatorTouched] = useState(false)
  const [stage, setStage] = useState('idle') // idle | starting | waiting | otp | done | error
  const [message, setMessage] = useState('')
  const [payment, setPayment] = useState(null)
  const [otp, setOtp] = useState('')
  const abortRef = useRef(null)

  // Stop polling if the parent navigates away mid-payment — the webhook
  // still settles it, so an abandoned poll costs the purchase nothing.
  useEffect(() => () => { abortRef.current?.abort?.() }, [])

  const resolvedOperator = operatorTouched ? operator : (detectOperator(phone) || operator)

  const watch = useCallback(async (paymentId) => {
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const final = await pollLencoStatus(paymentId, { signal: controller.signal })
      if (final?.status === 'successful') {
        setStage('done')
        setMessage('')
        capture('guardian_payment_succeeded', { planId: plan?.id })
        onPaid?.()
      } else {
        setStage('error')
        setMessage('That payment did not go through. Nothing has been charged — you can try again.')
      }
    } catch (err) {
      if (controller.signal.aborted) return
      reportClientError(err, 'guardianCheckout.poll')
      // A poll that fails is NOT a payment that failed: the webhook is
      // what settles it, so say so rather than telling a parent their
      // money is gone.
      setStage('waiting')
      setMessage(
        'We lost track of this payment while waiting. If you approved it on ' +
        'your phone it will still go through — check back in a minute.',
      )
    }
  }, [onPaid, plan?.id])

  async function pay(e) {
    e.preventDefault()
    if (stage === 'starting' || stage === 'waiting') return

    if (!looksLikeZambianPhone(phone)) {
      setStage('error')
      setMessage('Enter a valid Zambian mobile number, e.g. 0977 740 465.')
      return
    }
    if (!resolvedOperator) {
      setStage('error')
      setMessage('Please choose which mobile money network to charge.')
      return
    }

    setStage('starting')
    setMessage('')
    try {
      const res = await initiateLencoPayment({
        planId: plan.checkoutPlanId || plan.id,
        method: 'mobile_money',
        phone,
        operator: resolvedOperator,
        // The two fields that make this a guardian purchase. Both are
        // re-checked server-side; neither is trusted as sent.
        beneficiaryUid: childUid,
        ...(guardianRequestId ? { guardianRequestId } : {}),
      })
      setPayment(res)
      capture('guardian_payment_started', { planId: plan?.id })

      if (res.alreadyPaid) {
        setStage('done')
        onPaid?.()
        return
      }
      if (res.requiresOtp) {
        setStage('otp')
        setMessage('Enter the one-time code your network just sent you.')
        return
      }
      setStage('waiting')
      setMessage(`Approve the prompt on ${phone} to finish.`)
      watch(res.paymentId)
    } catch (err) {
      reportClientError(err, 'guardianCheckout.initiate')
      setStage('error')
      setMessage(err?.message || 'We could not start that payment. Please try again.')
    }
  }

  async function sendOtp(e) {
    e.preventDefault()
    setStage('waiting')
    setMessage('Checking that code…')
    try {
      await submitLencoOtp({ paymentId: payment.paymentId, otp })
      setMessage(`Approve the prompt on ${phone} to finish.`)
      watch(payment.paymentId)
    } catch (err) {
      reportClientError(err, 'guardianCheckout.otp')
      setStage('otp')
      setMessage(err?.message || 'That code was not accepted. Try again.')
    }
  }

  if (stage === 'done') {
    return (
      <div className="lhx-card" style={{ padding: 16 }} role="status">
        <p className="lhx-set-title">{childName} is unlocked 🎉</p>
        <p className="lhx-set-desc" style={{ marginTop: 6, lineHeight: 1.5 }}>
          Everything on the {plan.name} plan is open on {childName}'s account
          now. Their streak, XP and badges are exactly where they left them.
        </p>
      </div>
    )
  }

  if (stage === 'otp') {
    return (
      <form className="lhx-card" style={{ padding: 16 }} onSubmit={sendOtp}>
        <label className="lhx-set-title" htmlFor="pax-otp">One-time code</label>
        <input
          id="pax-otp"
          className="pax-field"
          style={{ marginTop: 8 }}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
        />
        <button type="submit" className="lhx-btn lhx-btn-primary lhx-btn-block" disabled={!otp.trim()}>
          Confirm
        </button>
        {message && <p className="pax-note" role="status">{message}</p>}
      </form>
    )
  }

  return (
    <form onSubmit={pay}>
      <h2 className="lhx-set-head">Pay with mobile money</h2>
      <div className="pax-pay-methods">
        {METHODS.map((m) => (
          <button
            type="button"
            key={m.id}
            className={`pax-pay ${resolvedOperator === m.id ? 'is-selected' : ''}`}
            aria-pressed={resolvedOperator === m.id}
            onClick={() => { setOperator(m.id); setOperatorTouched(true) }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="sr-only" htmlFor="pax-phone">Mobile money number</label>
      <input
        id="pax-phone"
        className="pax-field"
        inputMode="numeric"
        autoComplete="tel"
        placeholder="Mobile money number (e.g. 0977 740 465)"
        value={phone}
        onChange={(e) => { setPhone(e.target.value); if (stage === 'error') setStage('idle') }}
      />

      <button
        type="submit"
        className="lhx-btn lhx-btn-primary lhx-btn-block"
        disabled={disabled || stage === 'starting' || stage === 'waiting'}
      >
        {stage === 'starting' || stage === 'waiting' ?
          'Waiting for your phone…' :
          `Pay K${plan.priceZMW} · unlock for ${childName}`}
      </button>

      <p className="pax-note" role={stage === 'error' ? 'alert' : 'status'}>
        {message || `🔒 Secured by Lenco. This pays for ${childName}'s account, not yours.`}
      </p>
    </form>
  )
}
