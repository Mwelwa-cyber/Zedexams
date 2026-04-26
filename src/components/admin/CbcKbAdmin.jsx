import { useEffect, useMemo, useState } from 'react'
import {
  listCbcTopics, saveCbcTopic, deleteCbcTopic, importBuiltInTopics,
} from '../../utils/adminCbcKbService'
import {
  TEACHER_GRADES, TEACHER_SUBJECTS,
} from '../../utils/teacherTools'

const EMPTY_FORM = {
  grade: 'G10',
  subject: 'biology',
  term: 1,
  topic: '',
  subtopics: [''],
  specificOutcomes: [''],
  keyCompetencies: [''],
  values: [''],
  suggestedMaterials: [''],
}

export default function CbcKbAdmin() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [filters, setFilters] = useState({ grade: '', subject: '', search: '' })
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [importing, setImporting] = useState(false)

  async function load() {
    setStatus('loading')
    try {
      const data = await listCbcTopics()
      setRows(data)
      setStatus(data.length === 0 ? 'empty' : 'ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.grade && r.grade !== filters.grade) return false
      if (filters.subject && r.subject !== filters.subject) return false
      if (term) {
        const haystack = [r.topic, ...(r.subtopics || [])].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [rows, filters])

  function openNew() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setFormOpen(true)
  }

  function openEdit(topic) {
    setForm({
      grade: topic.grade || 'G10',
      subject: topic.subject || 'biology',
      term: topic.term || 1,
      topic: topic.topic || '',
      subtopics: topic.subtopics?.length ? [...topic.subtopics] : [''],
      specificOutcomes: topic.specificOutcomes?.length ? [...topic.specificOutcomes] : [''],
      keyCompetencies: topic.keyCompetencies?.length ? [...topic.keyCompetencies] : [''],
      values: topic.values?.length ? [...topic.values] : [''],
      suggestedMaterials: topic.suggestedMaterials?.length ? [...topic.suggestedMaterials] : [''],
    })
    setEditingId(topic.id)
    setFormOpen(true)
  }

  async function onSave() {
    setSaving(true)
    try {
      await saveCbcTopic({
        ...form,
        subtopics: form.subtopics.filter(Boolean),
        specificOutcomes: form.specificOutcomes.filter(Boolean),
        keyCompetencies: form.keyCompetencies.filter(Boolean),
        values: form.values.filter(Boolean),
        suggestedMaterials: form.suggestedMaterials.filter(Boolean),
      })
      setToast(editingId ? 'Topic updated.' : 'Topic added. Takes ~60s to reach Cloud Functions (KB cache TTL).')
      setFormOpen(false)
      setEditingId(null)
      await load()
    } catch (err) {
      setToast(`Save failed: ${err.message || err}`)
    }
    setSaving(false)
    setTimeout(() => setToast(''), 5000)
  }

  async function onDelete(topic) {
    if (!window.confirm(`Delete topic "${topic.topic}" (${topic.grade} ${topic.subject})?`)) return
    const ok = await deleteCbcTopic(topic.id)
    if (ok) {
      setRows((rs) => rs.filter((r) => r.id !== topic.id))
      setToast('Topic deleted.')
      setTimeout(() => setToast(''), 3000)
    } else {
      setToast('Delete failed — check console.')
    }
  }

  async function onImportBuiltIn() {
    const confirmed = window.confirm(
      'Import the 90 built-in G1–9 topics into Firestore so you can edit them here?\n\n' +
      'Existing Firestore entries with matching IDs will be OVERWRITTEN with the ' +
      'latest in-code data. Use with care if you have custom edits on built-ins.',
    )
    if (!confirmed) return
    setImporting(true)
    setToast('')
    const res = await importBuiltInTopics()
    setImporting(false)
    if (res.ok) {
      setToast(`Imported ${res.written} / ${res.totalInCode} built-in topics.`)
      await load()
    } else {
      setToast(`Import failed: ${res.error}`)
    }
    setTimeout(() => setToast(''), 6000)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-eyebrow">Admin</p>
          <h1 className="text-display-xl text-gray-800 mt-1">CBC Knowledge Base</h1>
          <p className="text-body-sm text-gray-500 mt-1">
            Custom curriculum topics that supplement the built-in G1–9 seed.
            Ideal for adding Grade 10–12 subjects.
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
        >
          + Add topic
        </button>
      </header>

      {toast && (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {toast}
        </div>
      )}

      {/* Import built-ins panel — prominent when list is small */}
      {(status !== 'loading' && rows.length < 20) && (
        <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-sky-50 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="text-3xl">📦</div>
            <div className="flex-1">
              <p className="font-black text-indigo-900">Import the 90 built-in G1–9 topics</p>
              <p className="text-sm text-indigo-800/80 mt-1">
                The Cloud Function ships with a curated Grade 1–9 seed. Import it
                here to make every topic editable through this page — fix typos,
                adjust outcomes, tailor to your school's language.
              </p>
            </div>
            <button
              onClick={onImportBuiltIn}
              disabled={importing}
              className="px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-indigo-500 to-sky-500 disabled:opacity-50 whitespace-nowrap"
            >
              {importing ? 'Importing…' : 'Import 90 topics'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-white border-2 theme-border rounded-2xl p-3">
        <FilterSelect
          label="Grade"
          value={filters.grade}
          options={[{ value: '', label: 'All grades' }, ...TEACHER_GRADES]}
          onChange={(v) => setFilters((f) => ({ ...f, grade: v }))}
        />
        <FilterSelect
          label="Subject"
          value={filters.subject}
          options={[{ value: '', label: 'All subjects' }, ...TEACHER_SUBJECTS]}
          onChange={(v) => setFilters((f) => ({ ...f, subject: v }))}
        />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search topic / sub-topic…"
          className="px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400"
        />
      </div>

      {/* List */}
      {status === 'loading' && <Msg icon="📚" text="Loading topics…" />}
      {status === 'error' && <Msg icon="⚠️" text="Could not load topics — check admin permissions." />}
      {status === 'empty' && (
        <Msg
          icon="📖"
          title="No custom topics yet"
          text={
            'The Cloud Function is using the built-in seed (G1–9 core subjects). ' +
            'Add topics here to extend coverage — especially senior-secondary ' +
            '(G10–12 Biology, Chemistry, Physics, History, Geography, Literature).'
          }
        />
      )}
      {status === 'ready' && filtered.length === 0 && (
        <Msg icon="🔍" text="No topics match these filters." />
      )}
      {status === 'ready' && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((topic) => (
            <div key={topic.id} className="bg-white border-2 theme-border rounded-2xl p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500 mb-2">
                <span>{topic.grade}</span>
                <span>·</span>
                <span>{formatSubject(topic.subject)}</span>
                <span>·</span>
                <span>Term {topic.term}</span>
                {topic.origin === 'builtin_seed' && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px]">
                    built-in
                  </span>
                )}
              </div>
              <h3 className="font-black text-base text-slate-900">{topic.topic}</h3>
              {topic.subtopics?.length > 0 && (
                <p className="text-xs text-slate-600 mt-1">
                  {topic.subtopics.slice(0, 3).join(' · ')}
                  {topic.subtopics.length > 3 && ` · +${topic.subtopics.length - 3} more`}
                </p>
              )}
              <div className="flex gap-3 mt-3 text-xs">
                <button
                  onClick={() => openEdit(topic)}
                  className="text-emerald-700 hover:underline font-bold"
                >
                  edit
                </button>
                <button
                  onClick={() => onDelete(topic)}
                  className="text-rose-600 hover:underline"
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {formOpen && (
        <TopicFormModal
          form={form}
          setForm={setForm}
          editing={!!editingId}
          saving={saving}
          onSave={onSave}
          onCancel={() => { setFormOpen(false); setEditingId(null) }}
        />
      )}
    </div>
  )
}

/* ── Form modal ─────────────────────────────────────────────── */

function TopicFormModal({ form, setForm, editing, saving, onSave, onCancel }) {
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full my-8 shadow-2xl">
        <div className="sticky top-0 bg-white border-b theme-border px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="font-black text-lg">{editing ? 'Edit topic' : 'Add a new CBC topic'}</h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Labelled label="Grade">
              <select value={form.grade} onChange={(e) => update('grade', e.target.value)} className="w-full px-3 py-2 rounded-lg border-2 theme-border bg-white">
                {TEACHER_GRADES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </Labelled>
            <Labelled label="Subject">
              <select value={form.subject} onChange={(e) => update('subject', e.target.value)} className="w-full px-3 py-2 rounded-lg border-2 theme-border bg-white">
                {TEACHER_SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Labelled>
            <Labelled label="Term">
              <select value={form.term} onChange={(e) => update('term', Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border-2 theme-border bg-white">
                <option value={1}>Term 1</option>
                <option value={2}>Term 2</option>
                <option value={3}>Term 3</option>
              </select>
            </Labelled>
          </div>

          <Labelled label="Topic *">
            <input
              type="text"
              value={form.topic}
              onChange={(e) => update('topic', e.target.value)}
              placeholder="e.g. Cell Division (Mitosis & Meiosis)"
              maxLength={200}
              className="w-full px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400"
            />
          </Labelled>

          <ArrayEditor
            label="Sub-topics"
            hint="One per line. e.g. Phases of mitosis, Meiosis, Significance of cell division"
            values={form.subtopics}
            onChange={(v) => update('subtopics', v)}
          />

          <ArrayEditor
            label="Specific Outcomes"
            hint={'Measurable CBC outcomes. Start with "By the end of the lesson, pupils should be able to…"'}
            values={form.specificOutcomes}
            onChange={(v) => update('specificOutcomes', v)}
          />

          <ArrayEditor
            label="Key Competencies"
            hint="From the Zambian CBC competencies (Critical thinking, Numeracy, Communication, etc.)"
            values={form.keyCompetencies}
            onChange={(v) => update('keyCompetencies', v)}
          />

          <ArrayEditor
            label="Values"
            hint="e.g. Accuracy, Curiosity, Integrity, Cooperation"
            values={form.values}
            onChange={(v) => update('values', v)}
          />

          <ArrayEditor
            label="Suggested Teaching/Learning Materials"
            hint="e.g. Microscope, Grade 10 Biology Pupil's Book (CDC), pages 32-37"
            values={form.suggestedMaterials}
            onChange={(v) => update('suggestedMaterials', v)}
          />
        </div>
        <div className="sticky bottom-0 bg-white border-t theme-border px-5 py-3 flex items-center justify-end gap-2 rounded-b-2xl">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-bold border-2 theme-border hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.topic.trim()}
            className="px-5 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : (editing ? 'Save changes' : 'Add topic')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Small components ───────────────────────────────────────── */

function Labelled({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function ArrayEditor({ label, hint, values, onChange }) {
  const update = (i, v) => onChange(values.map((x, idx) => idx === i ? v : x))
  const add = () => onChange([...values, ''])
  const remove = (i) => onChange(values.filter((_, idx) => idx !== i).concat(values.length === 1 ? [''] : []))

  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-wide text-slate-600">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={v}
              onChange={(e) => update(i, e.target.value)}
              placeholder={`${label.replace(/s$/, '')} ${i + 1}`}
              className="flex-1 px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400"
            />
            {values.length > 1 && (
              <button
                onClick={() => remove(i)}
                type="button"
                className="text-rose-600 text-sm hover:underline px-2"
              >
                remove
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-2 text-xs text-emerald-700 font-bold hover:underline"
      >
        + Add another
      </button>
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400 bg-white"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function Msg({ icon, title, text }) {
  return (
    <div className="bg-white border-2 theme-border rounded-2xl p-10 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      {title && <p className="font-black text-slate-800 mb-1">{title}</p>}
      <p className="text-sm text-slate-500 max-w-md mx-auto">{text}</p>
    </div>
  )
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
