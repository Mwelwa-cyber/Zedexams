/**
 * React hook around src/utils/soundEffects.js.
 *
 * Exposes:
 *   - isMuted (reactive, stays in sync across components)
 *   - toggleMute()
 *   - playSuccess(), playClick(), playWarning()
 *   - primeSounds()  (call inside a click handler to satisfy iOS autoplay)
 *
 * Safe-by-design: every play call is wrapped in try/catch upstream and
 * fails silently if audio is unavailable.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  isMuted as readMuted,
  toggleMute as toggleMutedRaw,
  setMuted as setMutedRaw,
  subscribeMute,
  playSuccess as playSuccessRaw,
  playClick as playClickRaw,
  playWarning as playWarningRaw,
  primeSounds as primeSoundsRaw,
} from '../utils/soundEffects'

export default function useSoundEffects() {
  const [muted, setMutedState] = useState(() => {
    try { return readMuted() } catch { return false }
  })

  useEffect(() => {
    const unsub = subscribeMute(value => setMutedState(Boolean(value)))
    return () => { try { unsub() } catch {} }
  }, [])

  const toggleMute = useCallback(() => {
    try { return toggleMutedRaw() } catch { return muted }
  }, [muted])

  const setMuted = useCallback(value => {
    try { return setMutedRaw(value) } catch { return muted }
  }, [muted])

  const playSuccess = useCallback(() => { try { playSuccessRaw() } catch {} }, [])
  const playClick   = useCallback(() => { try { playClickRaw() }   catch {} }, [])
  const playWarning = useCallback(() => { try { playWarningRaw() } catch {} }, [])
  const primeSounds = useCallback(() => { try { primeSoundsRaw() } catch {} }, [])

  return {
    isMuted: muted,
    toggleMute,
    setMuted,
    playSuccess,
    playClick,
    playWarning,
    primeSounds,
  }
}
