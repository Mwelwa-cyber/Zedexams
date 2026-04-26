import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeech } from '../ai/useSpeech'
import { auth } from '../../firebase/config'

/**
 * /admin/zed-voice — phone-call-style UI for talking to the Telegram Zed
 * agent over the same Claude tool-loop, but from a browser. Reuses the
 * cloud-TTS-backed useSpeech() hook for both STT (Web Speech) and TTS
 * (/api/tts). Backend lives in functions/zedAssistant/web.js, exposed as
 * /api/zed/chat (admin-only Bearer auth).
 *
 * Conversation flow:
 *   idle  → tap "Start" → mic permission prompt
 *   listening (speech.startListening) → user speaks
 *     → interim text updates, finalTranscript chunks accumulate in
 *       `pendingRef`
 *     → after SILENCE_MS of no interim updates, the accumulated turn is
 *       posted to /api/zed/chat
 *   thinking (waiting on the agent)
 *   speaking (speech.speak() of the reply)
 *     → listening is paused while Zed talks (avoids self-listening)
 *     → resumes automatically when speech.speaking flips false
 */

const SILENCE_MS = 1200

const STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  ERROR: 'error',
}

const STATE_LABEL = {
  idle: 'Tap to call Zed',
  listening: 'Listening…',
  thinking: 'Zed is thinking…',
  speaking: 'Zed is speaking…',
  error: 'Something went wrong',
}

const STATE_COLOR = {
  idle: '#6b7280',
  listening: '#10b981',
  thinking: '#f59e0b',
  speaking: '#3b82f6',
  error: '#ef4444',
}

