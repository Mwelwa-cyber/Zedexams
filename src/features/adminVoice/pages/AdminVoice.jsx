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

import { useCallback, useEffect, useRef, useState } from 'react'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'
import {
  buildOfferedPayload,
  catalogueRows,
  fetchTtsControlRoom,
  fetchTtsDay,
  messageFromError,
  offeredIds,
  previewVoice,
  saveOfferedVoices,
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

  // ── Voice picking ────────────────────────────────────────────────
  // `checked` mirrors the server's offered list until the admin touches
  // it; Save writes the whole list back and the server reports what it
  // dropped. `testText` feeds the per-voice "Say it" synthesis — the
  // spend an audition budget exists for.
  const [checked, setChecked] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saveNote, setSaveNote] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testText, setTestText] = useState('Chipolopolo won at Levy Mwanawasa Stadium in Ndola.')
  const [speakingId, setSpeakingId] = useState(null)
  const audioRef = useRef(null)
  const urlRef = useRef(null)

  const stopAudio = useCallback(() => {
    if (audioRef.current) { try { audioRef.current.pause() } catch { /* ignore */ } audioRef.current = null }
    if (urlRef.current) { try { URL.revokeObjectURL(urlRef.current) } catch { /* ignore */ } urlRef.current = null }
    setSpeakingId(null)
  }, [])
  useEffect(() => stopAudio, [stopAudio])

  const playUrl = useCallback((url, id, { revoke = false } = {}) => {
    stopAudio()
    const audio = new Audio(url)
    audioRef.current = audio
    if (revoke) urlRef.current = url
    setSpeakingId(id)
    const done = () => { if (audioRef.current === audio) stopAudio() }
    audio.onended = done
    audio.onerror = done
    audio.play().catch(done)
  }, [stopAudio])

  const toggleVoice = useCallback((id) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
    setDirty(true)
    setSaveNote(null)
  }, [])


  const save = useCallback(async () => {
    setSaving(true)
    setSaveNote(null)
    try {
      const rows = catalogueRows(room)
      const payload = buildOfferedPayload(rows, checked)
      const r = await saveOfferedVoices(payload)
      setDirty(false)
      setSaveNote(
        payload.length === 0
          ? 'Cleared — learners get the standard Google voices.'
          : `Saved ${r.saved} voice${r.saved === 1 ? '' : 's'}${r.dropped ? ` · ${r.dropped} invalid entr${r.dropped === 1 ? 'y' : 'ies'} dropped` : ''}.`,
      )
    } catch (err) {
      setSaveNote(messageFromError(err))
    } finally {
      setSaving(false)
    }
  }, [room, checked])

  const sayIt = useCallback(async (row) => {
    const text = testText.trim().slice(0, 200)
    if (!text) return
    setSpeakingId(`busy:${row.id}`)
    try {
      const url = await previewVoice({
        voice: { id: row.id, provider: row.provider, label: row.label, lang: row.lang },
        text,
      })
      playUrl(url, row.id, { revoke: true })
    } catch (err) {
      setSpeakingId(null)
      setSaveNote(messageFromError(err))
    }
  }, [testText, playUrl])

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
    if (roomRes.status === 'fulfilled') {
      setRoom(roomRes.value)
      setChecked(offeredIds(roomRes.value))
      setDirty(false)
    } else setError(messageFromError(roomRes.reason))
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
            {/* One test phrase for every "Say it" button. Auditioning is the
                one thing the endpoint's allow-list deliberately does not
                gate — hearing a voice is how it EARNS a place on the list.
                A full 200-char test costs ~$0.03 at ElevenLabs rates; the
                shared cache makes repeating the same phrase free. */}
            <label className="block mb-3">
              <span className="theme-text-muted text-[11px] uppercase tracking-wider font-bold">
                Test phrase (costs a fraction of a cent per voice)
              </span>
              <input
                type="text"
                maxLength={200}
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                className="mt-1 w-full rounded-radius-md border-2 theme-border bg-transparent px-3 py-2 text-sm theme-text"
              />
            </label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="theme-text-muted text-[11px] uppercase tracking-wider">
                    <th className="text-left font-bold py-1.5">Offered</th>
                    <th className="text-left font-bold py-1.5">Voice</th>
                    <th className="text-left font-bold py-1.5">Provider</th>
                    <th className="text-right font-bold py-1.5">USD / 1M</th>
                    <th className="text-right font-bold py-1.5">Listen</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogueRows(room).map((v) => (
                    <tr key={v.id} className="border-t theme-border">
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={checked.includes(v.id)}
                          onChange={() => toggleVoice(v.id)}
                          aria-label={`Offer ${v.label} to learners`}
                        />
                      </td>
                      <td className="py-1.5 theme-text">
                        {v.label} <span className="theme-text-muted text-xs">{v.id}</span>
                      </td>
                      <td className="py-1.5 theme-text-muted">{v.sub}</td>
                      <td className="py-1.5 text-right theme-text tabular-nums">
                        {v.usdPerMchar == null ? 'not priced' : usd.format(v.usdPerMchar)}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {v.previewUrl && (
                          <button
                            type="button"
                            onClick={() => (speakingId === `sample:${v.id}` ? stopAudio() : playUrl(v.previewUrl, `sample:${v.id}`))}
                            className="rounded-radius-md border theme-border px-2 py-0.5 text-xs font-bold theme-text mr-1"
                            title="Free hosted sample"
                          >
                            {speakingId === `sample:${v.id}` ? '⏹' : '▶'} Sample
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => (speakingId === v.id ? stopAudio() : sayIt(v))}
                          disabled={speakingId === `busy:${v.id}` || !testText.trim()}
                          className="rounded-radius-md border theme-border px-2 py-0.5 text-xs font-bold theme-text disabled:opacity-50"
                          title="Synthesise the test phrase in this voice"
                        >
                          {speakingId === `busy:${v.id}` ? '…' : speakingId === v.id ? '⏹ Stop' : '🗣 Say it'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-radius-md border-2 border-slate-900/70 px-4 py-1.5 text-sm font-bold theme-text disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save offered voices'}
              </button>
              <p className="theme-text-muted text-xs flex-1 min-w-[200px]">
                {saveNote
                  || (room?.offered?.configured
                    ? 'Ticked voices are what /api/tts will synthesise. Unticking every voice restores the Google defaults.'
                    : 'No selection saved yet — the Google defaults are standing in. Tick and save to choose.')}
              </p>
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
