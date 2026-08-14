import { useState } from 'react'
import { Check, Loader2, Lock } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'

// PaymentStatusTracker — the pending-payment lifecycle inside the Lenco
// checkout, shown from the moment a mobile-money prompt is sent until the
// payment reaches a terminal state:
//
//   waiting   → "Check your phone": the prompt is live; approve with the
//               mobile-money PIN. Shows the reference, network and amount.
//   verifying → after "I have approved" (or while we re-check): progress
//               timeline + "do not close this window".
//   timedOut  → the poll window elapsed with no confirmation: the payment
//               may still be processing, so the ONLY safe actions are
//               re-checking the existing transaction or contacting support —
//               never starting a new payment.
//
// Verification is automatic throughout (the parent polls the status
// callable; the signed webhook remains authoritative) — "I have approved"
// only advances the visual stage, it is never the confirmation mechanism.
// Cancelling asks for confirmation first: a prompt already approved on the
// phone cannot be un-approved by closing this window.

const SUPPORT_EMAIL = 'support@zedexams.com'
const SUPPORT_WHATSAPP_HREF = 'https://wa.me/260977740465'

function TimelineStep({ state, label }) {
  // State is conveyed by icon + text, never colour alone.
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {state === 'done' && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
          <Icon as={Check} size="xs" strokeWidth={2.6} />
        </span>
      )}
      {state === 'current' && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
          <Icon as={Loader2} size="xs" className="animate-spin" />
        </span>
      )}
      {state === 'pending' && (
        <span
          className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-200"
          aria-hidden="true"
        />
      )}
      <span className={state === 'pending' ? 'text-gray-400' : 'font-semibold text-gray-800'}>
        {label}
        <span className="sr-only">
          {state === 'done' ? ' — completed' : state === 'current' ? ' — in progress' : ' — not started'}
        </span>
      </span>
    </li>
  )
}

function DetailsCard({ reference, operatorLabel, amountZMW, statusLabel }) {
  return (
    <dl className="rounded-2xl bg-orange-50/70 border border-orange-100 px-4 py-3 text-sm text-left">
      <div className="flex justify-between gap-3 py-0.5">
        <dt className="text-gray-500">Payment reference</dt>
        <dd className="font-mono font-semibold text-gray-800 break-all text-right">{reference}</dd>
      </div>
      {operatorLabel && (
        <div className="flex justify-between gap-3 py-0.5">
          <dt className="text-gray-500">Network</dt>
          <dd className="font-semibold text-gray-800">{operatorLabel}</dd>
        </div>
      )}
      <div className="flex justify-between gap-3 py-0.5">
        <dt className="text-gray-500">Amount</dt>
        <dd className="font-semibold text-gray-800">K{amountZMW}</dd>
      </div>
      <div className="flex justify-between gap-3 py-0.5">
        <dt className="text-gray-500">Status</dt>
        <dd className="font-semibold text-gray-800">{statusLabel}</dd>
      </div>
    </dl>
  )
}

