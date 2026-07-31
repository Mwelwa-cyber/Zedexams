/**
 * DurationSelect — a reusable duration dropdown for timetable blocks.
 *
 * Replaces the old "number box + separate min label" with one clear dropdown of
 * preset durations (5–60 min) plus a "Custom duration" option that reveals a
 * numeric input for any whole value in [min, max]. Used by every non-lesson
 * timetable block that carries a duration in minutes — assembly, break, lunch,
 * closing, and any future block.
 *
 * The value is ALWAYS an integer number of minutes (never a formatted string).
 * `onChange` only ever fires with a clean, in-range whole number.
 *
 *   <DurationSelect
 *     value={durationMinutes}
 *     onChange={handleDurationChange}
 *     label="Assembly duration"
 *     min={5}
 *     max={180}
 *   />
 *
 * Accessibility: the label is connected to the <select>, the custom input
 * carries its own aria-label, validation errors are announced via role="alert"
 * (and shown with a ⚠ glyph, never colour alone), and both controls keep a
 * ≥44px touch target. A native <select> is used deliberately so its menu is
 * rendered by the OS and can never be clipped behind a day card or container.
 */

import { useEffect, useId, useRef, useState } from 'react'
import {
  DURATION_PRESETS,
  CUSTOM_DURATION,
  CUSTOM_DURATION_MIN,
  CUSTOM_DURATION_MAX,
  isPresetDuration,
  validateDurationInput,
  formatDuration,
} from '../../utils/durationOptions'

export default function DurationSelect({
  value,
  onChange,
  label,
  id,
  ariaLabel,
  min = CUSTOM_DURATION_MIN,
  max = CUSTOM_DURATION_MAX,
  disabled = false,
  className = '',
}) {
  const reactId = useId()
  const selectId = id || `duration-${reactId}`
  const customInputId = `${selectId}-custom`
  const errorId = `${selectId}-error`

  const valueIsPreset = isPresetDuration(value)
  // Custom mode is on when the current value isn't a preset, OR the teacher
  // explicitly picked "Custom duration" (even while the value is still a
  // preset, e.g. they open custom before typing).
  const [customMode, setCustomMode] = useState(!valueIsPreset)
  const [customText, setCustomText] = useState(value == null ? '' : String(value))
  const [error, setError] = useState(null)
  const focusedRef = useRef(false)

  // A non-preset value arriving from outside (restored draft, template with an
  // odd duration, an external reset) forces custom mode so it stays visible and
  // editable. A preset value never collapses a custom mode the teacher opened,
  // so temporarily changing another timetable setting preserves a custom value.
  useEffect(() => {
    if (!isPresetDuration(value)) setCustomMode(true)
  }, [value])

  // Mirror an external value into the custom field while it is unfocused (so a
  // reset/template change shows through) — never while the teacher is typing.
  useEffect(() => {
    if (focusedRef.current) return
    setCustomText(value == null ? '' : String(value))
    if (value != null && Number.isFinite(Number(value))) setError(null)
  }, [value])

  const showCustom = customMode || !valueIsPreset
  const selectValue = showCustom ? CUSTOM_DURATION : String(value)

  function handleSelect(e) {
    const v = e.target.value
    if (v === CUSTOM_DURATION) {
      setCustomMode(true)
      setCustomText(value == null ? '' : String(value))
      return
    }
    setCustomMode(false)
    setError(null)
    onChange?.(Number(v))
  }

  function handleCustomChange(e) {
    const raw = e.target.value
    setCustomText(raw)
    const { value: parsed, error: err } = validateDurationInput(raw, { min, max })
    setError(err)
    if (parsed != null) onChange?.(parsed)
  }

  function handleCustomBlur() {
    focusedRef.current = false
    const { value: parsed, error: err } = validateDurationInput(customText, { min, max })
    if (parsed != null) {
      setCustomText(String(parsed))
      setError(null)
      onChange?.(parsed)
    } else {
      setError(err)
    }
  }

  const summary = !error && value != null && Number.isFinite(Number(value))
    ? formatDuration(value)
    : ''

  return (
    <div className={`duration-select ${className}`}>
      <label htmlFor={selectId} className="studio-label">{label}</label>
      <select
        id={selectId}
        value={selectValue}
        disabled={disabled}
        aria-label={ariaLabel || label}
        onChange={handleSelect}
        className="studio-input w-full"
        style={{ minHeight: 44 }}
      >
        {DURATION_PRESETS.map((m) => (
          <option key={m} value={String(m)}>{formatDuration(m)}</option>
        ))}
        <option value={CUSTOM_DURATION}>Custom duration</option>
      </select>

      {showCustom && (
        <input
          id={customInputId}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          value={customText}
          disabled={disabled}
          aria-label={`${label} — custom minutes`}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={`${min}–${max} minutes`}
          onFocus={() => { focusedRef.current = true }}
          onChange={handleCustomChange}
          onBlur={handleCustomBlur}
          className="studio-input w-full mt-1.5"
          style={{ minHeight: 44 }}
        />
      )}

      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs font-bold" style={{ color: 'var(--danger-fg)' }}>
          <span aria-hidden="true">⚠ </span>{error}
        </p>
      ) : summary ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--zt-text-muted)' }}>{summary}</p>
      ) : null}
    </div>
  )
}
