import { useEffect, useRef } from 'react'
import { LogOut } from 'lucide-react'

/**
 * Destructive-action confirmation for Log out. Focus is trapped inside the
 * dialog while open (Tab cycles Cancel ↔ Log out), Escape cancels, and the
 * opener restores focus to the profile trigger when we unmount.
 */
export default function LogoutDialog({ onCancel, onConfirm }) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll('button') || [],
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div
      className="tdv2-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="tdv2-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tdv2-logout-title"
        aria-describedby="tdv2-logout-desc"
        ref={dialogRef}
      >
        <h2 id="tdv2-logout-title">Log out of ZedExams?</h2>
        <p id="tdv2-logout-desc">
          You will need to sign in again to access your dashboard.
        </p>
        <div className="tdv2-dialog-actions">
          <button type="button" className="tdv2-btn-quiet" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="tdv2-btn-danger" onClick={onConfirm}>
            <LogOut size={16} strokeWidth={2} aria-hidden="true" />
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