export default function PaymentStatusTracker({
  stage, // 'waiting' | 'verifying'
  timedOut,
  checking, // a manual status re-check is in flight
  phoneDisplay,
  reference,
  operatorLabel,
  amountZMW,
  onApproved,
  onCheckStatus,
  onCancelPayment,
}) {
  const [confirmCancel, setConfirmCancel] = useState(false)

  // ── Cancel confirmation ─────────────────────────────────────────
  if (confirmCancel) {
    return (
      <div className="text-center py-4" role="alertdialog" aria-labelledby="pst-cancel-title">
        <h3 id="pst-cancel-title" className="text-lg font-black text-gray-800">Cancel this payment?</h3>
        <p className="text-sm text-gray-600 mt-2">
          A payment request is currently pending. Cancelling this window will not automatically
          reverse a payment already approved on your phone — if you have approved it, your access
          will still unlock once it confirms.
        </p>
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => setConfirmCancel(false)}
            className="w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600"
          >
            Keep waiting
          </button>
          <button
            type="button"
            onClick={onCancelPayment}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:border-gray-400"
          >
            Cancel payment
          </button>
        </div>
      </div>
    )
  }

  // ── Timeout: still waiting after the poll window ────────────────
  if (timedOut) {
    return (
      <div className="text-center py-2">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl" aria-hidden="true">
          ⏳
        </div>
        <h3 className="text-lg font-black text-gray-800">We are still waiting for confirmation</h3>
        <p className="text-sm text-gray-600 mt-1 mb-4">
          The payment may still be processing. <span className="font-bold">Do not make another payment yet</span> —
          if it completes, your access unlocks automatically and a receipt is emailed to you.
        </p>
        <DetailsCard
          reference={reference}
          operatorLabel={operatorLabel}
          amountZMW={amountZMW}
          statusLabel="Awaiting confirmation"
        />
        <button
          type="button"
          onClick={onCheckStatus}
          disabled={checking}
          className="mt-4 w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"
        >
          {checking
            ? <span className="flex items-center justify-center gap-2"><Icon as={Loader2} size="sm" className="animate-spin" /> Checking…</span>
            : 'Check payment status'}
        </button>
        <p className="mt-3 text-xs text-gray-500">
          Need help?{' '}
          <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>Email support</a>
          {' or '}
          <a className="font-semibold underline" href={SUPPORT_WHATSAPP_HREF} target="_blank" rel="noreferrer">WhatsApp us</a>.
        </p>
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          className="mt-2 text-xs font-semibold text-gray-500 underline hover:text-gray-700 bg-transparent shadow-none min-h-0 p-1"
        >
          Cancel payment
        </button>
      </div>
    )
  }

  // ── Verifying (after "I have approved") ─────────────────────────
  if (stage === 'verifying') {
    return (
      <div className="text-center py-2">
        <Icon as={Loader2} size="lg" className="mx-auto animate-spin text-orange-500" />
        <h3 className="text-lg font-black text-gray-800 mt-3">Verifying your payment</h3>
        <p className="text-sm text-gray-600 mt-1 mb-4">This usually takes a few seconds.</p>
        <ol className="mx-auto max-w-[260px] space-y-2.5 text-left mb-4">
          <TimelineStep state="done" label="Payment request sent" />
          <TimelineStep state="done" label="Waiting for approval" />
          <TimelineStep state="current" label="Verifying payment" />
        </ol>
        <div className="flex items-center justify-center gap-2 rounded-xl bg-orange-50 border border-orange-100 px-4 py-3 text-xs text-gray-700">
          <Icon as={Lock} size="xs" className="shrink-0 text-gray-500" />
          Please do not close this window while we verify your payment.
        </div>
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          className="mt-3 text-xs font-semibold text-gray-500 underline hover:text-gray-700 bg-transparent shadow-none min-h-0 p-1"
        >
          Cancel payment
        </button>
      </div>
    )
  }

  // ── Waiting: "Check your phone" ─────────────────────────────────
  return (
    <div className="text-center py-2">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl" aria-hidden="true">
        📲
      </div>
      <h3 className="text-xl font-black text-gray-800">Check your phone</h3>
      <p className="text-sm text-gray-600 mt-1">A payment prompt has been sent to</p>
      <p className="text-2xl font-black tracking-wide text-gray-900 mt-1">{phoneDisplay}</p>
      <p className="text-sm text-gray-600 mt-1 mb-4">Approve it using your mobile-money PIN.</p>
      <DetailsCard
        reference={reference}
        operatorLabel={operatorLabel}
        amountZMW={amountZMW}
        statusLabel="Waiting for approval"
      />
      <ol className="mx-auto max-w-[260px] space-y-2.5 text-left mt-4">
        <TimelineStep state="done" label="Payment request sent" />
        <TimelineStep state="current" label="Waiting for approval" />
        <TimelineStep state="pending" label="Verifying payment" />
      </ol>
      <p className="mt-3 text-xs text-gray-500">
        We confirm automatically — you don&apos;t have to press anything for the payment to count.
      </p>
      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={onApproved}
          className="w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600"
        >
          I have approved
        </button>
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:border-gray-400"
        >
          Cancel payment
        </button>
      </div>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
        <Icon as={Lock} size="xs" /> Secure payments by Lenco
      </p>
    </div>
  )
}
