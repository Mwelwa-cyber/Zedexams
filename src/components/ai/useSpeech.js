import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl } from '../../utils/runtime'

/**
 * useSpeech — Cloud-TTS-powered (Google Cloud Text-to-Speech via /api/tts)
 * with automatic fallback to browser speechSynthesis if the cloud is
 * unreachable. Public API is identical to the previous browser-only
 * version, so no consumer changes required.
 *
 * Speech recognition (microphone → text) is untouched from the previous
 * version — same Web Speech API path, same return shape.
 */

const TTS_ENDPOINT = '/api/tts'
const LS_VOICE_KEY = 'examprep:zedVoiceURI'

// Curated voices our /api/tts Firebase Function will accept.
// First item is the default. Names are user-facing.
const CLOUD_VOICES = [
  { voiceURI: 'en-GB-Neural2-A',  name: 'British Female (Neural)',   lang: 'en-GB' },
  { voiceURI: 'en-GB-Neural2-B',  name: 'British Male (Neural)',     lang: 'en-GB' },
  { voiceURI: 'en-ZA-Standard-A', name: 'South African Female',      lang: 'en-ZA' },
  { voiceURI: 'en-ZA-Standard-B', name: 'South African Male',        lang: 'en-ZA' },
  { voiceURI: 'en-GB-Studio-B',   name: 'British Male (Studio HQ)',  lang: 'en-GB' },
  { voiceURI: 'en-GB-Studio-C',   name: 'British Female (Studio HQ)',lang: 'en-GB' },
  { voiceURI: 'en-US-Neural2-F',  name: 'American Female (Neural)',  lang: 'en-US' },
  { voiceURI: 'en-US-Neural2-J',  name: 'American Male (Neural)',    lang: 'en-US' },
  { voiceURI: 'en-GB-Standard-A', name: 'British (Standard)',        lang: 'en-GB' },
]

