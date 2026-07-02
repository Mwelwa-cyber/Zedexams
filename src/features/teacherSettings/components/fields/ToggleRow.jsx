// iOS-style switch row: title + hint on the left, switch pinned right.
// Uses role="switch" + aria-checked so the CSS drives the knob position and
// screen readers announce the state correctly.
export default function ToggleRow({ title, hint, checked, onChange, disabled = false }) {
  return (
    <div className="tset-toggle-row">
      <div className="tset-toggle-row__text">
        <p className="tset-toggle-row__title">{title}</p>
        {hint && <p className="tset-toggle-row__hint">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className="tset-switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}
