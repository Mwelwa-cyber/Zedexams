// Styled native <select> on the shared studio-input recipe. `options` may be
// strings or { value, label } pairs; an optional leading placeholder renders
// as a disabled-free empty choice ('' value) so "not set" stays selectable.
export default function SelectField({ id, value, onChange, options, placeholder, disabled = false }) {
  return (
    <select
      id={id}
      className="studio-input"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((opt) => {
        const v = typeof opt === 'string' ? opt : opt.value
        const label = typeof opt === 'string' ? opt : opt.label
        return (
          <option key={v} value={v}>
            {label}
          </option>
        )
      })}
    </select>
  )
}
