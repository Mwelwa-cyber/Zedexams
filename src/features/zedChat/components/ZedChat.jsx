/**
 * ZedChat — the Ask Zed conversation, in the prototype-v5 az- layout
 * (learner redesign step 9).
 *
 * The visual shell is the mockup's, exactly: indigo header (back button,
 * Zed avatar, "Ask Zed" + "Your study helper · online" with the green
 * dot, 🚩 report), an intro card with a personalised greeting, suggestion
 * chips, coral learner bubbles and white Zed bubbles with a mini Zed
 * beside them, the round input bar with the ➤ send circle, and the
 * "school-safe" footer line.
 *
 * The machinery underneath is unchanged from the original surface:
 *   - sendAIChatStream renders tokens live (SSE via apiAiChat, callable
 *     fallback); Stop replaces Send mid-stream; errors become an inline
 *     bubble the learner can recover from.
 *   - useSpeech keeps voice: the mic button dictates into the input, and
 *     every Zed reply has a "Read aloud" control.
 *   - Every Zed reply keeps its Report control (Google Play AI-content
 *     policy: the flag must sit on the response itself); the header 🚩
 *     opens the report form for the latest reply.
 *   - History survives within the tab via sessionStorage.
 *
 * A `topic` prop (from the note reader's "Stuck? Ask Zed about this"
 * pill, via /ask-zed?topic=…) seeds the topic-specific greeting + chips,
 * mirroring the prototype's openAskZed({type:'note', topic}).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { sendAIChatStream } from '../../../utils/aiAssistant'
import { renderChatMarkdown } from '../lib/chatMarkdown'
import { buildAskZedIntro, firstNameOf } from '../lib/askZedCore'
import { useSpeech } from '../../../hooks/useSpeech'
import Icon from '../../../shared/components/Icon'
import { Mic } from '../../../shared/components/icons'
import ReportAiResponse from './ReportAiResponse'
import '../../../shared/styles/learnerTheme.css'
import '../askZed.css'

const ZED_ART = '/images/characters/poses/zed-waving.webp'

const SESSION_HISTORY_KEY = 'zedexams:zed-chat-history:v1'
const MAX_HISTORY = 20 // server caps further; this is just for the UI thread.

// A persisted thread must never carry the transient `streaming` flag — it's
// in-memory UI state, not part of the conversation. If a learner leaves
// mid-reply (which unmounts ZedChat and cancels the stream), the in-flight
// assistant bubble would otherwise be saved with streaming:true and come
// back frozen on the typing dots forever. Strip the flag and drop any empty
// placeholder bubble that never received a token.
function sanitizeForPersist(messages) {
  return messages
    .filter((m) => !(m.streaming && !String(m.text || '').trim()))
    .map((m) => (m.streaming ? { ...m, streaming: false } : m))
}

function loadHistory() {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(SESSION_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return sanitizeForPersist(parsed.slice(-MAX_HISTORY))
  } catch {
    return []
  }
}

function saveHistory(messages) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      SESSION_HISTORY_KEY,
      JSON.stringify(sanitizeForPersist(messages.slice(-MAX_HISTORY))),
    )
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
  // Zed replies arrive as Markdown — render them as HTML so **bold** and
  // bullet lists display formatted instead of as raw asterisks. User and
  // error bubbles stay plain text (no markup, safest for echo).
  const renderAsMarkdown = !isUser && !isError && !!message.text
  const html = useMemo(
    () => (renderAsMarkdown ? renderChatMarkdown(message.text) : ''),
    [renderAsMarkdown, message.text],
  )

  if (isUser) {
    return (
      <div className="lhx-az-row lhx-az-user">
        <div className="lhx-az-bubble lhx-az-b-user">{message.text}</div>
      </div>
    )
  }

  return (
    <div className="lhx-az-row lhx-az-zed">
      <img src={ZED_ART} alt="" aria-hidden="true" />
      <div style={{ maxWidth: '80%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className={`lhx-az-bubble ${isError ? 'lhx-az-b-err' : 'lhx-az-b-zed'}`} style={{ maxWidth: '100%' }}>
          {renderAsMarkdown ? (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            message.text || (message.streaming ? '…' : '')
          )}
          {message.streaming && (
            <span aria-hidden="true" className="lhx-az-typing"><i /><i /><i /></span>
          )}
        </div>
        {/* Read-aloud + report for finished Zed replies. The report path is
            required by Play's AI-Generated Content policy and must sit on
            the response itself. */}
        {!isError && !message.streaming && message.text && (
          <div className="lhx-az-msg-tools">
            <button type="button" className="lhx-az-tool" onClick={() => onSpeak(message)}>
              {isSpeaking ? '⏹ Stop' : '🔊 Read aloud'}
            </button>
            <ReportAiResponse message={message} surface="zed-chat" />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ZedChat({ topic = null, onBack }) {
  const { currentUser, userProfile } = useAuth()
  const {
    speak, stop: stopSpeaking, speaking, activeId,
    recognitionSupported, listening, interimTranscript, finalTranscript,
    recognitionError, startListening, stopListening, resetTranscript,
  } = useSpeech()

  const [messages, setMessages] = useState(() => loadHistory())
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  // Set from the header 🚩: the id of the Zed reply whose report form is
  // opened at the end of the thread.
  const [headerReport, setHeaderReport] = useState(null)
  const cancelStreamRef = useRef(null)
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const { intro, chips } = useMemo(
    () => buildAskZedIntro({
      firstName: firstNameOf(userProfile?.displayName || currentUser?.displayName),
      grade: userProfile?.grade,
      topic,
    }),
    [userProfile, currentUser, topic],
  )

  // Persist the thread within the tab so leaving and coming back doesn't
  // blow it away. Cleared on full reload.
  useEffect(() => { saveHistory(messages) }, [messages])

  // Auto-scroll to the bottom when new tokens arrive — but only if the
  // learner is already near the bottom. Don't yank them up if they
  // scrolled up to re-read an earlier answer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 120) {
      bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
    }
  }, [messages])

  // Mirror live STT into the input so the learner sees their words
  // appearing as they speak (interim) + the committed final segment.
  useEffect(() => {
    if (!listening) return
    const live = `${finalTranscript ?? ''} ${interimTranscript ?? ''}`.trim()
    if (live) setInput(live)
  }, [listening, interimTranscript, finalTranscript])

  // When recognition stops (mic tapped again, or auto-ended), keep
  // whatever was committed and clear the buffer for next time.
  useEffect(() => {
    if (listening) return
    resetTranscript()
  }, [listening, resetTranscript])

  // Tear down any in-flight stream on unmount so navigating away
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
      context: {
        area: 'ask_zed',
        path: typeof window !== 'undefined' ? window.location.pathname : '',
        pageTitle: 'Ask Zed',
        ...(topic ? { topic } : {}),
      },
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
  }, [currentUser, input, listening, messages, speaking, stopListening, stopSpeaking, streaming, topic])

  const handleStop = useCallback(() => {
    cancelStreamRef.current?.()
    cancelStreamRef.current = null
    setStreaming(false)
    // Clear the typing dots. Keep partial text if any was delivered, but DROP
    // an empty placeholder — with server-side output moderation the reply is
    // buffered, so a stop before it arrives leaves no tokens, and clearing the
    // streaming flag first would otherwise strand a blank Zed bubble.
    setMessages((prev) => prev
      .filter((m) => !(m.streaming && !String(m.text || '').trim()))
      .map((m) => (m.streaming ? { ...m, streaming: false } : m)))
  }, [])

  const handleClear = useCallback(() => {
    cancelStreamRef.current?.()
    cancelStreamRef.current = null
    setStreaming(false)
    setMessages([])
    setInput('')
    setHeaderReport(null)
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

  // Header 🚩 — open the report form for the latest finished Zed reply.
  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.kind === 'assistant' && !m.streaming && m.text),
    [messages],
  )
  const handleHeaderFlag = useCallback(() => {
    if (!lastAssistant) return
    setHeaderReport(lastAssistant)
    setTimeout(() => bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }), 60)
  }, [lastAssistant])

  const subtitle = useMemo(() => {
    if (!currentUser) return 'Sign in to chat with Zed'
    if (streaming) return 'Zed is thinking…'
    if (listening) return 'Listening — tap the mic to stop'
    return 'Your study helper · online'
  }, [currentUser, listening, streaming])

  return (
    <>
      {/* Header (prototype .az-top) */}
      <div className="lhx-az-top">
        <button type="button" className="lhx-az-back" aria-label="Go back" onClick={onBack}>‹</button>
        <img src={ZED_ART} alt="" aria-hidden="true" className="lhx-az-ava" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lhx-az-title">Ask Zed</div>
          <div className="lhx-az-sub"><span className="lhx-az-dot" aria-hidden="true" /> {subtitle}</div>
        </div>
        <button
          type="button"
          className="lhx-az-flag"
          title="Report an answer"
          aria-label="Report an answer"
          disabled={!lastAssistant}
          onClick={handleHeaderFlag}
        >
          🚩
        </button>
      </div>

      {/* Thread (prototype .az-scroll) */}
      <div className="lhx-az-scroll" ref={scrollRef}>
        <div className="lhx-az-intro">
          <img src={ZED_ART} alt="" aria-hidden="true" />
          <div className="lhx-az-intro-txt">{intro}</div>
        </div>
        <div className="lhx-az-chips">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              className="lhx-az-chip"
              disabled={!currentUser || streaming}
              onClick={() => handleSubmit(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            onSpeak={handleSpeak}
            isSpeaking={speaking && activeId === m.id}
          />
        ))}

        {headerReport && (
          <ReportAiResponse
            key={`hdr-${headerReport.id}`}
            message={headerReport}
            surface="zed-chat-header"
            defaultOpen
          />
        )}

        {messages.length > 0 && !streaming && (
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <button type="button" className="lhx-az-tool lhx-az-note" style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }} onClick={handleClear}>
              Start a new chat
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar (prototype .az-inputbar) */}
      <div className="lhx-az-inputbar">
        {recognitionSupported && (
          <button
            type="button"
            className={`lhx-az-mic ${listening ? 'is-live' : ''}`}
            onClick={handleMic}
            disabled={!currentUser || streaming}
            aria-label={listening ? 'Stop listening' : 'Speak your question'}
            aria-pressed={listening}
          >
            <Icon as={Mic} size="sm" strokeWidth={2.1} />
          </button>
        )}
        <input
          ref={inputRef}
          className="lhx-az-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent?.isComposing && canSend) handleSubmit()
          }}
          placeholder={listening ? 'Speak now…' : 'Ask Zed a question…'}
          disabled={!currentUser || streaming}
          aria-label="Ask Zed a question"
        />
        {streaming ? (
          <button type="button" className="lhx-az-send is-stop" aria-label="Stop Zed" onClick={handleStop}>✕</button>
        ) : (
          <button type="button" className="lhx-az-send" aria-label="Send to Zed" disabled={!canSend} onClick={() => handleSubmit()}>➤</button>
        )}
      </div>
      {recognitionError && (
        <p role="alert" className="lhx-az-safe" style={{ color: 'var(--lhx-red)' }}>{recognitionError}</p>
      )}

      {/* Safety footer (prototype .az-safe) */}
      <div className="lhx-az-safe">🔒 Ask Zed keeps things school-safe · be kind · online only</div>
    </>
  )
}