export function useSpeech() {
  const supported = typeof window !== 'undefined' && typeof window.Audio !== 'undefined'

  const [voices] = useState(CLOUD_VOICES)
  const [voiceURI, setVoiceURI] = useState(() => {
    if (typeof localStorage === 'undefined') return ''
    try { return localStorage.getItem(LS_VOICE_KEY) || '' } catch { return '' }
  })
  const [speaking, setSpeaking] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const activeIdRef  = useRef(null)
  const audioRef     = useRef(null)
  const objectUrlRef = useRef(null)

  const voice = useMemo(() => {
    if (voiceURI) {
      const match = voices.find(v => v.voiceURI === voiceURI)
      if (match) return match
    }
    return voices[0] // default: en-GB-Neural2-A
  }, [voices, voiceURI])

  const setVoice = useCallback((uri) => {
    setVoiceURI(uri || '')
    try { localStorage.setItem(LS_VOICE_KEY, uri || '') } catch { /* storage may be disabled */ }
  }, [])

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      try { audioRef.current.pause() } catch { /* ignore */ }
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      try { URL.revokeObjectURL(objectUrlRef.current) } catch { /* ignore */ }
      objectUrlRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    cleanupAudio()
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    setSpeaking(false)
    setActiveId(null)
    activeIdRef.current = null
  }, [cleanupAudio])

  // Browser fallback used only when Cloud TTS fails (network down, etc.)
  const speakBrowserFallback = useCallback((text, id) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setSpeaking(false); setActiveId(null); activeIdRef.current = null
      return
    }
    const synth = window.speechSynthesis
    synth.cancel()
    const chunks = chunkBySentence(text, 200)
    if (!chunks.length) {
      setSpeaking(false); setActiveId(null); activeIdRef.current = null
      return
    }
    chunks.forEach((chunk, index) => {
      const utter = new window.SpeechSynthesisUtterance(chunk)
      utter.lang = voice?.lang || 'en-GB'
      utter.rate = 0.98
      utter.pitch = 1.0
      utter.volume = 1.0
      if (index === chunks.length - 1) {
        const finish = () => {
          if (activeIdRef.current === id) {
            setSpeaking(false); setActiveId(null); activeIdRef.current = null
          }
        }
        utter.onend = finish
        utter.onerror = finish
      }
      synth.speak(utter)
    })
  }, [voice])

  const speak = useCallback(async (rawText, id = null) => {
    if (!supported) return
    const text = stripMarkdown(rawText)
    if (!text) return

    cleanupAudio()
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }

    setSpeaking(true)
    setActiveId(id)
    activeIdRef.current = id

    try {
      const res = await fetch(apiUrl(TTS_ENDPOINT), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text:  text.slice(0, 3000), // backend cap
          voice: readLatestVoiceURI() || voice?.voiceURI || 'en-GB-Neural2-A',
          rate:  0.98,                 // gentle teacher pacing
        }),
      })
      if (!res.ok) throw new Error(`Cloud TTS ${res.status}`)

      const blob  = await res.blob()
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current     = audio
      objectUrlRef.current = url

      const finish = () => {
        if (activeIdRef.current === id) {
          setSpeaking(false); setActiveId(null); activeIdRef.current = null
        }
        cleanupAudio()
      }
      audio.onended = finish
      audio.onerror = finish

      await audio.play()
    } catch (err) {
      console.warn('[useSpeech] Cloud TTS failed, falling back to browser:', err?.message || err)
      speakBrowserFallback(text, id)
    }
  }, [supported, voice, cleanupAudio, speakBrowserFallback])

  // Cancel any speech on unmount
  useEffect(() => {
    return () => {
      cleanupAudio()
      try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    }
  }, [cleanupAudio])

  /* ────────────────────────────────────────────────────────────────────
   * Speech recognition (microphone → text) — unchanged from previous
   * ──────────────────────────────────────────────────────────────────── */

  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null
  const recognitionSupported = Boolean(SpeechRecognition)
  const [listening,         setListening]         = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript,   setFinalTranscript]   = useState('')
  const [recognitionError,  setRecognitionError]  = useState(null)
  const recognitionRef     = useRef(null)
  const committedFinalRef  = useRef('')

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* already stopped */ }
      recognitionRef.current = null
    }
    setListening(false)
  }, [])

  const startListening = useCallback(() => {
    if (!recognitionSupported) return
    cleanupAudio()
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    const rec = new SpeechRecognition()
    rec.lang            = voice?.lang || 'en-GB'
    rec.continuous      = true
    rec.interimResults  = true
    rec.maxAlternatives = 1
    rec.onstart = () => { committedFinalRef.current = '' }
    rec.onresult = (event) => {
      let interim = ''
      let allFinal = ''
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) allFinal += r[0].transcript + ' '
        else           interim  += r[0].transcript
      }
      allFinal = allFinal.replace(/\s+/g, ' ').trim()
      if (allFinal.length > committedFinalRef.current.length
          && allFinal.startsWith(committedFinalRef.current)) {
        const newSegment = allFinal.slice(committedFinalRef.current.length).trim()
        committedFinalRef.current = allFinal
        if (newSegment) setFinalTranscript(newSegment)
      } else if (allFinal && allFinal !== committedFinalRef.current) {
        committedFinalRef.current = allFinal
        setFinalTranscript(allFinal)
      }
      setInterimTranscript(interim)
    }
    rec.onerror = (e) => {
      if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        setRecognitionError(friendlyRecognitionError(e.error))
      }
      stopListening()
    }
    rec.onend = () => {
      setListening(false)
      setInterimTranscript('')
      recognitionRef.current = null
    }
    try {
      committedFinalRef.current = ''
      rec.start()
      recognitionRef.current = rec
      setListening(true)
      setInterimTranscript('')
      setRecognitionError(null)
    } catch (err) {
      setRecognitionError('Could not start the microphone. Is another tab using it?')
    }
  }, [recognitionSupported, SpeechRecognition, voice, stopListening, cleanupAudio])

  const resetTranscript = useCallback(() => {
    setFinalTranscript('')
    setInterimTranscript('')
    setRecognitionError(null)
  }, [])

  useEffect(() => {
    if (!recognitionSupported) return undefined
    return () => stopListening()
  }, [recognitionSupported, stopListening])

  return {
    // Text-to-speech
    supported, voices, voice, setVoice, speaking, activeId, speak, stop,
    // Speech-to-text (microphone)
    recognitionSupported,
    listening,
    interimTranscript,
    finalTranscript,
    recognitionError,
    startListening,
    stopListening,
    resetTranscript,
  }
}

function friendlyRecognitionError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Enable mic permission in your browser settings and try again.'
    case 'audio-capture':
      return 'No microphone detected. Check that your device has one connected.'
    case 'network':
      return 'Network error while transcribing. Check your connection.'
    case 'language-not-supported':
      return 'The selected language is not supported for voice input on this device.'
    default:
      return 'Voice input stopped unexpectedly. Tap the mic to try again.'
  }
}

function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function chunkBySentence(text, maxLen = 200) {
  if (!text) return []
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    if (!sentence.trim()) continue
    if (current && (current.length + 1 + sentence.length) > maxLen) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}
function readLatestVoiceURI() {
  if (typeof localStorage === 'undefined') return null
  try {
    const saved = localStorage.getItem(LS_VOICE_KEY)
    if (!saved) return null
    const match = CLOUD_VOICES.find(v => v.voiceURI === saved)
    return match ? match.voiceURI : null
  } catch {
    return null
  }
}