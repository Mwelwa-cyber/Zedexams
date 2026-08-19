/**
 * /admin/voice — the text-to-speech control room.
 *
 * Four questions an operator actually has, in the order they matter:
 *   1. Is each provider connected and reachable?
 *   2. How many ElevenLabs credits are left? (their count, not ours)
 *   3. What did today's speech cost, and what did the cache save?
 *   4. Which voices exist, and what does each cost per million characters?
 *
 * The panel is READ-ONLY on purpose. Choosing which voices learners are
 * offered changes a live learner surface and belongs behind its own change,
 * once there are ElevenLabs voices to choose between.
 */

import { useCallback, useEffect, useState } from 'react'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'
import {
  fetchTtsControlRoom,
  fetchTtsDay,
  messageFromError,
  summariseTtsDay,
} from '../lib/ttsControlRoom'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
})
const num = new Intl.NumberFormat('en-ZM')

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function Card({ title, children, tone = 'neutral' }) {
  const border = tone === 'warn' ? 'border-amber-400' : 'border-transparent'
  return (
    <section className={`rounded-radius-md border-2 ${border} theme-bg-subtle p-4 mb-4`}>
      <h2 className="theme-text font-display font-black text-sm uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Stat({ value, label, hint }) {
  return (
    <div className="min-w-0">
      <p className="theme-text font-display font-black text-2xl tabular-nums leading-none">{value}</p>
      <p className="theme-text-muted text-[11px] uppercase tracking-wider font-bold mt-1">{label}</p>
      {hint && <p className="theme-text-muted text-[10px] mt-0.5">{hint}</p>}
    </div>
  )
}

function StatusDot({ ok, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-400'}`}
      />
      <span className="theme-text text-sm font-semibold">{label}</span>
    </span>
  )
}

export default function AdminVoice() {
  const [room, setRoom] = useState(null)
  const [day, setDay] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // The two reads are independent: the callable can fail (provider down)
    // while the Firestore rollups are perfectly readable, and a page that
    // showed neither because one failed would hide the spend numbers exactly
    // when something is wrong.
    const [roomRes, dayRes] = await Promise.allSettled([
      fetchTtsControlRoom(),
      fetchTtsDay(todayKey()),
    ])
    if (roomRes.status === 'fulfilled') setRoom(roomRes.value)
    else setError(messageFromError(roomRes.reason))
    if (dayRes.status === 'fulfilled') setDay(dayRes.value)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const elRate = room?.rates?.elevenlabs?.usdPerMchar ?? null
  const spend = summariseTtsDay(day || [], { usdPerMchar: elRate })
  const el = room?.providers?.elevenlabs
  const unpriced = room?.rates?.elevenlabs && room.rates.elevenlabs.priced === false

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <SeoHelmet title="Voice & speech" path="/admin/voice" noIndex />

      <header className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="theme-text font-display font-black text-2xl">Voice &amp; speech</h1>
          <p className="theme-text-muted text-sm">Providers, credits, and what speech is costing.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-radius-md border-2 border-slate-900/70 px-3 py-1.5 text-sm font-bold theme-text disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-radius-md border-2 border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {loading && !room ? <Skeleton height={160} /> : (
        <>
          {/* The unpriced warning sits ABOVE the numbers, because when it is
              showing, every cost on this page is wrong in the reassuring
              direction and the operator needs that before they read them. */}
          {unpriced && (
            <Card title="ElevenLabs spend is not being priced" tone="warn">
              <p className="theme-text text-sm">{room.rates.elevenlabs.note}</p>
            </Card>
          )}

          <Card title="Providers">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <StatusDot ok label="Google Cloud TTS" />
                <p className="theme-text-muted text-xs mt-1">{room?.providers?.google?.note}</p>
              </div>
              <div>
                <StatusDot
                  ok={Boolean(el?.reachable)}
                  label={
                    !el?.configured ? 'ElevenLabs — not connected'
                      : el?.reachable ? `ElevenLabs — connected${el.tier ? ` (${el.tier})` : ''}`
                        : 'ElevenLabs — unreachable'
                  }
                />
                <p className="theme-text-muted text-xs mt-1">
                  {!el?.configured
                    ? 'No API key configured for this runtime.'
                    : el?.error || 'Reachable.'}
                </p>
              </div>
            </div>
          </Card>

          {el?.configured && el?.reachable && el.characterLimit != null && (
            <Card title="ElevenLabs credits">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Stat value={num.format(el.charactersRemaining ?? 0)} label="characters left" />
                <Stat
                  value={`${num.format(el.charactersUsed ?? 0)} / ${num.format(el.characterLimit)}`}
                  label="used this period"
                />
                <Stat
                  value={el.resetsAt ? new Date(el.resetsAt).toLocaleDateString('en-GB') : '—'}
                  label="resets"
                />
              </div>
              <p className="theme-text-muted text-xs mt-3">
                ElevenLabs&rsquo; own count — it includes anything spent from the dashboard or
                another key, which our rollups below cannot see.
              </p>
            </Card>
          )}

          <Card title="Speech today">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat value={usd.format(spend.costUsd)} label="spent" hint={`${num.format(spend.paidChars)} chars`} />
              <Stat
                value={spend.savedUsd == null ? '—' : usd.format(spend.savedUsd)}
                label="saved by cache"
                hint={spend.savedUsd == null ? 'no rate to price it' : `${num.format(spend.cachedChars)} chars`}
              />
              <Stat
                value={spend.hitRate == null ? '—' : `${Math.round(spend.hitRate * 100)}%`}
                label="cache hit rate"
                hint={`${num.format(spend.cachedCalls)} of ${num.format(spend.totalCalls)}`}
              />
              <Stat value={num.format(spend.totalCalls)} label="requests" />
            </div>
          </Card>

          <Card title="Voices">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="theme-text-muted text-[11px] uppercase tracking-wider">
                    <th className="text-left font-bold py-1.5">Voice</th>
                    <th className="text-left font-bold py-1.5">Provider</th>
                    <th className="text-right font-bold py-1.5">USD / 1M chars</th>
                  </tr>
                </thead>
                <tbody>
                  {(room?.voices?.google || []).map((v) => (
                    <tr key={v.id} className="border-t theme-border">
                      <td className="py-1.5 theme-text">{v.label} <span className="theme-text-muted text-xs">{v.id}</span></td>
                      <td className="py-1.5 theme-text-muted">Google · {v.tier}</td>
                      <td className="py-1.5 text-right theme-text tabular-nums">{usd.format(v.usdPerMchar)}</td>
                    </tr>
                  ))}
                  {(room?.voices?.elevenlabs || []).map((v) => (
                    <tr key={v.voiceId} className="border-t theme-border">
                      <td className="py-1.5 theme-text">{v.name} <span className="theme-text-muted text-xs">{v.voiceId}</span></td>
                      <td className="py-1.5 theme-text-muted">ElevenLabs{v.category ? ` · ${v.category}` : ''}</td>
                      <td className="py-1.5 text-right theme-text tabular-nums">
                        {elRate == null ? 'not priced' : usd.format(elRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {room?.voices?.elevenlabsError && (
              <p className="theme-text-muted text-xs mt-2">
                ElevenLabs voices unavailable: {room.voices.elevenlabsError}
              </p>
            )}
            {!room?.voices?.elevenlabs?.length && !room?.voices?.elevenlabsError && (
              <p className="theme-text-muted text-xs mt-2">
                No ElevenLabs voices — connect the API key to list them here.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
