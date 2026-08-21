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
 *
 * `pollLencoStatus` resolves to a STATUS STRING — 'successful', 'failed',
 * or 'pending' when its two-minute window closes without an answer. This
 * component used to read `.status` off it, so EVERY outcome fell through to
 * the failure arm: a parent whose payment had gone through was told it had
 * not, `onPaid` never fired, and the child stayed locked while the money had
 * left the account. Both subscription checkouts (UpgradeModal, TopUpModal)
 * read the string; this is now the third.
 *
 * The rule that survives that bug: **only Lenco's own 'failed' may be
 * reported as a failure.** Everything else — a closed poll window, a
 * dropped request, an unknown status — is UNSETTLED, because a parent
 * told "nothing has been charged" about a payment that went through pays
 * a second time.
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
import MobileMoneyMark from '../../../shared/components/MobileMoneyMark'

// Zamtel is offered by the server but the prototype shows two; all three
// are listed because refusing a network somebody actually uses is worse
// than one extra button.
const METHODS = OPERATORS

// The short name under each mark. `OPERATORS[].label` is the full
// product name ("Zamtel Kwacha"), which at a third of a 360px screen
// wraps to two lines and pushes the three tiles out of alignment — the
// mark above it already carries the brand, so the tile only needs the
// word that distinguishes the three.
const SHORT_LABEL = {
  mtn: 'MTN',
  airtel: 'Airtel',
  zamtel: 'Zamtel',
}

// The only wording that may claim nothing was taken. Reserved for Lenco
// saying 'failed' and nothing else.
const DECLINED =
  'That payment did not go through. Nothing has been charged — you can try again.'

// …and the wording for everything we are merely unsure about. It never
// claims either way, because the webhook settles the payment whether this
// screen is still watching or not.
const UNSETTLED =
  'We have not heard back from your network yet. If you approved the prompt ' +
  'on your phone the payment will still go through — check again in a minute.'

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
  // idle | starting | waiting | pending | otp | done | error
  //   waiting — the prompt is live on the phone and we are polling
  //   pending — the poll window closed with no answer; NOT a failure
  const [stage, setStage] = useState('idle')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [payment, setPayment] = useState(null)
  const [otp, setOtp] = useState('')
  const abortRef = useRef(null)

  // Stop polling if the parent navigates away mid-payment — the webhook
  // still settles it, so an abandoned poll costs the purchase nothing.
  useEffect(() => () => { abortRef.current?.abort?.() }, [])

  const resolvedOperator = operatorTouched ? operator : (detectOperator(phone) || operator)

  const watch = useCallback(async (paymentId, { maxAttempts } = {}) => {
    if (!paymentId) return
    const controller = new AbortController()
    abortRef.current = controller
    setChecking(true)
    try {
      // A STATUS STRING, not an object — see the header.
      const status = await pollLencoStatus(paymentId, {
        signal: controller.signal,
        ...(maxAttempts ? { maxAttempts } : {}),
      })
      if (controller.signal.aborted) return
      if (status === 'successful') {
        setStage('done')
        setMessage('')
        capture('guardian_payment_succeeded', { planId: plan?.id })
        onPaid?.()
        return
      }
      if (status === 'failed') {
        setStage('error')
        setMessage(DECLINED)
        return
      }
      // 'pending' — our window closed before the network answered. A
      // mobile-money prompt routinely outlives two minutes, and the
      // webhook settles it either way, so this is a screen the parent can
      // re-check, not a refusal.
      setStage('pending')
      setMessage(UNSETTLED)
    } catch (err) {
      if (controller.signal.aborted) return
      reportClientError(err, 'guardianCheckout.poll')
      // A poll that fails is NOT a payment that failed: the webhook is
      // what settles it, so say so rather than telling a parent their
      // money is gone.
      setStage('pending')
      setMessage(UNSETTLED)
    } finally {
      if (!controller.signal.aborted) setChecking(false)
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

  if (stage === 'pending') {
    return (
      <div className="lhx-card" style={{ padding: 16 }}>
        <p className="lhx-set-title">Waiting on your network</p>
        <p className="lhx-set-desc" style={{ marginTop: 6, lineHeight: 1.5 }} role="status">
          {message}
        </p>
        {/* Re-READS the same reference. It never initiates, so a parent
            tapping it while the first prompt is still live cannot be
            charged twice. */}
        <button
          type="button"
          className="lhx-btn lhx-btn-primary lhx-btn-block"
          onClick={() => watch(payment?.paymentId, { maxAttempts: 4 })}
          disabled={checking || !payment?.paymentId}
        >
          {checking ? 'Checking…' : 'Check payment status'}
        </button>
        <button
          type="button"
          className="lhx-btn lhx-btn-soft lhx-btn-block"
          onClick={() => { setStage('idle'); setMessage(''); setPayment(null) }}
          disabled={checking}
        >
          Use a different number
        </button>
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

  const autoDetected = !operatorTouched && Boolean(detectOperator(phone))
  const chosen = METHODS.find((m) => m.id === resolvedOperator) || null

  return (
    <form onSubmit={pay}>
      {/* A numbered pair of steps rather than one undifferentiated block.
          The picker and the phone field used to sit under a single "Pay
          with mobile money" heading with nothing saying that the first
          was a choice and the second was an entry — at phone width that
          reads as three bold words above a text box. */}
      <h2 className="lhx-set-head">1 · Choose your network</h2>
      <div className="pax-pay-methods" role="radiogroup" aria-label="Mobile money network">
        {METHODS.map((m) => {
          const selected = resolvedOperator === m.id
          return (
            <button
              type="button"
              key={m.id}
              role="radio"
              aria-checked={selected}
              /* The full product name, for a screen reader and for the
                 tooltip — the tile itself shows the short one. */
              aria-label={m.label}
              title={m.label}
              className={`pax-pay ${selected ? 'is-selected' : ''}`}
              onClick={() => { setOperator(m.id); setOperatorTouched(true) }}
            >
              <MobileMoneyMark operator={m.id} />
              <span className="pax-pay-name">{SHORT_LABEL[m.id] || m.label}</span>
            </button>
          )
        })}
      </div>

      <h2 className="lhx-set-head">2 · Your mobile money number</h2>
      <label className="sr-only" htmlFor="pax-phone">Mobile money number</label>
      <input
        id="pax-phone"
        className="pax-field"
        inputMode="numeric"
        autoComplete="tel"
        placeholder="e.g. 0977 740 465"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value)
          // Clear the MESSAGE too. Dropping only the stage left the
          // refusal sitting under the button while the field it named was
          // being corrected.
          if (stage === 'error') { setStage('idle'); setMessage('') }
        }}
      />

      {/* The network is picked from the number's prefix as it is typed,
          and always has been — silently, so a parent who never tapped a
          tile had no way to know which network was about to be charged,
          or that anything had been decided at all. Saying it is the
          difference between a highlighted tile that looks like a stray
          tap and one that looks like an answer. */}
      {autoDetected && chosen && (
        <p className="pax-pay-detected" role="status">
          {/* No indefinite article, deliberately: the sentence has to
              read correctly in front of all three names, and "a Airtel
              Money number" / "an MTN MoMo number" cannot both come out
              of one template. Naming the action rather than the noun
              also says the more useful thing — what is about to
              happen. */}
          Charging <b>{chosen.label}</b> — tap another network above if that is not right.
        </p>
      )}

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
