import { useCallback, useEffect, useRef, useState } from 'react'

// Save-state machine shared by every settings panel: run the panel's async
// save, surface saving/saved/error for the sticky save bar, and auto-clear
// the "Saved ✓" flash. The panel owns its form state + dirty computation;
// this hook only owns the lifecycle around the write.
export function useSettingsSave() {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const timerRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const flashSaved = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaved(true)
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) setSaved(false)
    }, 2500)
  }, [])

  const run = useCallback(async (saveFn) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await saveFn()
      if (!mountedRef.current) return true
      flashSaved()
      return true
    } catch (err) {
      console.error('Settings save failed:', err)
      if (mountedRef.current) {
        setError('Could not save — please check your connection and try again.')
      }
      return false
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }, [flashSaved])

  return { run, saving, saved, error }
}
