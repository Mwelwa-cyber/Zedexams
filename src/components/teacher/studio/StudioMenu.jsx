import { useEffect, useRef, useState } from 'react'
import useClickAway from '../../../hooks/useClickAway'
import Icon from './studioIcons'

/**
 * The one dropdown behind every grouped control in the Assessment Studio —
 * `Tools ▾` on the builder bar, `✦ AI ▾` on a question block, and the `⋯`
 * overflow that destructive actions live in.
 *
 * It is the studio's own component rather than `components/ui/ActionMenu`
 * because the two speak different token sets: ActionMenu paints from the app's
 * `--zt-*` surfaces, and the studio's chrome is the scoped `--sv-*` palette
 * (with its own Night remapping in assessmentStudio.css). Mounting a `--zt-*`
 * card inside `.studio-v2` is exactly the "white patch in Night mode" the
 * acceptance list rules out. The BEHAVIOUR is deliberately identical: click
 * away closes, Escape closes, opening focuses the first enabled item.
 *
 * Item shape: `{ label, icon, onSelect, danger, disabled, hint, active, key }`.
 * A falsy entry is dropped, so callers can inline `cond && {...}`.
 */
export default function StudioMenu({
  label = null,
  icon = null,
  caret = false,
  items = [],
  align = 'right',
  className = 'sv-chip',
  buttonTitle,
  ariaLabel,
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  useClickAway(rootRef, () => setOpen(false))

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    menuRef.current?.querySelector('button:not(:disabled)')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const usable = items.filter(Boolean)
  if (usable.length === 0) return null

  return (
    <div ref={rootRef} className="sv-menu">
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
        title={buttonTitle}
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
      >
        {icon && <Icon name={icon} size={14} />}
        {label}
        {caret && <span aria-hidden="true" className="sv-menu-caret">▾</span>}
      </button>
      {open && (
        <div ref={menuRef} role="menu" className={`sv-menu-list ${align === 'left' ? 'left' : 'right'}`}>
          {usable.map((item, i) => (
            <button
              key={item.key || (typeof item.label === 'string' ? item.label : i)}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled && item.disabledReason ? item.disabledReason : item.title}
              aria-pressed={item.active != null ? Boolean(item.active) : undefined}
              className={`sv-menu-item${item.danger ? ' danger' : ''}${item.active ? ' active' : ''}`}
              onClick={() => {
                setOpen(false)
                item.onSelect?.()
              }}
            >
              {item.icon && <Icon name={item.icon} size={15} />}
              <span className="sv-menu-item-text">
                {item.label}
                {item.hint && <small>{item.hint}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
