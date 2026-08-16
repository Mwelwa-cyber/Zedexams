import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { capture } from '../../../utils/analytics'
import { resolveTeacherPlan } from '../../../engines/payment-engine/teacherPlans'
import {
  clearPremiumAction,
  readPremiumActionState,
} from '../lib/pendingPremiumAction'

// PostUpgradeContinuation — the "pick up where you left off" card, shown
// inside the originating studio after a successful upgrade returned the
// teacher there. It communicates four things: the payment succeeded, the
// work was preserved, NOTHING has been generated or charged automatically,
// and the previously blocked action is ready. The card never executes the
// action itself — pressing the studio's own Generate/Download control is the
// explicit confirmation, and that path runs the studio's full validation
// plus the server-side usage meter (the existing duplicate protection for
// generations).
//
// Non-blocking by design: a compact fixed card (bottom on mobile with
// safe-area padding, top-right toast on desktop) — never another modal.
// Dismissing it never touches the teacher's draft or document.

// Tool-specific CTA copy — never a generic label where a specific one exists.
const CONTINUE_LABELS = {
  lesson_plan: 'Continue creating your Lesson Plan',
  worksheet: 'Continue creating your Worksheet',
  scheme_of_work: 'Generate the complete Scheme of Work',
  assessment: 'Continue building your Test Paper',
  exam_paper: 'Continue building your Exam Paper',
  homework: 'Continue creating your Homework',
  notes: 'Continue preparing your Notes',
  flashcards: 'Continue creating your Flashcards',
  rubric: 'Continue building your Rubric',
  sba_task: 'Continue creating your SBA Task',
}

export function continueLabelFor(tool) {
  return CONTINUE_LABELS[tool] || 'Continue where you left off'
}

const COPY = {
  ready: {
    heading: 'Your upgrade is active',
    body: 'Your work has been restored — nothing has been generated or charged automatically. Review the details, then continue when you’re ready.',
  },
  review: {
    heading: 'We restored your studio, but this action needs to be reviewed',
    body: 'Check the details below before continuing.',
  },
  expired: {
    heading: 'Your previous action has expired',
    body: 'Your draft is still available. Review it and start the action again when ready.',
  },
}

// Presentational card — exported for specs and the visual harness.
export function ContinuationCard({ variant, tool, onPrimary, onReview, onDismiss }) {
  const [acted, setActed] = useState(false)
  const copy = COPY[variant] || COPY.ready
  const primaryLabel =
    variant === 'ready' ? continueLabelFor(tool) : variant === 'expired' ? 'Review draft' : 'Review details'

  function act(handler) {
    if (acted) return
    setActed(true)
    handler()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-2 bottom-2 z-40 mx-auto max-w-md rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl animate-slide-up
                 pb-[max(16px,env(safe-area-inset-bottom))]
                 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-full sm:max-w-sm sm:pb-4"
    >
      <button
        type="button"
        onClick={() => act(onDismiss)}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        ✕
      </button>
      <div className="flex items-start gap-3 pr-6">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-lg"
          aria-hidden="true"
        >
          {variant === 'expired' ? '⏳' : '✅'}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-900">{copy.heading}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{copy.body}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <button
          type="button"
          disabled={acted}
          onClick={() => act(onPrimary)}
          className="w-full rounded-xl bg-[#CF6B51] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#C5613F] disabled:opacity-60"
        >
          {primaryLabel}
        </button>
        {variant === 'ready' && (
          <button
            type="button"
            disabled={acted}
            onClick={() => act(onReview)}
            className="w-full rounded-xl px-3 py-1.5 text-[13px] font-semibold text-gray-500 transition-colors hover:text-slate-900 disabled:opacity-60"
          >
            Review first
          </button>
        )}
      </div>
    </div>
  )
}

// Host — mounted once at the root (App.jsx), beside PaywallHost.
export default function PostUpgradeContinuation() {
  const location = useLocation()
  const { currentUser, userProfile, isPremium } = useAuth()
  const [card, setCard] = useState(null) // { variant, tool, reason }
  const shownKeyRef = useRef('')

  useEffect(() => {
    const state = readPremiumActionState()
    if (!state || state.action.status !== 'paid') {
      setCard(null)
      return
    }
    const { action, expired } = state

    // Only inside the originating studio, and only for the account that
    // started the upgrade.
    const herePath = location.pathname
    const sourcePath = String(action.sourceRoute || '').split('?')[0]
    if (herePath !== sourcePath) {
      setCard(null)
      return
    }
    if (action.uid && currentUser?.uid && action.uid !== currentUser.uid) {
      clearPremiumAction()
      setCard(null)
      return
    }
    if (!currentUser) {
      setCard(null)
      return
    }

    let variant = 'ready'
    if (expired) {
      variant = 'expired'
    } else if (!(resolveTeacherPlan(userProfile) !== 'free' || isPremium)) {
      // The plan snapshot hasn't confirmed the upgrade (or it didn't apply) —
      // never present a "continue" that would hit the paywall again.
      variant = 'review'
    }

    setCard({ variant, tool: action.tool || null, reason: action.reason || null })

    // One analytics event per shown card (keyed so route re-renders don't
    // refire).
    const key = `${variant}:${action.paidAt || ''}:${herePath}`
    if (shownKeyRef.current !== key) {
      shownKeyRef.current = key
      capture(variant === 'expired' ? 'continuation_expired_shown' : 'continuation_prompt_shown', {
        tool: action.tool || null,
        reason: action.reason || null,
        variant,
      })
    }
  }, [location, currentUser, userProfile, isPremium])

  if (!card) return null

  function finish(eventName) {
    capture(eventName, { tool: card.tool, reason: card.reason, variant: card.variant })
    clearPremiumAction()
    setCard(null)
  }

  return (
    <ContinuationCard
      variant={card.variant}
      tool={card.tool}
      onPrimary={() => finish('continuation_continue_selected')}
      onReview={() => finish('continuation_review_selected')}
      onDismiss={() => finish('continuation_dismissed')}
    />
  )
}
