import { useEffect } from 'react'

/**
 * Close-on-outside-tap for dropdowns/popovers. Fires `onAway` when a
 * mousedown/touchstart lands outside `ref`'s subtree. Was copy-pasted into
 * TeacherTopBar and TeacherGlassHeader; lives here once now.
 */
export default function useClickAway(ref, onAway) {
  useEffect(() => {
    function handler(e) {
      if (!ref.current) return
      if (!ref.current.contains(e.target)) onAway()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [ref, onAway])
}
