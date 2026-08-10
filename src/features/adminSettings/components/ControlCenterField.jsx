/**
 * ControlCenterField — renders one registry field (settingsRegistry.js)
 * inside the Platform Control Center. Modern switch/segmented controls;
 * everything else uses the shared theme-input styling.
 */

export function ToggleSwitch({ id, checked, onChange, danger = false, label }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-fast focus-visible:outline-none"
      style={{
        background: checked ? (danger ? 'var(--danger, #dc2626)' : 'var(--accent, #2563eb)') : 'rgba(15,27,45,0.18)',
        border: '2px solid rgba(15,27,45,0.35)',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-fast"
        style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

function Segmented({ id, field, value, onChange }) {
  const toneStyle = (opt, active) => {
    if (!active) return {}
    const tones = {
      good: { background: '#dcfce7', color: '#166534', borderColor: '#16a34a' },
      warn: { background: '#fef3c7', color: '#92400e', borderColor: '#d97706' },
      danger: { background: '#fee2e2', color: '#991b1b', borderColor: '#dc2626' },
    }
    return tones[opt.tone] || { background: 'var(--accent, #2563eb)', color: '#fff', borderColor: 'transparent' }
  }
  return (
    <div id={id} role="radiogroup" aria-label={field.label} className="inline-flex flex-wrap gap-1 rounded-xl border theme-border p-1 theme-bg-subtle">
      {(field.options || []).map((raw) => {
        const opt = typeof raw === 'string' ? { value: raw, label: raw } : raw
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-black transition-all duration-fast ${active ? '' : 'border-transparent theme-text-muted hover:theme-text'}`}
            style={toneStyle(opt, active)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default function ControlCenterField({ field, value, onChange, changed = false }) {
  const id = `cc-${field.key.replace(/\./g, '-')}`

  if (field.type === 'toggle') {
    return (
      <div
        className={`flex items-start justify-between gap-4 rounded-2xl border p-4 transition-colors ${field.danger && value ? 'border-red-300 bg-red-50/60' : 'theme-border'} ${changed ? 'ring-2 ring-[color:var(--accent,#2563eb)]/30' : ''}`}
      >
        <div className="min-w-0">
          <label htmlFor={id} className="block cursor-pointer text-sm font-black theme-text">
            {field.label}
            {changed && <ChangedDot />}
          </label>
          {field.help && <p className="mt-0.5 text-xs theme-text-muted">{field.help}</p>}
        </div>
        <ToggleSwitch id={id} checked={!!value} onChange={onChange} danger={field.danger} label={field.label} />
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border p-4 ${field.danger ? 'border-amber-200' : 'theme-border'} ${changed ? 'ring-2 ring-[color:var(--accent,#2563eb)]/30' : ''}`}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-black uppercase tracking-wider theme-text-muted">
        {field.label}
        {changed && <ChangedDot />}
      </label>
      {field.type === 'segmented' ? (
        <Segmented id={id} field={field} value={value} onChange={onChange} />
      ) : field.type === 'select' ? (
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm font-bold"
        >
          {(field.options || []).map((raw) => {
            const opt = typeof raw === 'string' ? { value: raw, label: raw } : raw
            return <option key={opt.value} value={opt.value}>{opt.label}</option>
          })}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          id={id}
          value={value ?? ''}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm"
        />
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
          inputMode={field.type === 'number' ? 'numeric' : undefined}
          value={value ?? ''}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
          className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm"
        />
      )}
      {field.help && <p className="mt-1.5 text-xs theme-text-muted">{field.help}</p>}
    </div>
  )
}

function ChangedDot() {
  return (
    <span
      className="ml-2 inline-block h-2 w-2 rounded-full align-middle"
      style={{ background: 'var(--accent, #2563eb)' }}
      title="Unsaved change"
    />
  )
}
