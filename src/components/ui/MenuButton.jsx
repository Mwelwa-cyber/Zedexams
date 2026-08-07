// A trigger button with a dropdown menu — the primitive behind "Download ▾",
// "Tools ▾", the per-card "⋯" and the question block's "✦ AI ▾".
//
// It exists because the Assessment Studio polish replaced several rows of
// always-visible buttons with menus, and a menu that traps focus, ignores
// Escape, or stays open after an outside click is worse than the row it
// replaced. All four call sites get one implementation of that behaviour.
//
// Deliberately unstyled beyond layout: the caller passes the classes for its
// own surface (`.zt-lib` on the library, `.studio-v2` inside the studio), so
// this never carries a colour of its own.

import { useCallback, useEffect, useId, useRef, useState } from 'react'

/**
 * @param {ReactNode} label            trigger content
 * @param {string}    ariaLabel        accessible name when the label is an icon
 * @param {string}    triggerClassName classes for the trigger button
 * @param {string}    menuClassName    classes for the popover
 * @param {string}    align            'end' (default) | 'start'
 * @param {function}  children         ({ close }) => menu items
 */
export default function MenuButton({
  label,
  ariaLabel,
  title,
  disabled = false,
  triggerClassName = '',
  menuClassName = 'zt-menu',
  wrapClassName = 'zt-menu-wrap',
  align = 'end',
  children,
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const menuId = useId()

  const close = useCallback(({ restoreFocus = false } = {}) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    // Pointerdown, not click: a click handler fires after the target's own
    // click, so a button behind the menu would act AND leave the menu open.
    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close({ restoreFocus: true })
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return (
    <span className={wrapClassName} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={menuClassName}
          style={align === 'start' ? { left: 0, right: 'auto' } : undefined}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      )}
    </span>
  )
}

/**
 * A destructive row that asks before it acts, without leaving the menu.
 *
 * The two steps are the point: "Delete" used to be a one-click red button
 * sitting in a row of eight, so the difference between deleting a question and
 * duplicating it was four pixels of travel.
 */
export function ConfirmMenuItem({
  icon, children, confirmLabel = 'Delete', question = 'Delete this?',
  onConfirm, className = 'zt-menu-item', confirmClassName = 'zt-menu-confirm',
}) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <MenuItem danger icon={icon} className={className} onClick={() => setArmed(true)}>
        {children}
      </MenuItem>
    )
  }
  return (
    <div className={confirmClassName} role="group" aria-label={question}>
      <span>{question}</span>
      <button type="button" className="confirm" onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" className="cancel" onClick={() => setArmed(false)}>Cancel</button>
    </div>
  )
}

/** One row inside a MenuButton. `danger` is styling only — confirm separately. */
export function MenuItem({ icon, children, onClick, disabled = false, danger = false, className = 'zt-menu-item' }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${className}${danger ? ' danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}
