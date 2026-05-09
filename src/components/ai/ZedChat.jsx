/**
 * ZedChat — the long-promised Zed AI study assistant UI (audit A6).
 *
 * Backend is already in place:
 *   - functions/index.js: `apiAiChat` (SSE) + `aiChat` (callable fallback)
 *   - src/utils/aiAssistant.js: `sendAIChatStream` handles transport
 *   - src/components/ai/useSpeech.js: STT (mic input) + TTS (read-aloud)
 *
 * The audit asked for "voice mode" — A6 — which collapses into three
 * things on the client side:
 *   1. A chat surface that calls sendAIChatStream and renders tokens live.
 *   2. A mic button on the input that calls startListening from useSpeech.
 *   3. A "speak" button on each assistant message that calls speak().
 *
 * Older learners (Gr 5+) can type. Younger ones (Gr 1–4) tap the mic and
 * Pako reads the answer back. Same component, just different muscle.
 *
 * Streaming UX:
 *   - First token → typing indicator collapses into the live message.
 *   - User can cancel mid-stream (Stop button replaces Send).
 *   - Network drop / [ERROR] event → inline error bubble; the user can
 *     retry without losing earlier turns.
 *
 * Persistence:
 *   - History survives within a tab via sessionStorage (so a learner who
 *     closes the launcher and re-opens it keeps the thread).
 *   - Cleared on full reload — keeps things tidy and avoids leaking
 *     conversations between sessions on shared devices.
 *
 * Capacitor + DEV: useSpeech and sendAIChatStream both have non-streaming
 * fallbacks already; this component does nothing platform-specific.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { sendAIChatStream } from '../../utils/aiAssistant'
import { useSpeech } from './useSpeech'
import ProfessorPako from '../ui/ProfessorPako'
import Icon from '../ui/Icon'
import { Mic, Send, Sparkles, Volume2, VolumeX, X } from '../ui/icons'

const SESSION_HISTORY_KEY = 'zedexams:zed-chat-history:v1'
const MAX_HISTORY = 20 // server caps further; this is just for the UI thread.

// Suggested prompts surfaced on first load. Tuned to be Gr 4–7 friendly
// and lead with a verb so a younger learner immediately knows what
// happens when they tap.
const SUGGESTIONS = [
  { icon: '📐', label: 'Help me with fractions',         prompt: 'Can you help me understand fractions with a simple example?' },
  { icon: '🌱', label: 'Explain photosynthesis',         prompt: 'Explain photosynthesis to me like I am in Grade 5.' },
  { icon: '📖', label: 'Practise English vocabulary',    prompt: 'Give me five Grade 6 English vocabulary words and use each in a sentence.' },
  { icon: '🌍', label: 'Tell me a Zambia fact',          prompt: 'Tell me one interesting fact about Zambia I can share with my class.' },
]

function loadHistory() {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(SESSION_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(-MAX_HISTORY)
  } catch {
    return []
  }
}

function saveHistory(messages) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)))
  } catch { /* quota exceeded — fine, just lose the persistence */ }
}

// History chunks sent to the server are role/content shaped (Anthropic
// expects 'user' | 'assistant'). Map our internal `kind` to that shape.
function toServerHistory(messages) {
  return messages
    .filter((m) => m.kind === 'user' || m.kind === 'assistant')
    .map((m) => ({ role: m.kind, content: m.text }))
}

