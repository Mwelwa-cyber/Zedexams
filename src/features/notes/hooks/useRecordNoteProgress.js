// src/features/notes/hooks/useRecordNoteProgress.js
//
// Records the learner's reading progress while a note is open. Works for every
// note format (it tracks page scroll, not the study-note block model):
//
//   • on open      → status 'in-progress' + lastOpenedAt (never downgrades a
//                    note that's already 'completed')
//   • while reading→ stores the furthest scroll % (throttled writes)
//   • at the bottom→ status 'completed' (≥95% scrolled, or, for notes that fit
//                    on one screen, after a short dwell)
//
// Safe to call before the note has loaded — it no-ops until `note?.id` exists.

import { useEffect, useRef } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getNoteProgress, recordNoteOpened, recordNotePercent, recordNoteCompleted,
  NOTE_PROGRESS_STATUS,
} from '../lib/progress'

const COMPLETE_AT = 95   // % scrolled that counts as "read to the end"
const WRITE_STEP = 15    // only persist intermediate progress every +15%
const FIT_DWELL_MS = 6000 // notes that fit on one screen complete after this

// Current scroll position as a 0–100 %. Returns 100 when the page isn't
// scrollable (the whole note already fits on screen).
function scrollPercent() {
  const el = document.documentElement
  const max = el.scrollHeight - el.clientHeight
  if (max <= 4) return 100
  const y = window.scrollY || el.scrollTop || 0
  return Math.round(Math.min(1, y / max) * 100)
}

export function useRecordNoteProgress(note) {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const noteId = note?.id
  const ref = useRef({ completed: false, maxPercent: 0, lastWritten: 0 })

  // Record the open once we know the existing state (so we never downgrade a
  // completed note back to in-progress).
  useEffect(() => {
    if (!uid || !noteId) return
    let cancelled = false
    ;(async () => {
      const existing = await getNoteProgress(uid, noteId)
      if (cancelled) return
      const st = ref.current
      if (existing?.status === NOTE_PROGRESS_STATUS.COMPLETED) {
        st.completed = true
        st.maxPercent = 100
      } else {
        st.maxPercent = Math.max(st.maxPercent, Math.round(existing?.percent || 0))
        st.lastWritten = st.maxPercent
      }
      recordNoteOpened(uid, note, { alreadyCompleted: st.completed, isNew: !existing })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, noteId])

  // Track scroll → percent + completion.
  useEffect(() => {
    if (!uid || !noteId) return
    const st = ref.current
    let dwellTimer = null

    const complete = () => {
      if (st.completed) return
      st.completed = true
      st.maxPercent = 100
      recordNoteCompleted(uid, note)
    }

    const onScroll = () => {
      if (st.completed) return
      const p = scrollPercent()
      if (p >= COMPLETE_AT) { complete(); return }
      if (p > st.maxPercent) {
        st.maxPercent = p
        if (p - st.lastWritten >= WRITE_STEP) {
          st.lastWritten = p
          recordNotePercent(uid, note, p)
        }
      }
    }

    // A note that already fits on one screen has nothing to scroll — count it
    // as read after a short dwell so it doesn't complete the instant it opens.
    if (scrollPercent() >= COMPLETE_AT) {
      dwellTimer = setTimeout(complete, FIT_DWELL_MS)
    }

    const flush = () => {
      if (st.completed) return
      if (st.maxPercent > st.lastWritten && st.maxPercent > 0) {
        st.lastWritten = st.maxPercent
        recordNotePercent(uid, note, st.maxPercent)
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
      if (dwellTimer) clearTimeout(dwellTimer)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, noteId])
}