export default function ZedVoice() {
  const navigate = useNavigate()
  const speech = useSpeech()
  const [callState, setCallState] = useState(STATES.IDLE)
  const [transcript, setTranscript] = useState([]) // [{role, text}]
  const [errorMsg, setErrorMsg] = useState('')

  const pendingRef = useRef('') // accumulated final-transcript segments
  const silenceTimerRef = useRef(null)
  const inFlightRef = useRef(false)
  const callStateRef = useRef(callState)
  useEffect(() => { callStateRef.current = callState }, [callState])

  // useSpeech returns a fresh object every render. Pin the latest copy in a
  // ref so effects that genuinely only care about a primitive (e.g. the new
  // finalTranscript chunk) don't re-fire on every re-render and double-append.
  const speechRef = useRef(speech)
  useEffect(() => { speechRef.current = speech })

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }

  const sendTurn = useCallback(async (userText) => {
    const message = String(userText || '').trim()
    if (!message || inFlightRef.current) return
    inFlightRef.current = true
    setCallState(STATES.THINKING)
    setTranscript((prev) => [...prev, { role: 'user', text: message }])

    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Not signed in')
      const res = await fetch('/api/zed/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      const reply = String(data?.reply || '').trim() || "I didn't catch that — try again."
      setTranscript((prev) => [...prev, { role: 'assistant', text: reply }])
      setCallState(STATES.SPEAKING)
      speechRef.current.speak(reply, 'zed-voice-reply')
      // The `speech.speaking → false` effect below resumes listening.
    } catch (err) {
      console.error('[ZedVoice] /api/zed/chat failed', err)
      setErrorMsg(err?.message || 'Network error')
      setCallState(STATES.ERROR)
    } finally {
      // Guarded by the early `inFlightRef.current` check at function entry;
      // only one fetch is ever in flight, so this assignment is safe.
      // eslint-disable-next-line require-atomic-updates
      inFlightRef.current = false
    }
  }, [])
  const sendTurnRef = useRef(sendTurn)
  useEffect(() => { sendTurnRef.current = sendTurn })

  const fireTurnAfterSilence = useCallback(() => {
    const turn = pendingRef.current.trim()
    pendingRef.current = ''
    if (!turn) return
    speechRef.current.stopListening()
    sendTurnRef.current(turn)
  }, [])

  // Accumulate final transcript chunks → schedule a send after SILENCE_MS.
  // Depend ONLY on the primitive value. Including the whole speech object
  // would make this re-fire on every useSpeech render and double-append the
  // same chunk into pendingRef before resetTranscript clears it.
  useEffect(() => {
    const chunk = speech.finalTranscript
    if (!chunk) return
    pendingRef.current = pendingRef.current
      ? `${pendingRef.current} ${chunk}`
      : chunk
    speechRef.current.resetTranscript()
    clearSilenceTimer()
    silenceTimerRef.current = setTimeout(fireTurnAfterSilence, SILENCE_MS)
  }, [speech.finalTranscript, fireTurnAfterSilence])

  // Reset silence timer on each interim update (user is still talking).
  useEffect(() => {
    if (!speech.interimTranscript) return
    clearSilenceTimer()
    silenceTimerRef.current = setTimeout(fireTurnAfterSilence, SILENCE_MS)
  }, [speech.interimTranscript, fireTurnAfterSilence])

  // After Zed finishes speaking, resume listening if we're still on the call.
  useEffect(() => {
    if (callStateRef.current !== STATES.SPEAKING) return
    if (speech.speaking) return
    setCallState(STATES.LISTENING)
    if (speechRef.current.recognitionSupported) {
      speechRef.current.startListening()
    }
  }, [speech.speaking])

  // Surface STT errors from the hook.
  useEffect(() => {
    if (!speech.recognitionError) return
    setErrorMsg(speech.recognitionError)
    setCallState(STATES.ERROR)
  }, [speech.recognitionError])

  const startCall = useCallback(() => {
    if (!speechRef.current.recognitionSupported) {
      setErrorMsg('Voice input is not supported in this browser. Try Chrome on desktop.')
      setCallState(STATES.ERROR)
      return
    }
    setErrorMsg('')
    setTranscript([])
    pendingRef.current = ''
    clearSilenceTimer()
    setCallState(STATES.LISTENING)
    speechRef.current.startListening()
  }, [])

  const endCall = useCallback(() => {
    clearSilenceTimer()
    pendingRef.current = ''
    speechRef.current.stopListening()
    speechRef.current.stop()
    setCallState(STATES.IDLE)
  }, [])

  // Cleanup on unmount.
  useEffect(() => () => {
    clearSilenceTimer()
    speechRef.current.stopListening()
    speechRef.current.stop()
  }, [])

  const isCalling = callState !== STATES.IDLE && callState !== STATES.ERROR
  const ringColor = STATE_COLOR[callState] || '#6b7280'

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>Talk to Zed</h1>
        <p style={styles.subtitle}>
          Voice call to your Telegram assistant. Same Claude tool-loop, same
          tools. Conversation memory is separate from Telegram.
        </p>

        <div style={styles.stage}>
          <div
            style={{
              ...styles.ring,
              boxShadow: `0 0 0 8px ${ringColor}22, 0 0 0 16px ${ringColor}11`,
              borderColor: ringColor,
            }}
            aria-live="polite"
          >
            <div style={{ ...styles.dot, background: ringColor }} />
          </div>
          <div style={{ ...styles.state, color: ringColor }}>
            {STATE_LABEL[callState]}
          </div>
          {speech.interimTranscript && (
            <div style={styles.interim}>"{speech.interimTranscript}"</div>
          )}
        </div>

        <div style={styles.voicePicker}>
          <label htmlFor="zed-voice-select" style={styles.voiceLabel}>
            Zed&rsquo;s voice
          </label>
          <select
            id="zed-voice-select"
            value={speech.voice?.voiceURI || ''}
            onChange={(e) => speech.setVoice(e.target.value)}
            disabled={speech.speaking}
            style={styles.voiceSelect}
          >
            {speech.voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.actions}>
          {!isCalling ? (
            <button onClick={startCall} style={{ ...styles.btn, ...styles.btnStart }}>
              Start call
            </button>
          ) : (
            <button onClick={endCall} style={{ ...styles.btn, ...styles.btnEnd }}>
              End call
            </button>
          )}
          <button onClick={() => navigate('/admin')} style={{ ...styles.btn, ...styles.btnGhost }}>
            Back to admin
          </button>
        </div>

        {errorMsg && <div style={styles.error}>{errorMsg}</div>}

        {transcript.length > 0 && (
          <div style={styles.transcript}>
            <div style={styles.transcriptLabel}>Transcript</div>
            {transcript.map((m, i) => (
              <div key={i} style={styles.turn}>
                <strong style={{ color: m.role === 'user' ? '#10b981' : '#3b82f6' }}>
                  {m.role === 'user' ? 'You' : 'Zed'}:
                </strong>{' '}
                {m.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  wrap: {
    minHeight: '70vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 640,
    background: '#fff',
    borderRadius: 16,
    padding: 32,
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    textAlign: 'center',
  },
  title: { margin: 0, fontSize: 24, color: '#111827' },
  subtitle: { margin: '8px 0 24px', color: '#6b7280', fontSize: 14 },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    margin: '24px 0',
  },
  ring: {
    width: 160,
    height: 160,
    borderRadius: '50%',
    border: '3px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'box-shadow 200ms ease, border-color 200ms ease',
  },
  dot: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    transition: 'background 200ms ease',
  },
  state: { fontSize: 18, fontWeight: 600 },
  interim: { color: '#6b7280', fontStyle: 'italic', maxWidth: 480 },
  voicePicker: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: '8px 0 16px',
    fontSize: 14,
    color: '#6b7280',
  },
  voiceLabel: { fontWeight: 500 },
  voiceSelect: {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    background: '#fff',
    fontSize: 14,
    color: '#111827',
    cursor: 'pointer',
  },
  actions: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' },
  btn: {
    padding: '12px 24px',
    borderRadius: 10,
    border: 'none',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnStart: { background: '#10b981', color: '#fff' },
  btnEnd: { background: '#ef4444', color: '#fff' },
  btnGhost: { background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb' },
  error: {
    marginTop: 16,
    padding: 12,
    background: '#fef2f2',
    color: '#991b1b',
    borderRadius: 8,
    fontSize: 14,
  },
  transcript: {
    marginTop: 32,
    textAlign: 'left',
    borderTop: '1px solid #e5e7eb',
    paddingTop: 16,
  },
  transcriptLabel: { fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 8 },
  turn: { fontSize: 14, color: '#374151', marginBottom: 8, lineHeight: 1.5 },
}
