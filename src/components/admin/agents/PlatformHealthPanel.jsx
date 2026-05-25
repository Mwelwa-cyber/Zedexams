/**
 * PlatformHealthPanel — admin diagnostics for the AI agent pipeline.
 *
 * Renders inside the AgentsDashboard. Shows three signals — Anthropic key
 * alive, agentControl docs present, CBC KB topic count — and exposes two
 * one-click actions: Initialize (seed missing agentControl docs) and Run
 * sample job (queue a real brief so the admin can watch the pipeline).
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

const functions = getFunctions(app, 'us-central1')
const getPlatformHealthCallable = httpsCallable(functions, 'getPlatformHealth', { timeout: 30_000 })
const initializeAgentPipelineCallable = httpsCallable(functions, 'initializeAgentPipeline', { timeout: 30_000 })
const runSampleAgentJobCallable = httpsCallable(functions, 'runSampleAgentJob', { timeout: 30_000 })
const importBuiltInCbcTopicsCallable = httpsCallable(functions, 'importBuiltInCbcTopics', { timeout: 60_000 })

const AGENT_LABELS = {
  aria: 'Aria',
  cala: 'Cala',
  reva: 'Reva',
  pubo: 'Pubo',
  quill: 'Quill',
  vex: 'Vex',
}

function StatusDot({ ok, busy }) {
  if (busy) {
    return <span className="inline-block h-2 w-2 rounded-full bg-slate-400 animate-pulse" aria-hidden />
  }
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'}`}
      aria-hidden
    />
  )
}

function Row({ label, ok, value, hint, busy }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/50 bg-slate-800/30 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot ok={ok} busy={busy} />
        <div className="min-w-0">
          <p className="truncate text-xs font-black text-slate-100">{label}</p>
          {hint && <p className="truncate text-[10px] text-slate-400">{hint}</p>}
        </div>
      </div>
      {value !== undefined && (
        <span className={`text-xs font-bold ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>
          {value}
        </span>
      )}
    </div>
  )
}

export default function PlatformHealthPanel() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [initBusy, setInitBusy] = useState(false)
  const [sampleBusy, setSampleBusy] = useState(false)
  const [seedBusy, setSeedBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState(null)
  const [sampleJobId, setSampleJobId] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getPlatformHealthCallable({})
      setHealth(res.data || null)
    } catch (e) {
      setError(e?.message || 'Failed to load health snapshot.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleInitialize() {
    setInitBusy(true)
    setActionMsg(null)
    try {
      const res = await initializeAgentPipelineCallable({})
      const created = res?.data?.created || []
      setActionMsg(
        created.length
          ? `Created agentControl docs: ${created.join(', ')}.`
          : 'All agentControl docs already exist. Nothing to do.',
      )
      await refresh()
    } catch (e) {
      setActionMsg(`Initialize failed: ${e?.message || 'unknown error'}`)
    } finally {
      setInitBusy(false)
    }
  }

  async function handleSeedTopics() {
    setSeedBusy(true)
    setActionMsg(null)
    try {
      const res = await importBuiltInCbcTopicsCallable({})
      const written = res?.data?.written ?? 0
      const total = res?.data?.totalInCode ?? 0
      setActionMsg(`Seeded ${written} of ${total} built-in CBC topics into the KB.`)
      await refresh()
    } catch (e) {
      setActionMsg(`Seed failed: ${e?.message || 'unknown error'}`)
    } finally {
      setSeedBusy(false)
    }
  }

  async function handleRunSample() {
    setSampleBusy(true)
    setActionMsg(null)
    setSampleJobId(null)
    try {
      const res = await runSampleAgentJobCallable({})
      const jobId = res?.data?.jobId
      setSampleJobId(jobId)
      setActionMsg(`Sample job queued (Grade 6 English · Reading Comprehension).`)
    } catch (e) {
      setActionMsg(`Sample job failed: ${e?.message || 'unknown error'}`)
    } finally {
      setSampleBusy(false)
    }
  }

  const anthropic = health?.anthropic
  const agentControl = health?.agentControl || {}
  const missingControl = health?.missingAgentControlDocs || []
  const kb = health?.kb
  const recent = health?.recentJobs

  const overallReady =
    !!anthropic?.ok &&
    missingControl.length === 0 &&
    (kb?.totalTopics || 0) > 0

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 sm:p-5 shadow-lg shadow-slate-950/30">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-black text-slate-100">Platform health</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Live diagnostics for the agent pipeline. Admin-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overallReady ? (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Ready
            </span>
          ) : (
            <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-300 ring-1 ring-rose-500/30">
              Needs attention
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[10px] font-black text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Concrete next-step when the Anthropic key is missing — this is
          the single most common reason a fresh deployment can't run
          agent briefs, and there's no way to set Functions secrets
          from a callable (Google requires CLI or Cloud Console), so
          the best the panel can do is hand the admin the exact
          command to run on their workstation. */}
      {health && anthropic && !anthropic.ok && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p className="font-black text-amber-100">Anthropic API is unreachable</p>
          <p className="mt-1 text-amber-200/90">
            {anthropic.error || 'The ANTHROPIC_API_KEY secret is not set on Firebase Functions.'}
          </p>
          <p className="mt-2 text-amber-100 font-black">Fix in one command (run on a machine with Firebase CLI logged in to examsprepzambia):</p>
          <pre className="mt-1 rounded-lg bg-slate-900/70 border border-amber-500/30 p-2 text-[11px] text-amber-100 overflow-x-auto">
            firebase functions:secrets:set ANTHROPIC_API_KEY
          </pre>
          <p className="mt-2 text-amber-200/80">
            Paste your Claude API key when prompted (starts with <code>sk-ant-…</code>), then redeploy functions for the secret to take effect.
            After CI deploys, click <strong>Refresh</strong> above.
          </p>
        </div>
      )}

      {/* Diagnostic rows */}
      <div className="grid gap-2 md:grid-cols-2">
        <Row
          label="Anthropic API"
          ok={!!anthropic?.ok}
          busy={loading && !health}
          value={anthropic?.ok ? 'Alive' : 'Down'}
          hint={anthropic?.ok
            ? `Model ${anthropic.model || 'default'}`
            : (anthropic?.error || 'Add ANTHROPIC_API_KEY as a Functions secret')}
        />
        <Row
          label="Agent control docs"
          ok={missingControl.length === 0 && Object.keys(agentControl).length > 0}
          busy={loading && !health}
          value={
            missingControl.length === 0
              ? `${Object.keys(agentControl).length}/6 present`
              : `${missingControl.length} missing`
          }
          hint={
            missingControl.length === 0
              ? 'Dispatcher can route to every agent'
              : `Missing: ${missingControl.map(id => AGENT_LABELS[id] || id).join(', ')}`
          }
        />
        <Row
          label="CBC knowledge base"
          ok={(kb?.totalTopics || 0) > 0}
          busy={loading && !health}
          value={kb ? `${kb.totalTopics} topics` : '—'}
          hint={
            kb
              ? `Version ${kb.activeVersion || 'seed'} · grades ${
                  Object.keys(kb.byGrade || {}).sort().join(', ') || '—'
                }`
              : 'Loading KB…'
          }
        />
        <Row
          label="Agent jobs (last 50)"
          ok={(recent?.total || 0) > 0}
          busy={loading && !health}
          value={recent ? `${recent.total} jobs` : '—'}
          hint={
            recent && Object.keys(recent.byStatus || {}).length
              ? Object.entries(recent.byStatus)
                  .map(([s, n]) => `${n} ${s}`)
                  .join(' · ')
              : 'No jobs yet — try a sample run'
          }
        />
      </div>

      {/* Per-agent control snapshot */}
      {Object.keys(agentControl).length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
            Per-agent state
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(agentControl).map(([id, state]) => (
              <span
                key={id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${
                  !state.exists
                    ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
                    : state.paused
                      ? 'bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                }`}
              >
                {AGENT_LABELS[id] || id}
                <span className="text-[9px] opacity-80">
                  {!state.exists ? 'missing' : state.paused ? 'paused' : 'running'}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleInitialize}
          disabled={initBusy || missingControl.length === 0}
          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {initBusy ? 'Initializing…' : missingControl.length === 0 ? 'Initialized' : `Initialize (${missingControl.length})`}
        </button>
        {(kb?.totalTopics || 0) === 0 && (
          <button
            type="button"
            onClick={handleSeedTopics}
            disabled={seedBusy}
            className="rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-black text-white hover:bg-violet-700 disabled:opacity-50"
            title="Copy the 90 built-in G1–9 CBC topics into Firestore so Cala can verify alignment"
          >
            {seedBusy ? 'Seeding…' : 'Seed 90 built-in topics'}
          </button>
        )}
        <button
          type="button"
          onClick={handleRunSample}
          disabled={sampleBusy || !anthropic?.ok}
          className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-black text-white hover:bg-sky-700 disabled:opacity-50"
          title={!anthropic?.ok ? 'Anthropic API key must be alive first' : ''}
        >
          {sampleBusy ? 'Queuing…' : 'Run sample job'}
        </button>
        {sampleJobId && (
          <Link
            to={`/admin/agents/jobs/${sampleJobId}`}
            className="text-xs font-black text-sky-300 hover:text-sky-200 no-underline"
          >
            View sample job →
          </Link>
        )}
      </div>

      {actionMsg && (
        <p className="mt-2 text-[11px] text-slate-300">{actionMsg}</p>
      )}

      <p className="mt-3 text-[10px] text-slate-500">
        Tip: Initialize creates missing <code>agentControl/&#123;agent&#125;</code> docs with
        <code> paused: false</code>. Run sample job queues a Grade 6 English lesson-plan
        brief so you can watch Aria → Cala → Reva → awaiting approval.
      </p>
    </section>
  )
}