function MessageRow({ message, onSpeak, isSpeaking }) {
  const isUser = message.kind === 'user'
  const isError = message.kind === 'error'
  const align = isUser ? 'justify-end' : 'justify-start'
  return (
    <div className={`flex ${align} gap-2 mb-3`}>
      {!isUser && !isError && (
        <div className="flex-shrink-0 self-end">
          <ProfessorPako size={32} animate={false} />
        </div>
      )}
      <div className="flex flex-col max-w-[85%] sm:max-w-[75%]">
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'theme-accent-fill theme-on-accent rounded-br-md'
              : isError
                ? 'bg-rose-50 text-rose-900 border border-rose-200 rounded-bl-md'
                : 'theme-card border theme-border rounded-bl-md theme-text'
          }`}
        >
          {message.text || (message.streaming ? '…' : '')}
          {message.streaming && (
            <span aria-hidden="true" className="inline-flex gap-0.5 ml-2 align-middle">
              <span className="w-1.5 h-1.5 rounded-full theme-text-muted animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full theme-text-muted animate-pulse [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full theme-text-muted animate-pulse [animation-delay:0.3s]" />
            </span>
          )}
        </div>
        {/* Read-aloud control for assistant messages, hidden while
            streaming so it doesn't fire on partial text. */}
        {!isUser && !isError && !message.streaming && message.text && (
          <button
            type="button"
            onClick={() => onSpeak(message)}
            className="self-start mt-1 inline-flex items-center gap-1 text-[11px] font-bold theme-text-muted hover:theme-accent-text"
          >
            <Icon as={isSpeaking ? VolumeX : Volume2} size="xs" strokeWidth={2.1} />
            {isSpeaking ? 'Stop' : 'Read aloud'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function ZedChat({ onClose, mode = 'panel' }) {
  const { currentUser } = useAuth()
  const {
    speak, stop: stopSpeaking, speaking, activeId,
    recognitionSupported, listening, interimTranscript, finalTranscript,
    recognitionError, startListening, stopListening, resetTranscript,
  } = useSpeech()

  const [messages, setMessages] = useState(() => loadHistory())
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const cancelStreamRef = useRef(null)
  const messagesEndRef = useRef(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Persist the thread within the tab so closing+reopening the launcher
  // doesn't blow it away. Cleared on full reload.
  useEffect(() => {
    saveHistory(messages)
  }, [messages])

  // Auto-scroll to the bottom when new tokens arrive — but only if the
  // user is already near the bottom. Don't yank them up if they scrolled
  // up to re-read an earlier answer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 120) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  // Mirror live STT into the input so the learner sees their words
  // appearing as they speak (interim) + the committed final segment.
  useEffect(() => {
    if (!listening) return
    const live = `${finalTranscript ?? ''} ${interimTranscript ?? ''}`.trim()
    if (live) setInput(live)
  }, [listening, interimTranscript, finalTranscript])

  // When recognition stops (user tapped mic again, or auto-ended), keep
  // whatever was committed and clear the buffer for next time.
  useEffect(() => {
    if (listening) return
    resetTranscript()
  }, [listening, resetTranscript])

  // Tear down any in-flight stream on unmount so closing the launcher
  // mid-reply doesn't leak callbacks.
  useEffect(() => () => { cancelStreamRef.current?.() }, [])

  const canSend = !streaming && input.trim().length > 0 && !!currentUser

  const handleSubmit = useCallback((promptOverride) => {
    const text = (promptOverride ?? input).trim()
    if (!text || streaming || !currentUser) return

    const userMsg = { id: `u-${Date.now()}`, kind: 'user', text }
    const assistantId = `a-${Date.now() + 1}`
    const assistantMsg = { id: assistantId, kind: 'assistant', text: '', streaming: true }
    const next = [...messages, userMsg, assistantMsg]
    setMessages(next)
    setInput('')
    setStreaming(true)

    // Stop any STT / TTS that might be running so audio doesn't overlap
    // with the new question.
    if (listening) stopListening()
    if (speaking) stopSpeaking()

    cancelStreamRef.current = sendAIChatStream({
      message: text,
      history: toServerHistory(messages), // exclude the just-appended pair
      onToken: (chunk) => {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, text: (m.text || '') + chunk } : m,
        ))
      },
      onDone: (full) => {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, text: full || m.text || '', streaming: false } : m,
        ))
        setStreaming(false)
        cancelStreamRef.current = null
      },
      onError: (err) => {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId
            ? {
              ...m,
              kind: 'error',
              text: err?.message || 'Zed is unavailable right now. Please try again.',
              streaming: false,
            }
            : m,
        ))
        setStreaming(false)
        cancelStreamRef.current = null
      },
    })
  }, [currentUser, input, listening, messages, speaking, stopListening, stopSpeaking, streaming])

  const handleStop = useCallback(() => {
    cancelStreamRef.current?.()
    cancelStreamRef.current = null
    setStreaming(false)
    // Mark any still-streaming message as done so the UI clears the
    // typing dots. Keep the partial text — it might still be useful.
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)))
  }, [])

  const handleClear = useCallback(() => {
    cancelStreamRef.current?.()
    cancelStreamRef.current = null
    setStreaming(false)
    setMessages([])
    setInput('')
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem(SESSION_HISTORY_KEY) } catch { /* ignore */ }
    }
    inputRef.current?.focus()
  }, [])

  const handleSpeak = useCallback((message) => {
    if (speaking && activeId === message.id) {
      stopSpeaking()
      return
    }
    speak(message.text, message.id)
  }, [activeId, speak, speaking, stopSpeaking])

  const handleMic = useCallback(() => {
    if (listening) {
      stopListening()
      return
    }
    if (speaking) stopSpeaking()
    setInput('')
    resetTranscript()
    startListening()
  }, [listening, resetTranscript, speaking, startListening, stopListening, stopSpeaking])

  function handleKeyDown(e) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
      e.preventDefault()
      if (canSend) handleSubmit()
    }
  }

  const showSuggestions = messages.length === 0
  const containerCls = mode === 'page'
    ? 'flex flex-col h-full max-h-screen'
    : 'flex flex-col h-full'

  const headerSubtitle = useMemo(() => {
    if (!currentUser) return 'Sign in to chat with Zed.'
    if (streaming) return 'Zed is thinking…'
    if (listening) return 'Listening — tap the mic again to stop.'
    return 'Your friendly CBC study buddy'
  }, [currentUser, listening, streaming])

  return (
    <div className={containerCls} role="region" aria-label="Zed AI study assistant">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b theme-border theme-card flex-shrink-0">
        <div className="flex-shrink-0">
          <ProfessorPako size={40} animate={false} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="theme-text font-black text-base leading-none flex items-center gap-1.5">
            Ask Zed
            <Icon as={Sparkles} size="xs" strokeWidth={2.1} className="theme-accent-text" />
          </p>
          <p className="theme-text-muted text-xs mt-1 truncate">{headerSubtitle}</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs font-bold theme-text-muted hover:theme-text px-2 py-1 rounded-full"
            disabled={streaming}
          >
            Clear
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Zed chat"
            className="theme-text-muted hover:theme-text rounded-full p-2"
          >
            <Icon as={X} size="md" strokeWidth={2.1} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 theme-bg">
        {showSuggestions ? (
          <div className="max-w-md mx-auto text-center pt-4">
            <ProfessorPako size={88} mood="happy" />
            <h2 className="theme-text font-black text-xl mt-3">Hi! I&apos;m Zed.</h2>
            <p className="theme-text-muted text-sm mt-2 max-w-xs mx-auto leading-snug">
              Ask me anything about CBC subjects — fractions, science experiments,
              English grammar. I&apos;ll explain it your way.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => handleSubmit(s.prompt)}
                  disabled={!currentUser || streaming}
                  className="theme-card border theme-border rounded-radius-md p-3 text-left hover:theme-bg-subtle theme-text text-sm font-bold disabled:opacity-50 transition-colors"
                >
                  <span className="text-lg mr-1.5" aria-hidden="true">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                onSpeak={handleSpeak}
                isSpeaking={speaking && activeId === m.id}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t theme-border theme-card p-3 flex-shrink-0">
        {recognitionError && (
          <p role="alert" className="text-xs font-bold text-rose-700 mb-2 px-1">{recognitionError}</p>
        )}
        <div className="flex items-end gap-2">
          {recognitionSupported && (
            <button
              type="button"
              onClick={handleMic}
              disabled={!currentUser || streaming}
              aria-label={listening ? 'Stop listening' : 'Speak your question'}
              aria-pressed={listening}
              className={`flex-shrink-0 rounded-full p-3 border-2 transition-colors disabled:opacity-50 ${
                listening
                  ? 'bg-rose-500 border-rose-500 text-white animate-pulse'
                  : 'theme-border theme-text-muted hover:theme-accent-text hover:theme-bg-subtle'
              }`}
            >
              <Icon as={Mic} size="md" strokeWidth={2.1} />
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? 'Speak now…' : 'Ask Zed anything…'}
            disabled={!currentUser || streaming}
            rows={1}
            className="flex-1 min-h-[44px] max-h-32 resize-y rounded-2xl border-2 theme-border theme-input px-3 py-2 text-sm focus:outline-none focus:border-current disabled:opacity-50"
          />
          {streaming ? (
            <button
              type="button"
              onClick={handleStop}
              aria-label="Stop Zed"
              className="flex-shrink-0 rounded-full p-3 bg-rose-500 text-white border-2 border-rose-500 hover:bg-rose-600"
            >
              <Icon as={X} size="md" strokeWidth={2.1} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!canSend}
              aria-label="Send to Zed"
              className="flex-shrink-0 rounded-full p-3 theme-accent-fill theme-on-accent border-2 border-transparent hover:opacity-90 disabled:opacity-50"
            >
              <Icon as={Send} size="md" strokeWidth={2.1} />
            </button>
          )}
        </div>
        {!currentUser && (
          <p className="text-xs theme-text-muted mt-2 px-1">
            Sign in to start chatting with Zed.
          </p>
        )}
      </div>
    </div>
  )
}
