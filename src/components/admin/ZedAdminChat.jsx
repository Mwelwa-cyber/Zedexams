import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { auth } from '../../firebase/config'

const STORAGE_KEY = 'zed-admin-chat:v1'
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

function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' && !window.matchMedia('(min-width: 640px)').matches
  )
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const mq = window.matchMedia('(min-width: 640px)')
    const handler = (e) => setNarrow(!e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return narrow
}

export default function ZedAdminChat() {
  const { currentUser, isAdmin } = useAuth()
  const narrow = useIsNarrow()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(loadCached)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const inFlightRef = useRef(false)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { persistCache(messages) }, [messages])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    inputRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = useCallback(async () => {
    const message = input.trim()
    if (!message || inFlightRef.current) return
    inFlightRef.current = true
    setSending(true)
    setError('')
    setInput('')
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
      console.error('[ZedAdminChat]', err)
      setError(err?.message || 'Network error')
    } finally {
      // eslint-disable-next-line require-atomic-updates
      inFlightRef.current = false
      setSending(false)
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

  const fab = useMemo(() => narrow
    ? { size: 48, bottom: 16, right: 16 }
    : { size: 56, bottom: 24, right: 24 },
  [narrow])

  if (!currentUser || !isAdmin) return null

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Zed admin chat"
          style={{
            position: 'fixed',
            bottom: fab.bottom,
            right: fab.right,
            width: fab.size,
            height: fab.size,
            padding: 0,
            borderRadius: '50%',
            border: 'none',
            background: '#10B981',
            color: '#fff',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9998,
          }}
        >
          <picture>
            <source type="image/webp" srcSet="/images/characters/zedbot-help.webp?v=1" />
            <img
              src="/images/characters/zedbot-help.png"
              alt=""
              width={fab.size - 8}
              height={fab.size - 8}
              draggable={false}
              style={{
                width: fab.size - 8,
                height: fab.size - 8,
                objectFit: 'contain',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          </picture>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Chat with Zed"
          style={{
            position: 'fixed',
            bottom: narrow ? 0 : 24,
            right: narrow ? 0 : 24,
            left: narrow ? 0 : 'auto',
            top: narrow ? 0 : 'auto',
            width: narrow ? '100%' : 380,
            height: narrow ? '100%' : 540,
            maxHeight: narrow ? '100%' : 'calc(100vh - 48px)',
            background: '#fff',
            borderRadius: narrow ? 0 : 16,
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 9999,
            color: '#111827',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            background: '#10B981',
            color: '#fff',
            flexShrink: 0,
          }}>
            <strong style={{ flex: 1, fontSize: 15 }}>Zed</strong>
            <button
              type="button"
              onClick={clearChat}
              aria-label="Clear chat"
              title="Clear chat"
              style={iconBtnStyle}
            >
              ⌫
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              title="Close"
              style={iconBtnStyle}
            >
              ×
            </button>
          </header>

          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              background: '#f9fafb',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {messages.length === 0 && (
              <p style={{ color: '#6b7280', fontSize: 13, margin: 'auto', textAlign: 'center' }}>
                Ask Zed anything — same brain as the Telegram bot.
                <br />Try: "What's left on games?"
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  padding: '8px 12px',
                  borderRadius: 14,
                  background: m.role === 'user' ? '#10B981' : '#fff',
                  color: m.role === 'user' ? '#fff' : '#111827',
                  border: m.role === 'user' ? 'none' : '1px solid #e5e7eb',
                  fontSize: 14,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {m.text}
              </div>
            ))}
            {sending && (
              <div style={{
                alignSelf: 'flex-start',
                padding: '8px 12px',
                borderRadius: 14,
                background: '#fff',
                border: '1px solid #e5e7eb',
                color: '#6b7280',
                fontSize: 13,
                fontStyle: 'italic',
              }}>
                Zed is thinking…
              </div>
            )}
            {error && (
              <div style={{
                alignSelf: 'stretch',
                padding: '8px 12px',
                borderRadius: 8,
                background: '#fef2f2',
                color: '#991b1b',
                fontSize: 13,
              }}>
                {error}
              </div>
            )}
          </div>

          <div style={{
            display: 'flex',
            gap: 8,
            padding: 10,
            borderTop: '1px solid #e5e7eb',
            background: '#fff',
            flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
              placeholder="Message Zed…"
              rows={1}
              style={{
                flex: 1,
                resize: 'none',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                fontSize: 14,
                fontFamily: 'inherit',
                lineHeight: 1.4,
                maxHeight: 120,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || !input.trim()}
              style={{
                padding: '0 16px',
                borderRadius: 8,
                border: 'none',
                background: sending || !input.trim() ? '#d1d5db' : '#10B981',
                color: '#fff',
                fontWeight: 600,
                cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}

const iconBtnStyle = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'rgba(255,255,255,0.15)',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
