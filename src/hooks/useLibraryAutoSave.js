import { useEffect, useRef } from 'react'

/**
 * Debounced auto-save to the teacher library for the hand-built studios
 * (class timetable, mark schedule, weekly forecast, record of work, SBA
 * mark sheet, SBA plan).
 *
 * The AI generators (lesson plan, worksheet, flashcards, …) already persist
 * their output to the `aiGenerations` collection the moment Claude returns,
 * so a generated artefact is in the library immediately. The interactive
 * studios, by contrast, used to require the teacher to click "Save to
 * library". This hook closes that gap so that "anything created is
 * automatically saved": whenever there's saveable content and an unsaved
 * change, it fires the studio's own (idempotent) save a short while after
 * the last edit.
 *
 * The studio's save function is reused unchanged except for a `silent`
 * option so the auto-save doesn't raise a success toast on every keystroke
 * pause — the existing "✓ Saved" button state is the feedback instead.
 *
 * Re-fire safety: success flips `dirty` to false, so the next save only
 * happens after a fresh user edit. A save in flight (`saving`) suppresses
 * scheduling. Because Firestore writes queue locally (offline persistence),
 * a transient failure simply replays on reconnect rather than looping hot.
 *
 * @param {object} opts
 *   enabled  there is meaningful content worth saving (e.g. artifact != null)
 *   dirty    there are unsaved changes since the last successful save
 *   saving   a save is already in flight
 *   onSave   the studio's save fn; invoked with no args, should save silently
 *   delay    debounce window in ms (default 2500)
 */
export function useLibraryAutoSave({ enabled, dirty, saving, onSave, delay = 2500 }) {
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  useEffect(() => {
    if (!enabled || !dirty || saving) return undefined
    const timer = setTimeout(() => { onSaveRef.current?.() }, delay)
    return () => clearTimeout(timer)
  }, [enabled, dirty, saving, delay])
}
