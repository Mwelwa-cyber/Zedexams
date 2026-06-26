/**
 * DawnBriefingPanel — launch Dawn (the on-demand "morning briefing" Managed
 * Agent) from /admin/agents with a button, instead of a laptop script.
 *
 * Clicking "Run Dawn now" calls the runDawnBriefing callable, which starts the
 * run server-side (the Anthropic key stays a Cloud Functions secret — it never
 * touches the browser) and returns immediately. The deliverDawnBriefings poller
 * collects the briefing ~10 min later, emails it, and writes it onto
 * dawnRuns/{sessionId}; this panel live-subscribes to that doc, so the status
 * goes Running → Done and the briefing renders inline here as well as in the
 * inbox. The non-secret launch ids live in dawnConfig/default, set once from the
 * inline form below.
 */

import { useEffect, useMemo, useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  collection, doc, limit as fsLimit, onSnapshot, orderBy, query, serverTimestamp, setDoc,
} from 'firebase/firestore'
import app, { db } from '../../../firebase/config'

const functions = getFunctions(app, 'us-central1')
const runDawnBriefingCallable = httpsCallable(functions, 'runDawnBriefing', { timeout: 60_000 })

const STATUS_STYLE = {
  running: { label: 'Running', badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/30', dot: 'bg-amber-400 text-amber-400 animate-live-dot' },
  done: { label: 'Done', badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', dot: 'bg-emerald-400' },
  timeout: { label: 'Timed out', badge: 'bg-rose-500/15 text-rose-300 ring-rose-500/30', dot: 'bg-rose-400' },
  error: { label: 'Error', badge: 'bg-rose-500/15 text-rose-300 ring-rose-500/30', dot: 'bg-rose-400' },
}

function relTime(ts) {
  const ms = ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : null)
  if (!ms) return ''
  const diff = Date.now() - ms
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export default function DawnBriefingPanel() {
  const [config, setConfig] = useState(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [run, setRun] = useState(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState(null)
  const [showConfig, setShowConfig] = useState(false)

  // Inline config form state.
  const [form, setForm] = useState({ agentId: '', envId: '', vaultId: '', toEmail: '' })
  const [savingConfig, setSavingConfig] = useState(false)

  // dawnConfig/default — the non-secret launch ids + recipient email.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'dawnConfig', 'default'),
      (snap) => {
        const data = snap.exists() ? (snap.data() || {}) : {}
        setConfig(data)
        setForm((f) => ({
          agentId: data.agentId || f.agentId,
          envId: data.envId || f.envId,
          vaultId: data.vaultId || f.vaultId,
          toEmail: data.toEmail || f.toEmail,
        }))
        setConfigLoaded(true)
      },
      () => setConfigLoaded(true),
    )
    return () => unsub()
  }, [])

  // Latest run — drives the live status + the rendered briefing.
  useEffect(() => {
    const q = query(collection(db, 'dawnRuns'), orderBy('startedAt', 'desc'), fsLimit(1))
    const unsub = onSnapshot(
      q,
      (snap) => setRun(snap.docs[0] ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null),
      () => {},
    )
    return () => unsub()
  }, [])

  const configured = useMemo(() => !!(config && config.agentId && config.envId), [config])
  const isRunning = run?.status === 'running'

  async function handleLaunch() {
    setLaunching(true)
    setError(null)
    try {
      await runDawnBriefingCallable({})
    } catch (err) {
      const code = err?.code || ''
      if (code === 'functions/failed-precondition') {
        setShowConfig(true)
        setError('Dawn needs configuring first — add the launch ids below.')
      } else if (code === 'functions/already-exists') {
        setError("Dawn is already working on a briefing — it'll arrive shortly.")
      } else {
        setError(err?.message || 'Could not start Dawn.')
      }
    } finally {
      setLaunching(false)
    }
  }

  async function handleSaveConfig(e) {
    e.preventDefault()
    setSavingConfig(true)
    setError(null)
    try {
      await setDoc(doc(db, 'dawnConfig', 'default'), {
        agentId: form.agentId.trim(),
        envId: form.envId.trim(),
        vaultId: form.vaultId.trim(),
        toEmail: form.toEmail.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setShowConfig(false)
    } catch (err) {
      setError(err?.message || 'Could not save Dawn settings.')
    } finally {
      setSavingConfig(false)
    }
  }

  const statusStyle = run ? (STATUS_STYLE[run.status] || STATUS_STYLE.error) : null

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-200">
            <span aria-hidden>🌅</span> Dawn — Morning Briefing
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Bugs to fix, polish to ship, competitive research + a Top 3 — read from
            the codebase + the market. Runs in ~10 min and lands in your inbox.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleLaunch}
            disabled={launching || isRunning}
            className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black text-emerald-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? 'Dawn is working…' : launching ? 'Starting…' : 'Run Dawn now'}
          </button>
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
          >
            {showConfig ? 'Close' : 'Settings'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {configLoaded && !configured && !showConfig && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Dawn isn't configured yet.{' '}
          <button type="button" onClick={() => setShowConfig(true)} className="font-black underline">
            Add the launch ids
          </button>{' '}
          from when you built Dawn (one-time).
        </div>
      )}

      {showConfig && (
        <form onSubmit={handleSaveConfig} className="mt-3 space-y-2 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
          <p className="text-[11px] text-slate-400">
            From your Dawn launch (the <code className="text-slate-300">IDS.env</code> file). These
            aren't secrets — the Anthropic key stays server-side.
          </p>
          {[
            { k: 'agentId', label: 'Agent ID', ph: 'agent_…', required: true },
            { k: 'envId', label: 'Environment ID', ph: 'env_…', required: true },
            { k: 'vaultId', label: 'Vault ID (optional)', ph: 'vault_…', required: false },
            { k: 'toEmail', label: 'Send briefing to (email)', ph: 'you@gmail.com', required: false },
          ].map(({ k, label, ph, required }) => (
            <label key={k} className="block">
              <span className="text-[11px] font-bold text-slate-300">{label}</span>
              <input
                type={k === 'toEmail' ? 'email' : 'text'}
                value={form[k]}
                required={required}
                placeholder={ph}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={savingConfig}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-black text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {savingConfig ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      )}

      {run && (
        <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${statusStyle.badge}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
              {statusStyle.label}
            </span>
            <span className="text-[11px] text-slate-500">
              {run.startedAt ? `started ${relTime(run.startedAt)}` : ''}
            </span>
          </div>

          {isRunning && (
            <p className="mt-2 text-xs text-slate-400">
              Dawn is reading the codebase + researching. This takes about 10 minutes —
              you can leave this page; the briefing emails itself and appears here when done.
            </p>
          )}

          {run.status === 'done' && (
            <div className="mt-2">
              {run.subject && (
                <p className="text-sm font-black text-slate-100">{run.subject}</p>
              )}
              <p className="mt-0.5 text-[11px] text-slate-500">
                {run.emailedTo
                  ? `Emailed to ${run.emailedTo}.`
                  : run.emailError === 'no-recipient'
                    ? 'No recipient email set — add one in Settings to get it by email.'
                    : run.emailError === 'smtp-not-configured'
                      ? 'Email isn’t configured on the server — showing it here only.'
                      : run.emailError
                        ? `Email failed (${run.emailError}) — showing it here.`
                        : 'Saved here.'}
              </p>
              {run.briefing && (
                <pre className="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-700/50 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-200">
                  {run.briefing}
                </pre>
              )}
            </div>
          )}

          {(run.status === 'timeout' || run.status === 'error') && (
            <p className="mt-2 text-xs text-rose-300">
              {run.error || 'Dawn didn’t finish in time. Try again, or open the Console session to inspect it.'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
