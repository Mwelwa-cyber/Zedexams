// useQuizReadAloud — read-aloud (text-to-speech) for the learner quiz.
//
// Thin wrapper over the shared useSpeech hook (cloud Google TTS with a browser
// speechSynthesis fallback) that:
//   • is gated by the learner's `readAloud` reading preference — when off, the
//     feature is fully disabled and no speaker buttons are shown, so audio
//     never plays without the learner opting in;
//   • tracks the currently-playing item by a stable `id` so a speaker button
//     knows whether IT is the one playing / paused;
//   • exposes toggle(id, getText) so tapping the same item's button stops it,
//     and a fresh item stops the previous one first.
//
// Privacy: the only text sent to /api/tts is the question / passage / option
// the learner explicitly asked to hear. Nothing plays automatically.

import { useCallback, useEffect } from 'react'
import { useSpeech } from './useSpeech'

export function useQuizReadAloud(enabled) {
  const { supported, speaking, paused, activeId, speak, stop, pause, resume } = useSpeech()

  const active = Boolean(enabled) && supported

  // Play (or restart) the given item. `getText` may be a string or a function
  // returning one, so callers can defer the (cheap) plain-text extraction.
  const play = useCallback(
    (id, getText) => {
      if (!active) return
      const text = typeof getText === 'function' ? getText() : getText
      if (!text || !String(text).trim()) return
      speak(String(text), id)
    },
    [active, speak]
  )

  // Tapping a speaker: start it, or stop it if it's already the active one.
  const toggle = useCallback(
    (id, getText) => {
      if (!active) return
      if (activeId === id && (speaking || paused)) {
        stop()
        return
      }
      play(id, getText)
    },
    [active, activeId, speaking, paused, stop, play]
  )

  const isActive = useCallback((id) => active && activeId === id && (speaking || paused), [active, activeId, speaking, paused])

  // Stop any audio when the feature is turned off mid-quiz.
  useEffect(() => {
    if (!active) stop()
  }, [active, stop])

  return {
    /** Whether read-aloud is available + enabled (controls whether buttons render). */
    enabled: active,
    supported,
    activeId,
    speaking,
    paused,
    play,
    toggle,
    pause,
    resume,
    stop,
    isActive,
  }
}

export default useQuizReadAloud
