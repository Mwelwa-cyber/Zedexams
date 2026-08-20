/**
 * AdminDailyQuizPage — `/admin/daily-quiz`, the Daily Quiz Generator console.
 *
 * Five tabs, and the split between them is the useful part:
 *
 *   Tonight's run        what exists for today, per grade, and a Run now button
 *   How it picks         the funnel — pool counts after each rule, read-only
 *   Tomorrow's preview   the five, plus voiding for a live one
 *   Bank health          eligible questions ÷ 5 = days of runway
 *   Event log            every write to dailyQuizzes, with its cause
 *
 * ── What this console is NOT ─────────────────────────────────────────
 *
 * Not a question editor — that is the Question Bank studio — and not visible
 * to learners or parents. It is a window onto one scheduled function.
 *
 * ── Why the funnel tab writes nothing ────────────────────────────────
 *
 * "How it picks" re-runs the SELECTOR for a grade and date and reports what
 * each rule left. It deliberately does not go through the builder: a
 * read-only view of a decision that has already been made must not be able
 * to change it, and the seed means re-running the selector produces exactly
 * the pick that is already stored anyway.
 */
import { useCallback, useEffect, useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'
import { describeSwapState, formatRelaxed, runStatusChip } from '../lib/adminDailyQuizCore'
// A bank stem may be a plain string, legacy HTML, or a *stringified* Tiptap doc.
// These are one-line previews in a dense list, so they are flattened to text
// rather than rendered — but flattened by the one extractor that knows all
// three shapes. Rendering the stored value directly printed the raw
// `{"type":"doc",...}` here, on the very screen an admin uses to decide whether
// a question is fit to serve.
import { getRichPlainText } from '../../../editor/richPlainText'
import '../adminDailyQuiz.css'

const fns = getFunctions(app, 'us-central1')
const overviewCall = httpsCallable(fns, 'adminDailyQuizOverview')
const funnelCall = httpsCallable(fns, 'adminDailyQuizFunnel')
const runNowCall = httpsCallable(fns, 'adminRunDailyQuizNow')
const voidCall = httpsCallable(fns, 'adminVoidDailyQuizQuestion')

const TABS = [
  ['run', 'Tonight’s run'],
  ['funnel', 'How it picks'],
  ['preview', 'Tomorrow’s preview'],
  ['health', 'Bank health'],
  ['log', 'Event log'],
]

export default function AdminDailyQuizPage() {
  const [tab, setTab] = useState('run')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await overviewCall()
      setData(res?.data || null)
    } catch (err) {
      console.error('daily quiz console load failed', err)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const runNow = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await runNowCall({})
      const built = (res?.data?.results || []).filter((r) => r.created).length
      setNotice(built
        ? `Built ${built} quiz document(s).`
        : 'Nothing to build — every grade already has today’s quiz.')
      await load()
    } catch (err) {
      setNotice(`Run failed: ${err?.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  const voidQuestion = async (args) => {
    setBusy(true)
    try {
      const res = await voidCall(args)
      setNotice(`Question voided — ${res?.data?.recredited ?? 0} attempt(s) re-credited.`)
      await load()
    } catch (err) {
      setNotice(`Void failed: ${err?.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="adq">Loading the console…</div>

  if (error) {
    return (
      <div className="adq">
        <div className="adq-card">
          <p style={{ fontWeight: 800, margin: '0 0 4px' }}>Couldn’t load the console.</p>
          <p className="adq-prose" style={{ margin: 0 }}>{String(error?.message || error)}</p>
          <button type="button" className="adq-btn adq-btn-indigo" onClick={load}>Try again</button>
        </div>
      </div>
    )
  }

  return (
    <div className="adq">
      <h1 className="adq-h1">Daily Quiz Generator</h1>
      <p className="adq-sub">buildDailyQuizzes · 00:05 Africa/Lusaka · {data?.date}</p>

      <div className="adq-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`adq-tab${tab === key ? ' is-on' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && <div className="adq-note">{notice}</div>}

      {tab === 'run' && <RunTab data={data} onRun={runNow} busy={busy} />}
      {tab === 'funnel' && <FunnelTab grades={data?.grades || []} date={data?.date} />}
      {tab === 'preview' && <PreviewTab data={data} onVoid={voidQuestion} busy={busy} />}
      {tab === 'health' && <HealthTab rows={data?.health || []} />}
      {tab === 'log' && <LogTab events={data?.events || []} />}
    </div>
  )
}

function RunTab({ data, onRun, busy }) {
  return (
    <>
      <div className="adq-card">
        <div className="adq-kicker">Today · {data?.date}</div>
        {(data?.today || []).map((row) => {
          const chip = runStatusChip(row)
          return (
            <div key={row.docId} className="adq-row">
              <div className="adq-row-grade">Grade {row.grade}</div>
              <div className="adq-mono">{row.docId}</div>
              <span className="adq-chip" style={{ background: chip.bg, color: chip.fg }}>
                {chip.label}
              </span>
            </div>
          )
        })}
      </div>

      <button type="button" className="adq-btn adq-btn-primary" onClick={onRun} disabled={busy}>
        {busy ? 'Running…' : '▶ Run now for all grades'}
      </button>

      <div className="adq-card">
        <div className="adq-kicker">Why a missed cron is not an outage</div>
        <div className="adq-prose">
          If the cron misses, the first learner to open the app builds the document on the spot and
          everyone else in that grade gets the same one — the pick is seeded with{' '}
          <code>hash(grade|date)</code>, so a self-heal produces exactly the five the cron would
          have written. Running it here only saves that first learner the wait.
        </div>
      </div>
    </>
  )
}

function FunnelTab({ grades, date }) {
  const [grade, setGrade] = useState(grades[0] || '7')
  const [funnel, setFunnel] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    funnelCall({ grade, date })
      .then((res) => { if (!cancelled) setFunnel(res?.data || null) })
      .catch((err) => { if (!cancelled) console.error('funnel failed', err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [grade, date])

  return (
    <>
      <div className="adq-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label className="adq-subject" htmlFor="adq-grade">Grade</label>
        <select
          id="adq-grade"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          style={{ fontWeight: 800 }}
        >
          {grades.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7392', fontWeight: 800 }}>
          {date}
        </span>
      </div>

      {loading && <div className="adq-card">Working out the funnel…</div>}

      {!loading && funnel && (
        <>
          {(funnel.steps || []).map((s, i) => (
            <div key={s.key} className="adq-card" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
              <span className="adq-step-n">{i + 1}</span>
              <span style={{ fontSize: 12.8, fontWeight: 800 }}>{s.label}</span>
              <span className="adq-count">{s.count}<small>{s.unit}</small></span>
            </div>
          ))}

          <div className="adq-card">
            <div className="adq-kicker">Seeded pick</div>
            <div className="adq-prose" style={{ marginBottom: 8 }}>
              seed = <code>{funnel.seed}</code> · status <b>{funnel.status}</b>
              <br />{formatRelaxed(funnel.rulesRelaxed)}
            </div>
            {(funnel.questions || []).map((q, i) => (
              <div key={q.id} className="adq-item">
                <b>{i + 1}.</b>
                <div>
                  <span className="adq-subject">{q.subject}</span>{' '}
                  <span>{getRichPlainText(q.text)}</span>
                </div>
              </div>
            ))}
            <p className="adq-prose" style={{ marginTop: 8 }}>
              IDs only reach the learner. The answer key never leaves the server — scoring happens
              in the answer function, not the app.
            </p>
          </div>
        </>
      )}
    </>
  )
}

function PreviewTab({ data, onVoid, busy }) {
  const swap = describeSwapState({ nowHour: data?.nowHour, cutoffHour: data?.cutoffHour })

  return (
    <>
      <div className={swap.locked ? 'adq-note' : 'adq-card'}>
        <b>{swap.label}</b>
        <div className="adq-prose" style={{ marginTop: 4 }}>{swap.detail}</div>
      </div>

      {(data?.preview || []).map((row) => (
        <div key={row.docId} className="adq-card">
          <div className="adq-kicker">Grade {row.grade} · {row.date}</div>
          {!row.exists ? (
            <p className="adq-prose">
              Not built yet — the cron writes it at 00:05, or use Run now.
            </p>
          ) : (row.questions || []).map((q, i) => (
            <div key={q.id} className="adq-item">
              <b>{i + 1}.</b>
              <div>
                <span className="adq-subject">{q.subject}</span>{' '}
                <span>{getRichPlainText(q.text)}</span>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="adq-card">
        <div className="adq-kicker">If an error is found after midnight</div>
        <div className="adq-prose">
          <b>Never edit a live quiz.</b> Void the question instead — every player is credited its
          10 points, the card tells them it was removed, and the bank item goes back to review.
          Fair beats perfect.
        </div>

        {(data?.today || []).filter((r) => r.exists).map((row) => (
          <div key={row.docId} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
              Grade {row.grade} · today
            </div>
            {(row.questions || []).map((q) => {
              const voided = (row.voidedQuestionIds || []).includes(q.id)
              return (
                <div key={q.id} className="adq-item">
                  <div style={{ flex: 1 }}>{getRichPlainText(q.text)}</div>
                  <button
                    type="button"
                    className="adq-btn adq-btn-ghost adq-btn-sm"
                    disabled={busy || voided}
                    onClick={() => onVoid({ grade: row.grade, date: row.date, questionId: q.id })}
                  >
                    {voided ? 'Voided' : 'Void'}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

function HealthTab({ rows }) {
  return (
    <div className="adq-card">
      <div className="adq-kicker">Eligible questions → days of runway (÷5)</div>
      {rows.map((r) => (
        <div key={r.grade} style={{ marginBottom: 12 }}>
          <div className="adq-bar-label">
            <span>Grade {r.grade}</span>
            <span>
              {/* A failed count is reported as unavailable, never as zero —
                  zero would page the content team about a healthy bank. */}
              {r.eligible == null
                ? 'count unavailable'
                : <>{r.eligible} eligible · <b>{r.runwayDays} days</b></>}
            </span>
          </div>
          <div className="adq-bar">
            <i
              className={r.level === 'critical' ? 'is-critical' : r.level === 'warn' ? 'is-warn' : ''}
              style={{ width: `${Math.min(100, r.runwayDays ?? 0)}%` }}
            />
          </div>
        </div>
      ))}
      <div className="adq-prose">
        The real cause of an empty card is a starved bank, not a dead cron — the self-heal covers
        that. Below 30 days the content team is emailed once for the month. At zero, learners get
        the labelled practice set, never a dead end.
      </div>
    </div>
  )
}

function LogTab({ events }) {
  return (
    <>
      <div className="adq-log">
        {events.length === 0 && (
          <div className="adq-log-line">No events recorded yet.</div>
        )}
        {events.map((e) => (
          <div key={e.id} className="adq-log-line">
            <span className="adq-log-at">{e.at || '—'}</span>{' '}
            <span className={`adq-log-type ${eventTone(e.type)}`}>{e.type}</span>{' '}
            {e.grade && <>grade={e.grade} </>}
            {e.date && <>date={e.date} </>}
            {e.createdBy && <>by={e.createdBy} </>}
            {e.actorUid && <>uid={String(e.actorUid).slice(0, 6)}… </>}
            {e.seed && <>seed={e.seed} </>}
            {e.status && <>status={e.status} </>}
            {e.runwayDays != null && <>runway={e.runwayDays}d </>}
            {e.error && <span className="adq-log-type is-err">{e.error}</span>}
          </div>
        ))}
      </div>

      <div className="adq-card">
        <div className="adq-kicker">Why the log matters</div>
        <div className="adq-prose">
          Every write to <code>dailyQuizzes</code> says <b>who</b> caused it — the cron, a
          self-heal (with the learner whose visit triggered it), Vigil, or a named admin. When Home
          says “no quiz today” again, this answers <i>why</i> in one glance instead of a debugging
          session.
        </div>
      </div>
    </>
  )
}

function eventTone(type) {
  const t = String(type)
  if (t.includes('fail') || t.includes('alert')) return 'is-err'
  if (t.includes('selfheal') || t.includes('admin')) return 'is-warn'
  return 'is-ok'
}
