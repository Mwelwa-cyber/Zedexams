// Learner Settings — shared presentational primitives.
//
// Every panel composes these so the page reads as one design system. They are
// thin wrappers over the .lset-* classes in learnerSettings.css (theme-aware:
// all colour comes from CSS custom properties, so the components inherit the
// learner's chosen ZedExams theme automatically).

import { useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/components/Icon'
import { ChevronRight as ChevronRightIcon } from '../../../shared/components/icons'

/* True when the learner (or their OS) has asked to calm animation. Used to skip
   the count-up animation and land straight on the final value. */
function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  try {
    if (document.body?.getAttribute('data-a11y-motion') === 'reduced') return true
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
  } catch {
    return false
  }
}

/* ── Dashboard: section card shell ────────────────────────────── */
// A titled card used across the overview dashboard. `tone` colours the header
// icon tile via the shared .lset-badge--* palette. `more` renders a bottom
// "Manage all / More" drill-in row.
export function SectionCard({ id, tone = 'slate', icon, title, subtitle, className = '', headerRight, more, onMore, children }) {
  return (
    <section id={id} className={`lset-scard ${className}`.trim()}>
      <header className="lset-scard__head">
        {icon && (
          <span className={`lset-scard__tile lset-badge lset-badge--${tone}`}>
            <Icon as={icon} size="md" strokeWidth={2.1} />
          </span>
        )}
        <div className="lset-scard__titles">
          <h2 className="lset-scard__title">{title}</h2>
          {subtitle && <p className="lset-scard__sub">{subtitle}</p>}
        </div>
        {headerRight}
      </header>
      <div className="lset-scard__body">{children}</div>
      {more && (
        <button type="button" className="lset-scard__more" onClick={onMore}>
          <span>{more}</span>
          <Icon as={ChevronRightIcon} size="sm" strokeWidth={2.4} />
        </button>
      )}
    </section>
  )
}

