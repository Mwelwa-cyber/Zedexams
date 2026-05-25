import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listCbcTopics, saveCbcTopic, deleteCbcTopic, importBuiltInTopics,
  listLessons, saveLesson, deleteLesson, bulkImportCurriculumModules,
  curriculumTopicDocId, subtopicName, getActiveKbVersion, KB_VERSION,
} from '../../utils/adminCbcKbService'
import {
  TEACHER_GRADES, TEACHER_SUBJECTS,
} from '../../utils/teacherTools'
import { LEARNING_ENVIRONMENTS } from '../../config/learningEnvironments'
import SeoHelmet from '../seo/SeoHelmet'
import SyllabusPdfUploadPanel from './SyllabusPdfUploadPanel'
import GenerateFromTopicMenu from './GenerateFromTopicMenu'
import BulkGenerateButton from './BulkGenerateButton'
import BulkPublishQuizzesButton from './BulkPublishQuizzesButton'

const EMPTY_LESSON = {
  subtopic: '',
  term: 1,
  suggestedLessons: '',
  learningEnvironmentOptions: [],
  outcomes: [''],
  competencies: [''],
  vocabulary: [''],
  contentSummary: '',
  teacherActivities: [''],
  learnerActivities: [''],
  teachingMaterials: [''],
  assessmentCriteria: [''],
  exercises: [''],
  remedialActivities: [''],
  extensionActivities: [''],
}

const LESSON_ARRAY_FIELDS = [
  'outcomes', 'competencies', 'vocabulary', 'teacherActivities',
  'learnerActivities', 'teachingMaterials', 'assessmentCriteria',
  'exercises', 'remedialActivities', 'extensionActivities',
]

