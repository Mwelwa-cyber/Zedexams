/**
 * Shared form primitives for the teacher generation studios.
 *
 * These (FieldLabel / FieldText / FieldTextarea / FieldSelect) were copy-pasted
 * — character-for-character — into every studio (Assessment, Flashcard, Rubric,
 * Notes, Homework, Worksheet, …). The duplication let the copies drift over
 * time, so they now live here once. They lean on the global `studio-*` classes
 * from `src/index.css`, so they look identical wherever they're used.
 */

import { useEffect, useId, useState } from 'react'
import Icon from '../../components/ui/Icon'
import { ChevronDown, SlidersHorizontal, Sparkles } from '../../components/ui/icons'

export function FieldLabel({ children }) {
  return <label className="studio-label">{children}</label>
}

export function FieldWrapper({ label, children }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  )
}

export function FieldText({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="studio-input"
      />
    </div>
  )
}

export function FieldDate({ label, value, onChange }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="studio-input"
      />
    </div>
  )
}

export function FieldTextarea({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        className="studio-input resize-none"
      />
    </div>
  )
}

// A numeric combobox: a number input wired to a <datalist> of presets, so a
// teacher can PICK a common value from the dropdown or TYPE their own. Unlike
// FieldSelect (which locks the value to its options), this stays free-text
// within [min, max]. `onChange` always receives a clamped number.
//
// The input keeps its own text state so a partial entry (e.g. "1" on the way to
// "100") isn't clobbered or prematurely clamped while typing — the value is
// normalised to [min, max] on blur, and the parent value is mirrored back in
// only while the field is unfocused (so an external reset/clear still shows).
export function FieldNumberCombo({ label, value, options, onChange, min = 1, max = 999 }) {
  const listId = useId()
  const [text, setText] = useState(value == null ? '' : String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused) return
    setText(value == null ? '' : String(value))
  }, [value, focused])

  const handleChange = (raw) => {
    const digits = raw.replace(/[^\d]/g, '')
    setText(digits)
    if (digits === '') return
    onChange(Math.min(max, Math.max(min, Number(digits))))
  }
  const handleBlur = () => {
    setFocused(false)
    const n = text === '' ? min : Math.min(max, Math.max(min, Number(text)))
    setText(String(n))
    onChange(n)
  }

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        inputMode="numeric"
        list={listId}
        min={min}
        max={max}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        className="studio-input"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </datalist>
    </div>
  )
}

// Two fields side by side on anything wider than a phone, stacked below.
// Pass any Field* children; each keeps its own label.
export function FieldGrid({ children }) {
  return <div className="studio-field-grid">{children}</div>
}

// Collapsible "Advanced options" disclosure. The essential fields stay in
// view; the rarely-changed ones (term, lesson numbering, language, timing…)
// live in here so a studio form reads as 4–5 decisions, not 12. Field values
// live in the parent form state, so collapsing never loses anything.
export function AdvancedOptions({ label = 'Advanced options', hint, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <div className={`studio-advanced${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="studio-advanced__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon as={SlidersHorizontal} size="xs" />
        <span className="studio-advanced__label">{label}</span>
        {hint && <span className="studio-advanced__hint">{hint}</span>}
        <Icon as={ChevronDown} size="xs" className="studio-advanced__chevron" />
      </button>
      {open && (
        <div id={panelId} className="studio-advanced__panel">
          {children}
        </div>
      )}
    </div>
  )
}

// The one submit button every generator shares: spinner while generating,
// sparkles otherwise. Keeps the disabled/label wiring in one place. `disabled`
// lets a studio add its own readiness condition on top of `generating`.
export function GenerateButton({ generating, disabled = false, generatingLabel = 'Generating…', children }) {
  return (
    <button type="submit" disabled={generating || disabled} className="studio-btn-primary w-full py-3">
      {generating ? (
        <>
          <span className="studio-btn-spinner" aria-hidden="true" />
          {generatingLabel}
        </>
      ) : (
        <>
          <Icon as={Sparkles} size="sm" />
          {children}
        </>
      )}
    </button>
  )
}

// Shared output-panel empty state — replaces the near-identical local
// EmptyState() functions that were copy-pasted into every studio. `tone` is
// the pastel disc colour behind the emoji (each studio keeps its own).
/**
 * `icon` (a component) is the converted form; `emoji` remains for the studios
 * that have not moved yet. Same migration StudioPageHeader made and for the
 * same reason — mascots and emoji are learner-side, and a teacher's studio is
 * a place of work.
 */
export function StudioEmptyState({ emoji, icon: EmptyIcon = null, tone = '#f0eee8', title, children, action }) {
  return (
    <div className="studio-empty">
      <div className="studio-empty__badge" style={{ background: tone }} aria-hidden="true">
        {EmptyIcon ? <EmptyIcon size={30} strokeWidth={1.6} /> : emoji}
      </div>
      <h3 className="studio-display studio-empty__title">{title}</h3>
      <p className="studio-empty__text">{children}</p>
      {action && <div className="studio-empty__action">{action}</div>}
    </div>
  )
}

// Options may be a flat list of { value, label } or carry { group } markers to
// split into <optgroup>s — an option object with a `group` key starts a new
// labelled group; subsequent plain options belong to it.
/**
 * `aria-label` rather than a `for`/`id` pair, deliberately.
 *
 * `FieldLabel` is used both as a real form label and as a heading over a group
 * of controls (the segmented ones), so giving it an `htmlFor` would attach some
 * of them to whatever happened to follow. Naming the select directly is
 * unambiguous, gives a screen reader the same name a sighted teacher reads, and
 * lets a test find the control by the label the teacher sees.
 */
export function FieldSelect({ label, value, options, onChange }) {
  const groups = []
  let cur = null
  for (const o of options) {
    if (o.group !== undefined) {
      if (cur) groups.push(cur)
      cur = { label: o.group, items: [] }
    } else {
      if (!cur) cur = { label: null, items: [] }
      cur.items.push(o)
    }
  }
  if (cur) groups.push(cur)
  const flat = groups.length === 1 && !groups[0].label
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="studio-input"
      >
        {flat
          ? groups[0].items.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))
          : groups.map((g, i) => (g.label
            ? <optgroup key={i} label={g.label}>
              {g.items.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
            : g.items.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))
          ))}
      </select>
    </div>
  )
}
