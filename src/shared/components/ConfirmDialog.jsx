import { useRef } from 'react'
import { AlertTriangle } from './icons'
import Button from './Button'
import Icon from './Icon'
import useFocusTrap from '../../hooks/useFocusTrap'

/**
 * ConfirmDialog — modal used in place of window.confirm() for destructive
 * or high-stakes actions.
 *
 * Controlled component. Parent owns open/close state.
 *
 * Props
 *   open         — whether the dialog is rendered
 *   title        — short headline (e.g., "Delete quiz?")
 *   message      — longer explanation (string or node)
 *   confirmLabel — text for the confirm button (default "Confirm")
 *   cancelLabel  — text for the cancel button (default "Cancel")
 *   variant      — "primary" | "danger" (default). Controls the confirm button.
 *   icon         — optional Heroicons component (default AlertTriangle for danger)
 *   loading      — renders the confirm button in loading state
 *   confirmDisabled — blocks the confirm button while some extra condition
 *                  the caller owns is unmet (e.g. a "type DELETE to
 *                  confirm" box on a large destructive batch). Distinct
 *                  from `loading`, which means a request is in flight.
 *   onConfirm    — async or sync handler; parent closes the dialog on success
 *   onCancel     — handler for cancel/backdrop/Escape
 *
 * Behaviour
 *   • Escape cancels.
 *   • Clicking the backdrop cancels.
 *   • Focus is moved into the dialog on open, returned on close.
 *   • Focus is trapped within the dialog while it's open.
 *   • role="alertdialog" with aria-labelledby / aria-describedby wired up.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  icon,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) {
  const panelRef = useRef(null)
  const cancelRef = useRef(null)

  // Focus management (move-in / trap / restore) + Escape now live in the
  // shared useFocusTrap hook. The Cancel button is the safer default focus
  // target for a destructive dialog, and Escape is held while `loading`.
  useFocusTrap(panelRef, {
    active: open,
    initialFocusRef: cancelRef,
    onEscape: () => { if (!loading) onCancel?.() },
  })

  if (!open) return null

  const ConfirmIcon = icon ?? (variant === 'danger' ? AlertTriangle : null)
  const iconBg = variant === 'danger' ? 'bg-danger-subtle text-danger' : 'theme-accent-bg theme-accent-text'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        // Only cancel on clicks that started on the backdrop, not on the panel.
        if (e.target === e.currentTarget && !loading) onCancel?.()
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative w-full max-w-md theme-card theme-border rounded-3xl border shadow-elev-xl p-6 animate-scale-in"
      >
        <div className="flex items-start gap-4">
          {ConfirmIcon && (
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
              <Icon as={ConfirmIcon} size="md" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 id="confirm-dialog-title" className="text-display-md theme-text">
              {title}
            </h2>
            {message && (
              <div id="confirm-dialog-message" className="theme-text-muted text-body-sm mt-2">
                {message}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="md"
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
