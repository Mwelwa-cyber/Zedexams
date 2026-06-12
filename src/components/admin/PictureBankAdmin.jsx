// Picture Bank admin — curate the subject-organised teaching-figure
// library teachers search from the Assessment Studio. Three intake
// streams land here:
//   1. Staged extractions — images pulled out of sample papers uploaded
//      for assessment-format extraction; tag (name + keywords) or discard.
//   2. Direct uploads.
//   3. AI generation via the existing generateDiagram callable.

import { useCallback, useEffect, useMemo, useState } from 'react'
import SeoHelmet from '../seo/SeoHelmet'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useAuth } from '../../contexts/AuthContext'
import { TEACHER_SUBJECTS } from '../../utils/teacherTools'
import {
  listBankPictures, activateBankPicture, deleteBankPicture,
  uploadBankPicture, generateBankPicture, resolvePictureUrl,
} from '../../utils/pictureBankService'

const SUBJECT_OPTIONS = [
  { value: '_generic', label: 'All subjects (generic)' },
  ...TEACHER_SUBJECTS.filter((s) => s.value),
]

function subjectLabel(value) {
  if (value === '_generic') return 'All subjects'
  return SUBJECT_OPTIONS.find((s) => s.value === value)?.label ||
    String(value || '').replace(/_/g, ' ')
}

