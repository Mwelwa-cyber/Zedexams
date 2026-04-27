import { useCallback, useEffect, useRef, useState } from 'react'
import { auth } from '../../firebase/config'

/**
 * Inline chat panel embedded directly in the admin dashboard. Same backend
 * (/api/zed/chat) and same Claude tool-loop as the Telegram bot and the
 * floating ZedAdminChat widget, but with its own thread cache so users can
 * keep separate conversations open in the floating bubble vs. on the
 * dashboard.
 */

const STORAGE_KEY = 'zed-dashboard-chat:v1'
const ENDPOINT = '/api/zed/chat'
const MAX_PERSISTED_MESSAGES = 50

function loadCached() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((m) => m && typeof m.role === 'string' && typeof m.text === 'string')
      .slice(-MAX_PERSISTED_MESSAGES)
  } catch {
    return []
  }
}

function persistCache(messages) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_PERSISTED_MESSAGES))
    )
  } catch {
    /* sessionStorage may be disabled or quota-full; surfacing this would
       just spam the console for a non-critical feature. */
  }
}

const SUGGESTIONS = [
  "What's left on games?",
  'Summarize today’s learner activity',
  'Make 5 Grade 5 Maths questions on fractions',
  'Draft a Claude prompt to fix the quiz editor',
]

export default function ZedDashboardPanel() {
  const [messages, setMessages] = useState(loadCached)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const inFlightRef = useRef(false)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { persistCache(messages) }, [messages])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const send = useCallback(async (override) => {
    const message = String(override ?? input).trim()
    if (!message || inFlightRef.current) return
    inFlightRef.current = true
    setSending(true)
    setError('')
    if (!override) setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: message }])

    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Please sign in again.')
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      const reply = String(data?.reply || '').trim() || "I didn't catch that — try again."
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }])
    } catch (err) {
      console.error('[ZedDashboardPanel]', err)
      setError(err?.message || 'Network error')
    } finally {
      // eslint-disable-next-line require-atomic-updates
      inFlightRef.current = false
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const clearChat = () => {
    if (!window.confirm('Clear the visible chat? Zed will still remember context server-side.')) return
    setMessages([])
    setError('')
  }

  return (
    <section
      aria-label="Talk to Zed"
      className="bg-white rounded-2xl border theme-border shadow-elev-md overflow-hidden flex flex-col"
      style={{ minHeight: 420 }}
    >
      <header className="flex items-center gap-3 px-5 py-3 border-b theme-border bg-gradient-to-r from-emerald-500 to-emerald-600 text-white">
        <picture>
          <source type="image/webp" srcSet="/images/characters/zedbot-help.webp?v=1" />
          <img
            src="/images/characters/zedbot-help.png"
            alt=""
            width={36}
            height={36}
            draggable={false}
            style={{ width: 36, height: 36, objectFit: 'contain', userSelect: 'none' }}
          />
        </picture>
        <div className="flex-1 min-w-0">
          <p className="font-black text-base leading-tight">Zed</p>
          <p className="text-xs opacity-90">Your in-app assistant — same brain, web-native</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            aria-label="Clear visible chat"
            title="Clear chat"
            className="rounded-md px-2 py-1 text-sm hover:bg-white/15 transition-colors"
          >
            Clear
          </button>
        )}
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-4 bg-gray-50 flex flex-col gap-2"
        style={{ minHeight: 280, maxHeight: 460 }}
      >
        {messages.length === 0 && (
          <div className="m-auto max-w-md text-center">
            <p className="text-sm text-gray-600 mb-3">
              Ask anything about ZedExams. He can read Firestore, browse the live site, draft prompts, and generate CBC content.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={sending}
                  className="text-xs px-3 py-1.5 rounded-full border theme-border bg-white hover:bg-emerald-50 hover:border-emerald-300 transition-colors text-gray-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
              m.role === 'user'
                ? 'self-end bg-emerald-500 text-white'
                : 'self-start bg-white border theme-border text-gray-800'
            }`}
          >
            {m.text}
          </div>
        ))}
        {sending && (
          <div className="self-start bg-white border theme-border rounded-2xl px-3 py-2 text-sm text-gray-500 italic">
            Zed is thinking…
          </div>
        )}
        {error && (
          <div className="self-stretch bg-red-50 text-red-800 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="flex gap-2 p-3 border-t theme-border bg-white">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          placeholder="Message Zed…"
          rows={1}
          className="flex-1 resize-none px-3 py-2 rounded-lg border theme-border text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
          style={{ maxHeight: 120 }}
        />
        <button
          type="button"
          onClick={() => send()}
          disabled={sending || !input.trim()}
          className="px-4 rounded-lg font-bold text-sm text-white transition-colors"
          style={{
            background: sending || !input.trim() ? '#d1d5db' : '#10B981',
            cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </section>
  )
}
