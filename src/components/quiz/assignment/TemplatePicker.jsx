/**
 * Quick-pick chips for canned assignment templates (Homework, Topic
 * Test, Monthly Test, Mock Exam). Selecting a template surfaces a
 * "Custom" deselect chip so the teacher can reset back to manual
 * configuration.
 *
 * The wizard owns the active template id and applies the template's
 * defaults to its own form state when a chip is tapped.
 */

import { ASSIGNMENT_TEMPLATES } from '../../../utils/assignmentTemplates'

export default function TemplatePicker({ value, onChange, className = '' }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <Chip
        active={!value}
        label="Custom"
        icon="✏️"
        description="Configure everything by hand."
        onClick={() => onChange?.(null)}
      />
      {ASSIGNMENT_TEMPLATES.map((tpl) => (
        <Chip
          key={tpl.id}
          active={value === tpl.id}
          label={tpl.label}
          icon={tpl.icon}
          description={tpl.description}
          onClick={() => onChange?.(tpl.id)}
        />
      ))}
    </div>
  )
}

function Chip({ active, label, icon, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-black transition-all',
        'min-h-[36px]',
        active
          ? 'theme-accent-fill theme-on-accent border-transparent shadow-elev-sm'
          : 'theme-card theme-border theme-text hover:theme-bg-subtle',
      ].join(' ')}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
