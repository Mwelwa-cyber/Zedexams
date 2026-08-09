/**
 * OpsAlertTester — admin-only panel on /admin that answers one question:
 * "if something broke right now, would I hear about it?"
 *
 * Why it exists: an alerting channel that was never configured and a quiet week
 * look identical. This fires one real alert (severity info, titled so nobody
 * mistakes it for an incident) down the ordinary `sendOpsAlert` path and reports
 * each channel separately — including WHY a silent channel was silent.
 *
 * The three verdicts are not cosmetic. `both` is the only state that proves the
 * two-independent-channel property; `one` means an alert would still arrive
 * today but the redundancy is gone, which is worth amber rather than green.
 *
 * Admin-only: rendered inside /admin (gated by AdminLayout), and the callable
 * re-checks `users/{uid}.role === 'admin'` server-side.
 */

import { useState } from 'react'
import { sendTestOpsAlert, sendTestFunctionErrorAlert } from '../../utils/opsAlerts'
import Button from '../ui/Button'

const VERDICTS = {
  both: {
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    heading: 'Both channels delivered',
    blurb: 'Chat and email each got the alert. This is the state you want — one can fail and you still hear about it.',
  },
  one: {
    tone: 'bg-amber-50 border-amber-200 text-amber-900',
    heading: 'Only one channel delivered',
    blurb: 'An alert would still reach you today, but there is no backup channel left. Fix the silent one below.',
  },
  none: {
    tone: 'bg-rose-50 border-rose-200 text-rose-900',
    heading: 'Nothing was delivered',
    blurb: 'A real failure right now would be silent. Both channels need attention.',
  },
}

const CHANNEL_STATUS = {
  sent: { label: 'delivered', className: 'text-emerald-700' },
  'not-configured': { label: 'not configured', className: 'text-amber-700' },
  failed: { label: 'failed', className: 'text-rose-700' },
  unknown: { label: 'unknown', className: 'text-slate-600' },
}

function ChannelRow({ name, channel }) {
  const status = CHANNEL_STATUS[channel?.status] || CHANNEL_STATUS.unknown
  return (
    <div className="py-2 border-t border-slate-200 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate-900">{name}</span>
        <span className={`text-sm font-bold ${status.className}`}>{status.label}</span>
      </div>
      {channel?.detail && (
        <p className="mt-1 text-xs text-slate-600">{channel.detail}</p>
      )}
      {channel?.reason && (
        <p className="mt-0.5 text-xs font-mono text-slate-400">{channel.reason}</p>
      )}
    </div>
  )
}

export default function OpsAlertTester() {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [fnBusy, setFnBusy] = useState(false)
  const [fnResult, setFnResult] = useState(null)

  // The backend drill. Separate state from the channel test above because the
  // two answer different questions and one passing says nothing about the
  // other: this one can fail by DECLINING to fire (broken classifier) rather
  // than by failing to deliver.
  async function handleBackendDrill() {
    setError(null)
    setFnResult(null)
    setFnBusy(true)
    try {
      setFnResult(await sendTestFunctionErrorAlert())
    } catch (err) {
      console.error('[OpsAlertTester] backend drill failed', err)
      setError(err?.message || 'Could not run the backend alert drill. See console.')
    } finally {
      setFnBusy(false)
    }
  }

  async function handleSend() {
    setError(null)
    setResult(null)
    setBusy(true)
    try {
      setResult(await sendTestOpsAlert({ note }))
    } catch (err) {
      console.error('[OpsAlertTester] test alert failed', err)
      setError(err?.message || 'Could not send the test alert. See console.')
    } finally {
      setBusy(false)
    }
  }

  const verdict = result ? (VERDICTS[result.verdict] || VERDICTS.none) : null

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-elev-sm">
      <h2 className="text-display-md text-slate-900" style={{ fontSize: 16 }}>
        Test the ops alarm
      </h2>
      <p className="text-slate-600 text-body-sm mt-0.5">
        Sends one harmless alert (marked <em>info</em>, titled &ldquo;nothing is wrong&rdquo;) down the same
        path a real failure uses, then reports whether the chat channel and the admin email each
        received it. One test every 5 minutes.
      </p>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (e.g. after rotating the webhook)"
          className="flex-1 rounded-radius-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          disabled={busy}
          maxLength={200}
        />
        <Button variant="primary" size="md" onClick={handleSend} loading={busy} disabled={busy}>
          {busy ? 'Sending…' : 'Send test alert'}
        </Button>
      </div>

      {error && (
        <div className="mt-3 rounded-radius-md bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-900">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div className={`mt-3 rounded-radius-md border px-4 py-3 ${verdict.tone}`}>
          <p className="font-bold text-sm">{verdict.heading}</p>
          <p className="text-xs mt-0.5">{verdict.blurb}</p>
          <div className="mt-3 bg-white/70 rounded-radius-md px-3 py-1">
            <ChannelRow name="Chat (Slack webhook)" channel={result.slack} />
            <ChannelRow name="Email (OPS_ALERT_EMAILS)" channel={result.email} />
          </div>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-slate-200">
        <h3 className="text-slate-900 font-bold text-sm">Backend alarm drill</h3>
        <p className="text-slate-600 text-body-sm mt-0.5">
          Injects a synthetic <em>memory limit exceeded</em> into the live Cloud Functions error
          watch and lets it run the whole way through &mdash; classifier, thresholds, message,
          channel. The test above proves the channel delivers; this proves a real backend failure
          would reach it at all. Sentry cannot see Cloud Functions, so nothing else does.
          One drill every 5 minutes.
        </p>
        <div className="mt-3">
          <Button
            variant="secondary"
            size="md"
            onClick={handleBackendDrill}
            loading={fnBusy}
            disabled={fnBusy}
          >
            {fnBusy ? 'Running drill…' : 'Run backend alarm drill'}
          </Button>
        </div>
        {fnResult && (
          <div
            className={`mt-3 rounded-radius-md border px-4 py-3 ${
              fnResult.firedThroughRealPath
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <p className="font-bold text-sm">
              {fnResult.firedThroughRealPath
                ? 'The watch fired a critical alert through the live path.'
                : 'The watch did NOT fire on a synthetic memory kill.'}
            </p>
            <p className="text-xs mt-0.5">{fnResult.note}</p>
          </div>
        )}
      </div>
    </div>
  )
}