/* ── Count-up animated number ─────────────────────────────────── */
// Animates from 0 to `value` on mount; honours reduced-motion by snapping.
export function useCountUp(value, { duration = 900 } = {}) {
  const target = Number(value) || 0
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? target : 0))
  const rafRef = useRef(0)
  useEffect(() => {
    if (prefersReducedMotion()) { setDisplay(target); return undefined }
    let start = null
    const from = 0
    const step = (ts) => {
      if (start == null) start = ts
      const t = Math.min(1, (ts - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (target - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else setDisplay(target)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])
  return display
}

// A single dashboard stat tile (icon + animated value + label). `format` turns
// the raw animated number into the shown string (e.g. add a % or thousands sep).
export function StatTile({ icon, emoji, value, label, tone = '#2563eb', animate = true, format }) {
  const animated = useCountUp(animate ? value : 0)
  const shown = animate
    ? (format ? format(animated) : Math.round(animated).toLocaleString())
    : (format ? format(value) : value)
  return (
    <div className="lset-stattile" style={{ '--tile': tone }}>
      <span className="lset-stattile__ic">
        {icon ? <Icon as={icon} size="sm" strokeWidth={2.2} /> : <span aria-hidden="true">{emoji}</span>}
      </span>
      <span className="lset-stattile__val">{shown}</span>
      <span className="lset-stattile__lab">{label}</span>
    </div>
  )
}

/* ── Segmented control (goal / difficulty pickers) ────────────── */
export function Segmented({ label, options, value, onChange }) {
  return (
    <div>
      {label && <span className="lset-fieldlabel">{label}</span>}
      <div className="lset-seg" role="group" aria-label={label}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o
          const l = typeof o === 'object' ? o.label : o
          const on = value === v
          return (
            <button
              key={String(v)}
              type="button"
              className={`lset-seg__btn${on ? ' lset-seg__btn--on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange?.(v)}
            >
              {l}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Link row (Security / Help drill-ins) ─────────────────────── */
export function LinkRow({ icon, title, hint, meta, onClick, href }) {
  const inner = (
    <>
      {icon && <span className="lset-linkrow__ic"><Icon as={icon} size="sm" strokeWidth={2.1} /></span>}
      <span className="lset-linkrow__text">
        <span className="lset-linkrow__title">{title}</span>
        {hint && <span className="lset-linkrow__hint">{hint}</span>}
      </span>
      {meta && <span className="lset-linkrow__meta">{meta}</span>}
      <Icon as={ChevronRightIcon} size="sm" strokeWidth={2.2} className="lset-linkrow__chev" />
    </>
  )
  if (href) {
    return <a className="lset-linkrow" href={href} target={href.startsWith('http') || href.startsWith('mailto:') ? '_blank' : undefined} rel="noreferrer">{inner}</a>
  }
  return <button type="button" className="lset-linkrow" onClick={onClick}>{inner}</button>
}

/* ── Panel scaffold ───────────────────────────────────────────── */

export function Panel({ section, children }) {
  const IconCmp = section?.icon
  return (
    <div className="lset-panel">
      <div className="lset-panel__head">
        {IconCmp && (
          <span className={`lset-badge lset-badge--${section.tone || 'slate'}`}>
            <Icon as={IconCmp} size="md" strokeWidth={2.1} />
          </span>
        )}
        <div>
          <h2 className="lset-panel__title">{section?.label}</h2>
          {section?.desc && <p className="lset-panel__desc">{section.desc}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

export function Section({ title, hint, children }) {
  return (
    <section className="lset-section">
      {title && <h3 className="lset-section__title">{title}</h3>}
      {hint && <p className="lset-section__hint">{hint}</p>}
      <div className="lset-section__body">{children}</div>
    </section>
  )
}

/* ── Fields ───────────────────────────────────────────────────── */

export function Field({ label, hint, error, full, htmlFor, children }) {
  return (
    <div className={`lset-field${full ? ' lset-field--full' : ''}`}>
      {label && <label className="lset-field__label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error && <p className="lset-error">{error}</p>}
      {hint && !error && <p className="lset-field__hint">{hint}</p>}
    </div>
  )
}

export function TextInput({ id, value, onChange, error, type = 'text', ...rest }) {
  return (
    <input
      id={id}
      type={type}
      className={`lset-input${error ? ' lset-input--error' : ''}`}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  )
}

export function Textarea({ id, value, onChange, rows = 4, ...rest }) {
  return (
    <textarea
      id={id}
      className="lset-textarea"
      rows={rows}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  )
}

export function Select({ id, value, onChange, options, ...rest }) {
  return (
    <select
      id={id}
      className="lset-select"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    >
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value
        const l = typeof o === 'string' ? o : o.label
        return <option key={v} value={v}>{l}</option>
      })}
    </select>
  )
}

/* Convenience: labelled select in one call. */
export function SelectField({ label, hint, id, ...rest }) {
  const inputId = id || `lset-${String(label || '').toLowerCase().replace(/\s+/g, '-')}`
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      <Select id={inputId} {...rest} />
    </Field>
  )
}

/* ── Toggle ───────────────────────────────────────────────────── */

export function Toggle({ title, hint, checked, onChange, disabled }) {
  return (
    <div className="lset-toggle">
      <div className="lset-toggle__text">
        <p className="lset-toggle__title">{title}</p>
        {hint && <p className="lset-toggle__hint">{hint}</p>}
      </div>
      <button
        type="button"
        className="lset-switch"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
      />
    </div>
  )
}

/* ── Chips (single or multi select) ───────────────────────────── */

export function Chips({ options, value, onChange, multi = false }) {
  const selected = multi ? (Array.isArray(value) ? value : []) : value
  const isOn = (v) => (multi ? selected.includes(v) : selected === v)
  const toggle = (v) => {
    if (multi) {
      onChange?.(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
    } else {
      onChange?.(v)
    }
  }
  return (
    <div className="lset-chips">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value
        const l = typeof o === 'string' ? o : o.label
        const emoji = typeof o === 'object' ? o.emoji : null
        return (
          <button
            key={v}
            type="button"
            className={`lset-chip${isOn(v) ? ' lset-chip--on' : ''}`}
            aria-pressed={isOn(v)}
            onClick={() => toggle(v)}
          >
            {emoji && <span aria-hidden="true">{emoji}</span>}
            {l}
          </button>
        )
      })}
    </div>
  )
}

/* ── Option cards (segmented, richer than chips) ──────────────── */

export function OptionCards({ options, value, onChange }) {
  return (
    <div className="lset-options">
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            className={`lset-option${on ? ' lset-option--on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange?.(o.value)}
          >
            <p className="lset-option__title">
              {o.swatch && (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                    background: o.swatch, marginRight: 7, verticalAlign: 'middle',
                    border: '1px solid rgba(0,0,0,.15)',
                  }}
                />
              )}
              {o.label}
            </p>
            {o.hint && <p className="lset-option__hint">{o.hint}</p>}
          </button>
        )
      })}
    </div>
  )
}

/* ── Buttons ──────────────────────────────────────────────────── */

export function Btn({ variant = 'primary', size, full, loading, children, ...rest }) {
  const cls = [
    'lset-btn',
    variant === 'ghost' && 'lset-btn--ghost',
    variant === 'danger' && 'lset-btn--danger',
    size === 'sm' && 'lset-btn--sm',
    full && 'lset-btn--full',
  ].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading && <span className="lset-savedot lset-savedot--spin" style={{ color: 'currentColor' }} />}
      {children}
    </button>
  )
}

export function Note({ tone, children }) {
  const cls = tone === 'danger' ? 'lset-note lset-note--danger'
    : tone === 'accent' ? 'lset-note lset-note--accent'
      : 'lset-note'
  return <div className={cls}>{children}</div>
}

/* ── Progress ring (SVG, theme-aware) ─────────────────────────── */

export function ProgressRing({ value = 0, size = 96, stroke = 9, label, sublabel }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  const offset = c - (pct / 100) * c
  return (
    <div className="lset-pring">
      <div className="lset-pring__center" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle className="lset-pring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
          <circle
            className="lset-pring__fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="lset-pring__num">{label ?? `${pct}%`}</span>
      </div>
      {sublabel && <span className="lset-pring__label">{sublabel}</span>}
    </div>
  )
}

export function Stat({ value, label, accent }) {
  return (
    <div className="lset-stat">
      <div className="lset-stat__value" style={accent ? { color: 'var(--lset-accent)' } : undefined}>{value}</div>
      <div className="lset-stat__label">{label}</div>
    </div>
  )
}
