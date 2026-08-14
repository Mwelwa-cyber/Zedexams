// src/features/notes/components/NoteFilters.jsx
//
// Filter bar for the admin list: search by title, plus subject / grade / status dropdowns.
// Pure controlled component — pass the values, get the change events.

import { Search, ChevronDown } from '../../../shared/components/icons'
import { SUBJECTS_BY_BAND, getActiveGrades, NOTE_STATUS } from '../../../config/curriculum'

export function NoteFilters({
  search, onSearchChange,
  subject, onSubjectChange,
  grade,   onGradeChange,
  status,  onStatusChange,
}) {
  const activeGrades = getActiveGrades()

  // Flatten subject labels across all active bands for the dropdown.
  const subjects = Array.from(
    new Set(activeGrades.flatMap(g => SUBJECTS_BY_BAND[g.band] || [])),
  )

  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by title…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-white rounded-lg border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-300 transition"
        />
      </div>

      <Dropdown
        value={subject}
        onChange={onSubjectChange}
        options={[
          { value: 'all', label: 'All subjects' },
          ...subjects.map(s => ({ value: s, label: s })),
        ]}
      />
      <Dropdown
        value={grade}
        onChange={onGradeChange}
        options={[
          { value: 'all', label: 'All grades' },
          ...activeGrades.map(g => ({ value: String(g.value), label: `Grade ${g.value}` })),
        ]}
      />
      <Dropdown
        value={status}
        onChange={onStatusChange}
        options={[
          { value: 'all', label: 'All statuses' },
          { value: NOTE_STATUS.PUBLISHED, label: 'Published' },
          { value: NOTE_STATUS.DRAFT,     label: 'Drafts' },
        ]}
      />
    </div>
  )
}

function Dropdown({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none text-sm bg-white border border-neutral-200 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 cursor-pointer transition text-neutral-900"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500" />
    </div>
  )
}