const EMPTY_FORM = {
  grade: 'G10',
  subject: 'biology',
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
  const [activeVersion, setActiveVersion] = useState(null)
  const [filters, setFilters] = useState({ grade: '', subject: '', search: '' })
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [importing, setImporting] = useState(false)
  const [lessonsTopic, setLessonsTopic] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  function flashToast(msg, ms = 5000) {
    setToast(msg)
    setTimeout(() => setToast(''), ms)
  }

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

  // Surface the active version so admins know which syllabus they're
  // editing — useful after Phase C activate or Phase D rollback flips
  // _meta to a non-default version.
  useEffect(() => {
    let cancelled = false
    getActiveKbVersion().then((v) => {
      if (!cancelled) setActiveVersion(v)
    }).catch(() => { /* fallback already returns the default */ })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.grade && r.grade !== filters.grade) return false
      if (filters.subject && r.subject !== filters.subject) return false
      if (term) {
        const subs = (r.subtopics || []).map(subtopicName)
        const haystack = [r.topic, ...subs].filter(Boolean).join(' ').toLowerCase()
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
    // Enriched subtopics arrive as objects (post-Phase-C activate); the
    // edit form is flat-string-only for now, so we surface only the names.
    // Saving here will drop the per-subtopic detail — admins who need the
    // enrichment should re-upload through Curriculum Replace Studio.
    const subtopicNames = (topic.subtopics || []).map(subtopicName)
    setForm({
      grade: topic.grade || 'G10',
      subject: topic.subject || 'biology',
      topic: topic.topic || '',
      subtopics: subtopicNames.length ? subtopicNames : [''],
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

  const isCustomVersion = activeVersion && activeVersion !== KB_VERSION

  return (
    <div className="space-y-5">
      <SeoHelmet title="CBC knowledge base" noIndex />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-eyebrow">Admin</p>
          <h1 className="text-display-xl text-gray-800 mt-1">CBC Knowledge Base</h1>
          <p className="text-body-sm text-gray-500 mt-1">
            Custom curriculum topics that supplement the built-in G1–9 seed.
            Ideal for adding Grade 10–12 subjects.
          </p>
          {activeVersion && (
            <p className="text-xs mt-2">
              <span className="text-gray-500">Editing version:</span>{' '}
              <code className={`px-1.5 py-0.5 rounded font-mono ${
                isCustomVersion ?
                  'bg-emerald-100 text-emerald-900' :
                  'bg-slate-100 text-slate-700'
              }`}>{activeVersion}</code>
              {isCustomVersion ? (
                <span className="ml-2 text-emerald-700 font-bold">active</span>
              ) : (
                <span className="ml-2 text-slate-500">seed default</span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <BulkPublishQuizzesButton topics={filtered} />
          <BulkGenerateButton topics={filtered} />
          <button
            onClick={openNew}
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
          >
            + Add topic
          </button>
        </div>
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

      {/* Syllabus PDF → KB extractor (Claude-powered, admin-only).
          On success the panel calls load() so newly added topics
          appear in the list below without a full page reload. */}
      <SyllabusPdfUploadPanel onComplete={() => { load(); flashToast('Topics added from PDF — review the new entries below.', 8000) }} />

      {/* Bulk-import curriculum modules */}
      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4">
        <button
          onClick={() => setBulkOpen((o) => !o)}
          className="flex items-center gap-2 font-black text-amber-900"
        >
          <span>{bulkOpen ? '▾' : '▸'}</span>
          📥 Bulk-import lesson modules (JSON)
        </button>
        {bulkOpen && (
          <BulkImportPanel onDone={(msg) => { flashToast(msg, 8000); load() }} />
        )}
      </div>

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
                {topic.origin === 'builtin_seed' && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px]">
                    built-in
                  </span>
                )}
              </div>
              <h3 className="font-black text-base text-slate-900">{topic.topic}</h3>
              {topic.subtopics?.length > 0 && (
                <p className="text-xs text-slate-600 mt-1">
                  {topic.subtopics.slice(0, 3).map(subtopicName).join(' · ')}
                  {topic.subtopics.length > 3 && ` · +${topic.subtopics.length - 3} more`}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                <GenerateFromTopicMenu topic={topic} />
                <button
                  onClick={() => openEdit(topic)}
                  className="text-emerald-700 hover:underline font-bold"
                >
                  edit
                </button>
                <button
                  onClick={() => setLessonsTopic(topic)}
                  className="text-sky-700 hover:underline font-bold"
                >
                  lessons
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

      {/* Lessons manager modal */}
      {lessonsTopic && (
        <LessonsManagerModal
          topic={lessonsTopic}
          onClose={() => setLessonsTopic(null)}
          onToast={flashToast}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          </div>
          <p className="text-xs text-slate-500">
            Topics span the school year — the term is chosen per lesson module
            below (or by the teacher in their brief), not on the topic itself.
          </p>

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

/* ── Bulk import ────────────────────────────────────────────── */

const SAMPLE_MODULE = JSON.stringify([{
  grade: 'G4', subject: 'integrated_science', term: 2,
  topic: 'Plants', subtopic: 'Parts of a Plant',
  suggestedLessons: 2,
  learningEnvironmentOptions: ['classroom', 'school_garden'],
  outcomes: ['Identify the main parts of a plant'],
  competencies: ['Observation'], vocabulary: ['root', 'stem', 'leaf'],
  contentSummary: 'Introduce the main external parts of a plant…',
  teacherActivities: ['Show a real plant and name each part'],
  learnerActivities: ['Draw and label a plant'],
  teachingMaterials: ['A real plant', 'Chart of plant parts'],
  assessmentCriteria: ['Correctly labels 4+ parts'],
  exercises: ['Label the diagram of a plant'],
  remedialActivities: ['Re-match part names to a picture'],
  extensionActivities: ['Find out what each part does'],
}], null, 2)

function BulkImportPanel({ onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function run() {
    setError('')
    setResult(null)
    let rows
    try {
      rows = JSON.parse(text)
    } catch (e) {
      setError(`Not valid JSON: ${e.message || e}`)
      return
    }
    if (!Array.isArray(rows)) {
      setError('Top level must be a JSON array of module objects.')
      return
    }
    setBusy(true)
    const res = await bulkImportCurriculumModules(rows)
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Import failed.'); return }
    setResult(res)
    onDone(
      `Imported ${res.written}/${res.totalSubmitted} modules` +
      (res.skipped ? ` · ${res.skipped} skipped (see errors below)` : '') + '.',
    )
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-amber-900/80">
        Paste a JSON array of curriculum modules (one per sub-topic). Every
        row is validated on the server — grade, subject, term, topic,
        sub-topic and at least one outcome are required; `suggestedLessons`
        is optional. Valid rows are saved; invalid rows are skipped and
        reported.
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer font-bold text-amber-900">
          Show example
        </summary>
        <pre className="mt-2 p-3 rounded-lg bg-white border-2 theme-border overflow-x-auto text-[11px] leading-relaxed">
          {SAMPLE_MODULE}
        </pre>
      </details>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="[ { ...module... }, { ...module... } ]"
        rows={8}
        className="w-full px-3 py-2 rounded-lg border-2 theme-border font-mono text-xs focus:outline-none focus:border-amber-400"
      />
      {error && (
        <p className="text-sm text-rose-700 font-bold">{error}</p>
      )}
      {result && result.errors?.length > 0 && (
        <div className="text-xs bg-white border-2 border-rose-200 rounded-lg p-3 max-h-48 overflow-y-auto">
          <p className="font-black text-rose-700 mb-1">
            {result.skipped} row(s) skipped:
          </p>
          {result.errors.map((er, i) => (
            <p key={i} className="text-rose-600">
              Row {er.row}: {(er.errors || []).join('; ')}
            </p>
          ))}
        </div>
      )}
      <button
        onClick={run}
        disabled={busy || !text.trim()}
        className="px-5 py-2 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50"
      >
        {busy ? 'Importing…' : 'Validate & import'}
      </button>
    </div>
  )
}

/* ── Lessons manager ────────────────────────────────────────── */

function LessonsManagerModal({ topic, onClose, onToast }) {
  const topicId = curriculumTopicDocId(topic)
  const [lessons, setLessons] = useState(null)
  const [editing, setEditing] = useState(null) // lesson object | 'new' | null

  const reload = useCallback(() => {
    if (!topicId) { setLessons([]); return }
    setLessons(null)
    listLessons(topicId).then(setLessons).catch(() => setLessons([]))
  }, [topicId])
  useEffect(() => { reload() }, [reload])

  async function onDeleteLesson(l) {
    if (!window.confirm(
      `Delete the "${l.subtopic}" (Term ${l.term ?? '—'}) module?`,
    )) return
    const ok = await deleteLesson(topicId, l.id)
    if (ok) { onToast('Lesson deleted.'); reload() } else {
      onToast('Delete failed — check console.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full my-8 shadow-2xl">
        <div className="sticky top-0 bg-white border-b theme-border px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="font-black text-lg">Lesson modules</h2>
            <p className="text-xs text-slate-500">
              {topic.grade} · {formatSubject(topic.subject)} · {topic.topic}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <button
            onClick={() => setEditing('new')}
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-sky-500 to-indigo-500"
          >
            + Add lesson module
          </button>

          {lessons === null && <Msg icon="📚" text="Loading lessons…" />}
          {lessons && lessons.length === 0 && (
            <Msg
              icon="📝"
              title="No lesson modules yet"
              text="Add the lesson-by-lesson modules for this sub-topic. The generators use these as the source of truth."
            />
          )}
          {lessons && lessons.length > 0 && (
            <div className="space-y-2">
              {lessons.map((l) => (
                <div
                  key={l.id}
                  className="border-2 theme-border rounded-xl p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-black text-sm text-slate-900">
                      {l.subtopic}{' '}
                      <span className="text-slate-500 font-normal">
                        — Term {l.term ?? '—'} · ~{l.suggestedLessons || 1} lesson(s)
                      </span>
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5 truncate">
                      {(l.outcomes || []).slice(0, 2).join(' · ') || '(no outcomes)'}
                    </p>
                  </div>
                  <div className="flex gap-3 text-xs shrink-0">
                    <button
                      onClick={() => setEditing(l)}
                      className="text-emerald-700 hover:underline font-bold"
                    >
                      edit
                    </button>
                    <button
                      onClick={() => onDeleteLesson(l)}
                      className="text-rose-600 hover:underline"
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-white border-t theme-border px-5 py-3 flex justify-end rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold border-2 theme-border hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>

      {editing && (
        <LessonFormModal
          topic={topic}
          topicId={topicId}
          lesson={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onToast('Lesson saved. ~60s to reach Cloud Functions (KB cache).')
            reload()
          }}
        />
      )}
    </div>
  )
}

function LessonFormModal({ topic, topicId, lesson, onCancel, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!lesson) return { ...EMPTY_LESSON }
    const f = { ...EMPTY_LESSON }
    f.subtopic = lesson.subtopic || ''
    f.term = Number(lesson.term) || 1
    f.suggestedLessons = lesson.suggestedLessons || ''
    f.learningEnvironmentOptions = [...(lesson.learningEnvironmentOptions || [])]
    f.contentSummary = lesson.contentSummary || ''
    for (const k of LESSON_ARRAY_FIELDS) {
      f[k] = lesson[k]?.length ? [...lesson[k]] : ['']
    }
    return f
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function toggleEnv(value) {
    setForm((f) => {
      const has = f.learningEnvironmentOptions.includes(value)
      return {
        ...f,
        learningEnvironmentOptions: has
          ? f.learningEnvironmentOptions.filter((x) => x !== value)
          : [...f.learningEnvironmentOptions, value],
      }
    })
  }

  async function onSave() {
    setError('')
    setSaving(true)
    try {
      const payload = {
        grade: topic.grade,
        subject: topic.subject,
        term: Number(form.term) || 1,
        topic: topic.topic,
        subtopic: form.subtopic,
        suggestedLessons: form.suggestedLessons ?
          Number(form.suggestedLessons) : undefined,
        learningEnvironmentOptions: form.learningEnvironmentOptions,
        contentSummary: form.contentSummary,
      }
      for (const k of LESSON_ARRAY_FIELDS) {
        payload[k] = (form[k] || []).filter(Boolean)
      }
      await saveLesson(topicId, payload)
      onSaved()
    } catch (err) {
      setError(err.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full my-8 shadow-2xl">
        <div className="sticky top-0 bg-white border-b theme-border px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="font-black text-lg">
            {lesson ? 'Edit lesson module' : 'Add lesson module'}
          </h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500">
            {topic.grade} · {formatSubject(topic.subject)} · {topic.topic}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Labelled label="Sub-topic *">
                <input
                  type="text"
                  value={form.subtopic}
                  onChange={(e) => update('subtopic', e.target.value)}
                  placeholder="e.g. Parts of a Plant"
                  maxLength={200}
                  className="w-full px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400"
                />
              </Labelled>
            </div>
            <Labelled label="Term">
              <select
                value={form.term}
                onChange={(e) => update('term', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border-2 theme-border bg-white"
              >
                <option value={1}>Term 1</option>
                <option value={2}>Term 2</option>
                <option value={3}>Term 3</option>
              </select>
            </Labelled>
          </div>

          <Labelled label="Suggested number of lessons (optional)">
            <input
              type="number" min={1} max={20}
              value={form.suggestedLessons}
              onChange={(e) => update('suggestedLessons', e.target.value)}
              placeholder="defaults to one lesson per outcome"
              className="w-full px-3 py-2 rounded-lg border-2 theme-border"
            />
            <p className="text-xs text-slate-500 mt-1">
              Just a default hint — the teacher chooses how many lessons to
              split this sub-topic into when generating.
            </p>
          </Labelled>

          <div>
            <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
              Suitable learning environments
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {LEARNING_ENVIRONMENTS.map((e) => (
                <label key={e.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.learningEnvironmentOptions.includes(e.value)}
                    onChange={() => toggleEnv(e.value)}
                    style={{ accentColor: '#0ea5e9' }}
                  />
                  {e.label}
                </label>
              ))}
            </div>
          </div>

          <Labelled label="Content summary">
            <textarea
              value={form.contentSummary}
              onChange={(e) => update('contentSummary', e.target.value)}
              rows={3}
              placeholder="What this specific lesson teaches…"
              className="w-full px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400"
            />
          </Labelled>

          <ArrayEditor label="Specific outcomes *" hint="At least one is required." values={form.outcomes} onChange={(v) => update('outcomes', v)} />
          <ArrayEditor label="Competencies" values={form.competencies} onChange={(v) => update('competencies', v)} />
          <ArrayEditor label="Key vocabulary" values={form.vocabulary} onChange={(v) => update('vocabulary', v)} />
          <ArrayEditor label="Teacher activities" values={form.teacherActivities} onChange={(v) => update('teacherActivities', v)} />
          <ArrayEditor label="Learner activities" values={form.learnerActivities} onChange={(v) => update('learnerActivities', v)} />
          <ArrayEditor label="Teaching and learning materials" values={form.teachingMaterials} onChange={(v) => update('teachingMaterials', v)} />
          <ArrayEditor label="Assessment criteria" values={form.assessmentCriteria} onChange={(v) => update('assessmentCriteria', v)} />
          <ArrayEditor label="Sample exercises / questions" values={form.exercises} onChange={(v) => update('exercises', v)} />
          <ArrayEditor label="Remedial activities" values={form.remedialActivities} onChange={(v) => update('remedialActivities', v)} />
          <ArrayEditor label="Extension activities" values={form.extensionActivities} onChange={(v) => update('extensionActivities', v)} />

          {error && (
            <p className="text-sm text-rose-700 font-bold">{error}</p>
          )}
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
            disabled={saving || !form.subtopic.trim()}
            className="px-5 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-sky-500 to-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save lesson'}
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
