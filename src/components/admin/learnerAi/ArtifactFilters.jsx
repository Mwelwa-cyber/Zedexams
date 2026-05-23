// Filter bar for ArtifactGrid. Stateless — controlled by the parent
// so the URL query can drive filters in a future PR. Mobile-first
// flexbox; chips wrap onto multiple lines on small screens.

const STATUSES = [
  'all', 'draft', 'needs_review', 'approved', 'published',
  'rejected', 'regenerate_required',
]

export default function ArtifactFilters({
  value,
  onChange,
  knownGrades = [],
  knownSubjects = [],
  knownTopics = [],
}) {
  function patch(field, v) {
    onChange({ ...value, [field]: v })
  }
  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg mb-3">
      <input
        type="search"
        value={value.search || ''}
        onChange={e => patch('search', e.target.value)}
        placeholder="Search title / topic / subtopic…"
        className="flex-1 min-w-[180px] text-xs border border-slate-300 rounded px-2 py-1.5"
      />
      <select
        value={value.status || 'all'}
        onChange={e => patch('status', e.target.value)}
        className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
      >
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        value={value.grade || 'all'}
        onChange={e => patch('grade', e.target.value)}
        className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
      >
        <option value="all">all grades</option>
        {knownGrades.map(g => <option key={g} value={g}>{`G${g}`}</option>)}
      </select>
      <select
        value={value.subject || 'all'}
        onChange={e => patch('subject', e.target.value)}
        className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
      >
        <option value="all">all subjects</option>
        {knownSubjects.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        value={value.topic || 'all'}
        onChange={e => patch('topic', e.target.value)}
        className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
      >
        <option value="all">all topics</option>
        {knownTopics.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button
        type="button"
        onClick={() => onChange({ search: '', status: 'all', grade: 'all', subject: 'all', topic: 'all' })}
        className="text-xs font-semibold px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200"
      >
        Clear
      </button>
    </div>
  )
}
