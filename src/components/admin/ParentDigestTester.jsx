/**
 * ParentDigestTester — admin-only panel on /admin that fires the
 * weekly parent-digest cron on demand for one share token.
 *
 * Why exists: verifying the WhatsApp (Meta) + email send paths via the
 * browser console is fiddly (you have to read the Firebase ID token
 * from IndexedDB, which expires fast, and manually POST to the Cloud
 * Function). This panel calls the same `triggerWeeklyParentDigest`
 * callable but through the app's already-init'd Firebase Auth, so
 * tokens refresh automatically and there's no console gymnastics.
 *
 * Forced runs deliberately do NOT bump the per-channel idempotency
 * stamps, so a Saturday smoke test won't suppress Sunday's real
 * cron. The audit row in `parentDigestEvents/{eventId}` is tagged
 * `forced: true` to make these runs filterable later.
 *
 * Admin-only: this component renders inside `/admin` which is already
 * gated by AdminLayout; the underlying callable also re-checks
 * `users/{uid}.role === "admin"` server-side, so a learner who lands
 * here via URL forging gets `permission-denied`.
 */

import { useState } from 'react'
import { triggerWeeklyParentDigest } from '../../utils/parentShares'
import Button from '../ui/Button'

function fmtSummary(summary) {
  if (!summary) return null
  const totalSent = (summary.sent?.email || 0) + (summary.sent?.whatsapp || 0)
  const totalFailed = (summary.failed?.email || 0) + (summary.failed?.whatsapp || 0)
  return { totalSent, totalFailed }
}

export default function ParentDigestTester() {
  const [token, setToken] = useState('')
  const [force, setForce] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleRun() {
    setError(null)
    setResult(null)
    const trimmed = token.trim().toUpperCase()
    if (!trimmed) {
      setError('Enter a share token first.')
      return
    }
    setBusy(true)
    try {
      const summary = await triggerWeeklyParentDigest({
        force,
        targetTokens: [trimmed],
      })
      setResult(summary)
    } catch (err) {
      console.error('[ParentDigestTester] trigger failed', err)
      setError(err?.message || 'Trigger failed. See console.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRunAll() {
    if (!window.confirm('Run the digest for ALL active shares (not a dry run, real messages will go out)? This is what the Sunday cron does, just earlier.')) return
    setError(null); setResult(null); setBusy(true)
    try {
      const summary = await triggerWeeklyParentDigest({ force })
      setResult(summary)
    } catch (err) {
      console.error('[ParentDigestTester] full-run failed', err)
      setError(err?.message || 'Trigger failed. See console.')
    } finally {
      setBusy(false)
    }
  }

  const totals = fmtSummary(result)

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-elev-sm">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-display-md text-slate-900" style={{ fontSize: 16 }}>
            Test parent digest
          </h2>
          <p className="text-slate-600 text-body-sm mt-0.5">
            Fire the weekly digest cron on demand for a single share token (or all shares).
            Use this to verify WhatsApp (Meta) and email delivery without waiting for Sunday's tick.
            Forced runs don't update the 5-day idempotency stamp, so Sunday's real cron still fires.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Share token (12 chars, e.g. ABC23DEFGH45)"
          className="flex-1 rounded-radius-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-emerald-500"
          disabled={busy}
          maxLength={32}
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700 px-2">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Force (bypass 5-day guard)
        </label>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={handleRun}
          loading={busy}
          disabled={busy || !token.trim()}
        >
          {busy ? 'Sending…' : 'Send to this token'}
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={handleRunAll}
          loading={busy}
          disabled={busy}
        >
          Run full digest now
        </Button>
      </div>

      {error && (
        <div className="mt-3 rounded-radius-md bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-900">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-radius-md bg-emerald-50 border border-emerald-200 px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="font-bold text-emerald-900 text-sm">
              {totals.totalSent} message{totals.totalSent === 1 ? '' : 's'} sent
              {totals.totalFailed > 0 && `, ${totals.totalFailed} failed`}
            </p>
            <span className="text-xs text-emerald-700">
              shares scanned: {result.sharesScanned}
            </span>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-emerald-900">
            <div>
              <dt className="text-emerald-700">Email sent</dt>
              <dd className="font-bold">{result.sent?.email ?? 0}</dd>
            </div>
            <div>
              <dt className="text-emerald-700">WhatsApp sent</dt>
              <dd className="font-bold">{result.sent?.whatsapp ?? 0}</dd>
            </div>
            <div>
              <dt className="text-emerald-700">SMTP ready</dt>
              <dd className="font-bold">{result.smtpReady ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt className="text-emerald-700">WhatsApp ready</dt>
              <dd className="font-bold">{result.whatsAppReady ? 'yes' : 'no'}</dd>
            </div>
          </dl>
          {result.errors && result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-bold text-rose-900">
                {result.errors.length} error{result.errors.length === 1 ? '' : 's'}
              </summary>
              <pre className="mt-2 text-xs text-rose-900 whitespace-pre-wrap">
{result.errors.join('\n')}
              </pre>
            </details>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-bold text-emerald-900">Raw response</summary>
            <pre className="mt-2 text-xs text-emerald-900 whitespace-pre-wrap font-mono">
{JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
