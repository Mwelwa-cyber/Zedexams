/**
 * AskGrownUpPage — /ask-a-grown-up. Where an under-18 learner goes
 * instead of a price list.
 *
 * ⚠️ THERE IS NO PRICE IN THIS FILE, AND THERE MUST NEVER BE ONE.
 *
 * Same structural guarantee as GuardianAskSheet: this module imports
 * nothing from `config/plans`, nothing from `subscriptionConfig`, and no
 * checkout component. There is no figure in its scope to leak.
 *
 * ── Why a page and not only the sheet ───────────────────────────────
 *
 * The sheet is opened by a tap on a lock, and it is the right surface for
 * that. But a learner can ARRIVE at a price by URL — /my-subscription
 * from an old notification action, /pricing from the "Pricing & plans"
 * row in the settings help panel, a link a friend sent. Those are
 * navigations, not taps, and a navigation needs somewhere to land. A
 * redirect to the dashboard would be a dead end that looks like the app
 * losing the link; this answers the question the learner actually asked.
 *
 * The request itself goes through the same server path as the sheet —
 * `requestGuardianUnlock`, which owns the 72-hour rate limit, decides
 * whether a verified guardian contact exists, and fixes the order of the
 * message (evidence → the ask → exam countdown → price; never price
 * first). Nothing about the ask is decided here.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  GUARDIAN_REQUEST,
  requestGuardianUnlock,
} from '../../../services/entitlements/guardianRequest'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import '../../../shared/styles/learnerTheme.css'

const OUTCOME_COPY = {
  [GUARDIAN_REQUEST.SENT]: {
    tone: 'ok',
    text: 'Sent. Your grown-up will get a message — you will hear back in your notifications.',
  },
  [GUARDIAN_REQUEST.RATE_LIMITED]: {
    // Named as a rule rather than an error, because it is one.
    tone: 'info',
    text: 'You already asked recently. You can send one request every 3 days.',
  },
  [GUARDIAN_REQUEST.NO_GUARDIAN]: {
    tone: 'info',
    text: 'We do not have a grown-up on your account yet. Add one in your profile and try again.',
  },
  [GUARDIAN_REQUEST.FAILED]: {
    tone: 'warn',
    text: 'We could not send that just now. Check your connection and try again.',
  },
}

export default function AskGrownUpPage() {
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState(null)

  async function send() {
    if (sending) return
    setSending(true)
    const result = await requestGuardianUnlock({
      feature: 'FULL_ACCESS',
      context: { surface: 'ask-page' },
    })
    setSending(false)
    setOutcome(result.outcome)
  }

  const status = outcome ? OUTCOME_COPY[outcome] : null

  return (
    <div className="lhx">
      <div className="lhx-page">
        <SeoHelmet title="Ask a grown-up · ZedExams" noIndex />

        <div className="lhx-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 34, marginBottom: 8 }} aria-hidden="true">🔓</div>
          <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>
            Ask a grown-up to unlock ZedExams
          </h1>
          <p className="lhx-set-desc">
            Every past paper, every quiz and full marking for your grade. We will
            send your grown-up a message with what you have been working on, so
            they can see how you are doing.
          </p>

          <button
            type="button"
            className="lhx-btn lhx-btn-primary lhx-btn-block"
            style={{ marginTop: 16 }}
            onClick={send}
            disabled={sending || outcome === GUARDIAN_REQUEST.SENT}
          >
            {sending ? 'Sending…' : outcome === GUARDIAN_REQUEST.SENT ? 'Sent ✓' : 'Send the request'}
          </button>

          {status && (
            <p
              className="lhx-set-desc"
              role="status"
              style={{ marginTop: 12 }}
            >
              {status.text}
            </p>
          )}
        </div>

        <p className="lhx-set-desc" style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to="/dashboard" className="lhx-see-all">Back to my dashboard</Link>
        </p>
      </div>
    </div>
  )
}
