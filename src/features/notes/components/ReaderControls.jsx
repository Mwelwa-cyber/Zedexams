// src/features/notes/components/ReaderControls.jsx
//
// Learner reading aids for study notes: a scroll progress bar, an estimated
// reading time, and a read-aloud (Listen) button using the Web Speech API.
// Rendered above a StudyNoteReader on the learner page. Pure client-side; the
// Listen button hides itself when speechSynthesis is unavailable.

import { useEffect, useState } from 'react'
import { studyReadingTime, studySpeechText } from '../lib/studyBlocks'

export function ReaderControls({ blocks, title }) {
  const [pct, setPct] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const minutes = studyReadingTime(blocks)
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

  // Track page scroll → progress percentage.
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      const p = max > 4 ? Math.min(1, (window.scrollY || doc.scrollTop) / max) : 0
      setPct(Math.round(p * 100))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  // Always stop any in-flight speech when the note unmounts.
  useEffect(() => () => { if (canSpeak) { try { window.speechSynthesis.cancel() } catch { /* ignore */ } } }, [canSpeak])

  const toggleSpeak = () => {
    if (!canSpeak) return
    const ss = window.speechSynthesis
    if (ss.speaking || ss.paused) {
      ss.cancel()
      setSpeaking(false)
      return
    }
    const u = new SpeechSynthesisUtterance(studySpeechText(blocks, title))
    u.rate = 0.95
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    ss.cancel()
    ss.speak(u)
    setSpeaking(true)
  }

  return (
    <div className="sticky top-0 z-10 -mx-4 sm:-mx-5 px-4 sm:px-5 py-2 mb-5 bg-[#FAFAF7]/90 backdrop-blur border-b border-neutral-100">
      <div className="h-1 rounded-full bg-neutral-200 overflow-hidden">
        <div className="h-full bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-2 mt-2 text-xs font-medium text-neutral-500">
        <span>⏱ {minutes} min read</span>
        <span className="text-neutral-300">•</span>
        <span>{pct}% read</span>
        <span className="flex-1" />
        {canSpeak && (
          <button
            type="button"
            onClick={toggleSpeak}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold transition ${
              speaking ? 'bg-[var(--accent)] text-white' : 'bg-neutral-900 text-white hover:opacity-90'
            }`}
          >
            {speaking ? '⏹ Stop' : '🔊 Listen'}
          </button>
        )}
      </div>
    </div>
  )
}

export default ReaderControls