export default function PictureBankAdmin() {
  const { currentUser } = useAuth()
  const [pictures, setPictures] = useState([])
  const [urls, setUrls] = useState({}) // id -> resolved url
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const flash = useCallback((msg, ms = 5000) => {
    setToast(msg)
    if (ms > 0) setTimeout(() => setToast(''), ms)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await listBankPictures({})
    setPictures(rows)
    setLoading(false)
    // Resolve preview URLs lazily, best effort.
    for (const p of rows) {
      if (p.url) continue
      resolvePictureUrl(p).then((u) => {
        if (u) setUrls((m) => (m[p.id] ? m : { ...m, [p.id]: u }))
      }).catch(() => {})
    }
  }, [])

  useEffect(() => { load() }, [load])

  const staged = useMemo(
    () => pictures.filter((p) => p.status === 'staged'),
    [pictures],
  )
  const active = useMemo(() => {
    let rows = pictures.filter((p) => p.status === 'active')
    if (subjectFilter !== 'all') rows = rows.filter((p) => p.subject === subjectFilter)
    const q = filter.toLowerCase().trim()
    if (q) {
      rows = rows.filter((p) =>
        (p.nameLower || '').includes(q) ||
        (Array.isArray(p.keywords) && p.keywords.some((k) => k.includes(q))))
    }
    return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }, [pictures, filter, subjectFilter])

  function urlFor(p) {
    return p.url || urls[p.id] || null
  }

  async function onActivate(pic, form) {
    try {
      await activateBankPicture(pic, form)
      flash(`"${form.name}" is live — teachers can find it now.`)
      await load()
      return true
    } catch (err) {
      flash(`Activate failed: ${err?.message || err}`)
      return false
    }
  }

  async function performDelete(pic) {
    setDeleteBusy(true)
    try {
      const ok = await deleteBankPicture(pic)
      flash(ok ? 'Picture removed.' : 'Delete failed — check console.')
      if (ok) await load()
    } finally {
      setDeleteBusy(false)
      setPendingDelete(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8">
      <SeoHelmet title="Picture bank" noIndex />
      <header>
        <p className="text-eyebrow text-emerald-700">Admin · Picture bank</p>
        <h1 className="text-display-lg text-gray-900 mt-1">
          Diagrams &amp; pictures for assessments
        </h1>
        <p className="text-sm text-gray-600 mt-2 max-w-3xl">
          Teachers search this bank by name or keyword (e.g. “domestic
          animals”) when attaching images to assessment questions. Images
          extracted from uploaded sample papers appear under <strong>Needs
          tagging</strong> — give each a clear name and keywords, or discard
          logos and decoration.
        </p>
      </header>

      {toast && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm">
          {toast}
        </div>
      )}

      <IntakePanels uid={currentUser?.uid} flash={flash} onDone={load} />

      {loading ? (
        <p className="text-sm text-gray-500">Loading pictures…</p>
      ) : (
        <>
          {staged.length > 0 && (
            <section>
              <h2 className="text-lg font-black text-gray-900 mb-3">
                Needs tagging ({staged.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {staged.map((p) => (
                  <StagedCard
                    key={p.id}
                    pic={p}
                    url={urlFor(p)}
                    onActivate={onActivate}
                    onDiscard={() => setPendingDelete(p)}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="text-lg font-black text-gray-900">
                Active pictures ({active.length})
              </h2>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search name or keyword…"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="all">All subjects</option>
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            {active.length === 0 ? (
              <p className="text-sm text-gray-500">
                No active pictures match. Upload one, generate one with AI,
                or tag a staged extraction above.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {active.map((p) => (
                  <div key={p.id} className="border border-gray-200 rounded-xl p-2 bg-white">
                    {urlFor(p) ? (
                      <img src={urlFor(p)} alt={p.name}
                        className="w-full h-28 object-contain bg-gray-50 rounded-lg" />
                    ) : (
                      <div className="w-full h-28 bg-gray-100 rounded-lg" />
                    )}
                    <div className="mt-2 text-sm font-bold text-gray-900 truncate">{p.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {subjectLabel(p.subject)} · {(p.keywords || []).join(', ')}
                    </div>
                    <button
                      type="button"
                      className="mt-1 text-xs text-red-600 hover:underline"
                      onClick={() => setPendingDelete(p)}
                    >
                      delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.status === 'staged' ? 'Discard this extracted image?' : 'Delete this picture?'}
        message={<>"{pendingDelete?.name}" will be removed from the bank{pendingDelete?.status === 'active' ? ' — teachers will no longer find it' : ''}.</>}
        confirmLabel={pendingDelete?.status === 'staged' ? 'Discard' : 'Delete'}
        variant="danger"
        loading={deleteBusy}
        onConfirm={() => pendingDelete && performDelete(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function StagedCard({ pic, url, onActivate, onDiscard }) {
  const [name, setName] = useState('')
  const [keywords, setKeywords] = useState('')
  const [subject, setSubject] = useState(pic.subject || '_generic')
  const [busy, setBusy] = useState(false)

  async function activate() {
    setBusy(true)
    const ok = await onActivate(pic, { name, keywords, subject, gradeBand: pic.gradeBand || '' })
    if (!ok) setBusy(false)
  }

  return (
    <div className="border-2 border-dashed border-amber-300 rounded-xl p-3 bg-amber-50/40">
      {url ? (
        <img src={url} alt="" className="w-full h-36 object-contain bg-white rounded-lg" />
      ) : (
        <div className="w-full h-36 bg-gray-100 rounded-lg" />
      )}
      <p className="text-xs text-gray-500 mt-1 truncate">
        From: {pic.sourceNote || 'sample paper'}
      </p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder='Name, e.g. "Human ear, labelled"'
        className="mt-2 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        maxLength={120}
      />
      <input
        type="text"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        placeholder="Keywords, comma-separated: ear, hearing, senses"
        className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
      />
      <select
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
      >
        {SUBJECT_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={activate}
          disabled={busy || !name.trim() || !keywords.trim()}
          className="flex-1 bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm font-bold disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add to bank'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="border border-red-300 text-red-700 rounded-lg px-3 py-1.5 text-sm"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

function IntakePanels({ uid, flash, onDone }) {
  const [tab, setTab] = useState('') // '' | 'upload' | 'ai'
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '', keywords: '', subject: '_generic', prompt: '', file: null,
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function run() {
    setBusy(true)
    try {
      if (tab === 'upload') {
        await uploadBankPicture(form.file, {
          name: form.name, keywords: form.keywords,
          subject: form.subject, uid,
        })
        flash(`"${form.name}" uploaded and live.`)
      } else {
        await generateBankPicture({
          prompt: form.prompt, name: form.name, keywords: form.keywords,
          subject: form.subject, uid,
        })
        flash('AI picture generated and added to the bank.')
      }
      setForm({ name: '', keywords: '', subject: form.subject, prompt: '', file: null })
      setTab('')
      await onDone()
    } catch (err) {
      flash(`Failed: ${err?.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  const ready = form.name.trim() && form.keywords.trim() &&
    (tab === 'upload' ? Boolean(form.file) : form.prompt.trim())

  return (
    <section className="border border-gray-200 rounded-2xl p-4 bg-white">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab(tab === 'upload' ? '' : 'upload')}
          className={`rounded-lg px-4 py-2 text-sm font-bold border ${tab === 'upload' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700'}`}
        >
          ⬆️ Upload a picture
        </button>
        <button
          type="button"
          onClick={() => setTab(tab === 'ai' ? '' : 'ai')}
          className={`rounded-lg px-4 py-2 text-sm font-bold border ${tab === 'ai' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700'}`}
        >
          ✨ Generate with AI
        </button>
      </div>

      {tab && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tab === 'upload' ? (
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Image file (max 10 MB)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => set('file', e.target.files?.[0] || null)}
                className="text-sm"
              />
            </div>
          ) : (
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">Describe the picture</label>
              <textarea
                value={form.prompt}
                onChange={(e) => set('prompt', e.target.value)}
                rows={2}
                placeholder="e.g. Labelled diagram of the human ear showing earlobe, eardrum, middle ear and inner ear"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder='e.g. "Human ear, labelled"'
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              maxLength={120}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Keywords (comma-separated)</label>
            <input
              type="text"
              value={form.keywords}
              onChange={(e) => set('keywords', e.target.value)}
              placeholder="ear, hearing, senses"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Subject</label>
            <select
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={run}
              disabled={busy || !ready}
              className="bg-emerald-600 text-white rounded-lg px-5 py-2 text-sm font-bold disabled:opacity-50"
            >
              {busy ? (tab === 'ai' ? 'Generating…' : 'Uploading…') :
                (tab === 'ai' ? 'Generate & add' : 'Upload & add')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
