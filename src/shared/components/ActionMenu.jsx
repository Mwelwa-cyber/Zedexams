/**
 * ActionMenu — the shared dropdown behind every "Download ▾" and "⋯" button
 * on teacher studio surfaces.
 *
 * The A4 button rule: a list card shows at most three visible actions, and
 * destructive actions NEVER sit on the card surface — they live in here,
 * behind a confirm dialog owned by the caller.
 *
 *   <ActionMenu
 *     label="Download"          // or label={null} + icon for a pure kebab
 *     icon={Download}           // lucide component, optional
 *     caret                     // show the ▾ affordance after the label
 *     buttonClassName="studio-btn-ghost"
 *     ariaLabel="More actions"  // required when label is empty
 *     items={[
 *       { label: 'Paper (Word)', onSelect: fn, icon: FileText },
 *       { label: 'Delete', onSelect: fn, danger: true },
 *     ]}
 *   />
 *
 * Menu items with `danger: true` render in the danger colour. `disabled`
 * items render but do nothing. A `hint` renders as small muted text under
 * the item label.
 */

import { useEffect, useRef, useState } from 'react'
import useClickAway from '../../hooks/useClickAway'

export default function ActionMenu({
  label = null,
  icon: IconComp = null,
  caret = false,
  items = [],
  align = 'right',
  buttonClassName = '',
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
    // Focus the first enabled item so keyboard users land inside the menu.
    const first = menuRef.current?.querySelector('button:not(:disabled)')
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const usable = items.filter(Boolean)
  if (usable.length === 0) return null

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {IconComp && <IconComp size={15} aria-hidden="true" />}
        {label}
        {caret && <span aria-hidden="true" className="text-[10px] leading-none">▾</span>}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={`absolute top-full z-50 mt-1.5 min-w-[200px] overflow-hidden rounded-xl border-2 py-1 shadow-elev-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)' }}
        >
          {usable.map((item, i) => (
            <button
              key={item.key || item.label || i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled && item.disabledReason ? item.disabledReason : undefined}
              className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-bold transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-white/10"
              style={{ color: item.danger ? 'var(--danger-fg, #b3402e)' : 'var(--zt-text)' }}
              onClick={() => {
                setOpen(false)
                item.onSelect?.()
              }}
            >
              {item.icon && <item.icon size={15} aria-hidden="true" className="mt-0.5 shrink-0" />}
              <span className="min-w-0">
                {item.label}
                {item.hint && (
                  <span className="block text-[11px] font-semibold" style={{ color: 'var(--zt-text-muted)' }}>
                    {item.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
