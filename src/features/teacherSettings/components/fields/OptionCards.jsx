// Segmented option cards (e.g. lesson-plan style Simple / Standard /
// Detailed). Radio semantics; each option is { value, title, hint }.
export default function OptionCards({ value, onChange, options, columns = 3, label }) {
  return (
    <div
      className={`tset-options${columns === 2 ? ' tset-options--two' : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((opt) => {
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`tset-option${on ? ' tset-option--on' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            <p className="tset-option__title">{opt.title}</p>
            {opt.hint && <p className="tset-option__hint">{opt.hint}</p>}
          </button>
        )
      })}
    </div>
  )
}
