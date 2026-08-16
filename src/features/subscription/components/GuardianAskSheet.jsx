/**
 * GuardianAskSheet — the under-18 variant of the contextual unlock sheet.
 *
 * ⚠️ THERE IS NO PRICE IN THIS FILE, AND THERE MUST NEVER BE ONE.
 *
 * That is a structural guarantee, not a review promise: this component imports
 * nothing from `config/plans`, nothing from `subscriptionConfig`, and no
 * checkout component. There is no figure in its scope to leak, so the only way
 * a price reaches a twelve-year-old through this sheet is for someone to add
 * an import — which is a visible edit, unlike a conditional that quietly
 * evaluates the wrong way. `ContextualUnlockSheet.spec.jsx` additionally
 * asserts the rendered tree contains no `K<digit>` and no pay button.
 *
 * The reason is not only Play's Families policy. A Zambian learner of nine to
 * fifteen has no mobile money account. Showing them K50 is an offer made to
 * someone who cannot accept it; routing to the guardian is the only version of
 * this transaction that can complete. The child sells, the guardian pays.
 */

import { useState } from 'react'
import Icon from '../../../shared/components/Icon'
import { X } from '../../../shared/components/icons'
import {
  GUARDIAN_REQUEST,
  requestGuardianUnlock,
} from '../../../services/entitlements/guardianRequest'
import { resolveGateCopy } from '../../../services/entitlements'

const OUTCOME_COPY = {
  [GUARDIAN_REQUEST.SENT]: {
    tone: 'ok',
    text: 'Request sent to your guardian. Check back later — you will get a notification when they reply.',
  },
  [GUARDIAN_REQUEST.RATE_LIMITED]: {
    tone: 'info',
    // Named as a rule rather than an error, because it is one.
    text: 'You already asked recently. You can send one request every 3 days.',
  },
  [GUARDIAN_REQUEST.NO_GUARDIAN]: {
    tone: 'info',
    text: 'We do not have a guardian contact for your account yet. Add one in your profile and try again.',
  },
  [GUARDIAN_REQUEST.FAILED]: {
    tone: 'warn',
    text: 'We could not send that just now. Check your connection and try again.',
  },
}

export default function GuardianAskSheet({ gate, context = {}, onClose }) {
  const copy = resolveGateCopy(gate, context)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState(null)

  async function handleSend() {
    if (sending) return
    setSending(true)
    const result = await requestGuardianUnlock({ feature: gate, context })
    setSending(false)
    setOutcome(result.outcome)
    // Optimistic close on success: the confirmation lives in the toast and the
    // bell, and holding the sheet open after a successful send turns a
    // completed action into a screen the learner has to dismiss.
    if (result.outcome === GUARDIAN_REQUEST.SENT) {
      setTimeout(() => onClose?.(), 1400)
    }
  }

  const status = outcome ? OUTCOME_COPY[outcome] : null

  return (
    <div className="relative rounded-t-2xl theme-card px-5 pb-5 pt-4 sm:rounded-2xl">
      <span className="mx-auto mb-3 block h-1 w-9 rounded-full theme-bg-subtle" aria-hidden="true" />
      {/* A real ✕, same visual weight as the CTA, present from the first frame. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full theme-bg-subtle theme-text-muted shadow-none"
      >
        <Icon as={X} size="sm" />
      </button>

      <span className="mb-3 grid h-10 w-10 place-items-center rounded-2xl border border-indigo-200 bg-indigo-50 text-xl dark:border-indigo-400/30 dark:bg-indigo-500/15" aria-hidden="true">
        {copy?.icon || '🔒'}
      </span>

      <h2 className="pr-8 text-base font-black leading-tight theme-text">
        Ask your guardian to unlock this
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed theme-text-muted">
        We will send them a short message about what you are working on and how you are doing.
        {copy?.body ? ` ${copy.body}` : ''}
      </p>

      {status && (
        <p
          role="status"
          className={`mt-3 rounded-radius-md p-2.5 text-[12px] font-semibold ${
            status.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
              : status.tone === 'warn'
                ? 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200'
                : 'theme-bg-subtle theme-text-muted'
          }`}
        >
          {status.text}
        </p>
      )}

      {outcome !== GUARDIAN_REQUEST.SENT && (
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="mt-3 w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3 text-sm font-black text-white disabled:opacity-70"
        >
          {sending ? 'Sending…' : 'Send request'}
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full bg-transparent px-4 py-2 text-[12px] font-bold theme-text-muted shadow-none"
      >
        Not now
      </button>

      <p className="mt-2 text-center text-[10px] leading-relaxed theme-text-muted opacity-80">
        No prices are shown to learners under 18.
        <br />
        One request every 3 days.
      </p>
    </div>
  )
}
