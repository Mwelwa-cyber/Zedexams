// Learner Settings — shared presentational primitives.
//
// Every panel composes these so the page reads as one design system. They are
// thin wrappers over the .lset-* classes in learnerSettings.css (theme-aware:
// all colour comes from CSS custom properties, so the components inherit the
// learner's chosen ZedExams theme automatically).

import Icon from '../../../components/ui/Icon'

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
