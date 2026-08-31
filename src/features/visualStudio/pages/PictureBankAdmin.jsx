// Picture Bank admin — curate the subject-organised teaching-figure
// library teachers search from the Assessment Studio. Three intake
// streams land here:
//   1. Staged extractions — images pulled out of sample papers uploaded
//      for assessment-format extraction; tag (name + keywords) or discard.
//   2. Direct uploads.
//   3. AI generation via the existing generateDiagram callable.

import { useCallback, useEffect, useMemo, useState } from 'react'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import { useAuth } from '../../../contexts/AuthContext'
import { TEACHER_SUBJECTS } from '../../../utils/teacherTools'
import {
  listBankPictures, activateBankPicture, deleteBankPicture,
  uploadBankPicture, generateBankPicture, warmPictureUrls,
  bulkUploadStagedPictures, nameStagedPictures,
} from '../../../utils/pictureBankService'
import { STARTER_PACK } from '../lib/pictureBankStarterPack'

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
  const [stagedBusy, setStagedBusy] = useState('') // '' | 'naming' | 'activating'

  const flash = useCallback((msg, ms = 5000) => {
    setToast(msg)
    if (ms > 0) setTimeout(() => setToast(''), ms)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await listBankPictures({})
    setPictures(rows)
    setLoading(false)
    // Resolve preview URLs best effort, capped concurrency (up to 500 rows
    // can come back — see warmPictureUrls for why this isn't one request
    // per row).
    warmPictureUrls(rows, (id, u) => setUrls((m) => (m[id] ? m : { ...m, [id]: u })))
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

  // Ask the AI naming agent to look at every staged image that hasn't been
  // named yet (no AI suggestion and still on a placeholder name).
  async function autoNameStaged(ids) {
    const list = ids && ids.length ? ids : staged.map((p) => p.id)
    if (!list.length) return
    setStagedBusy('naming')
    try {
      const res = await nameStagedPictures(list)
      const warn = (res?.warnings || []).length ?
        ` (${res.warnings.length} skipped)` : ''
      flash(`AI named ${res?.named || 0} of ${res?.total || list.length} picture(s)${warn}. Review and add to the bank.`, 8000)
      await load()
    } catch (err) {
      flash(`Auto-naming failed: ${err?.message || err}`)
    } finally {
      setStagedBusy('')
    }
  }

  // Bulk-activate every staged picture that already has a usable name +
  // keyword (AI suggestion or admin-entered). Ones still missing details are
  // left for manual tagging.
  async function addAllStaged() {
    const ready = staged
      .map((p) => {
        const name = (p.aiSuggestedName || '').trim()
        const keywords = Array.isArray(p.aiSuggestedKeywords) ? p.aiSuggestedKeywords : []
        const subject = p.aiSuggestedSubject || p.subject || '_generic'
        return { pic: p, name, keywords, subject }
      })
      .filter((r) => r.name && r.keywords.length)
    if (!ready.length) {
      flash('No staged pictures have an AI-suggested name yet — run “Auto-name” first, or tag them individually.', 7000)
      return
    }
    setStagedBusy('activating')
    let added = 0
    try {
      for (const r of ready) {
        try {
          await activateBankPicture(r.pic, {
            name: r.name, keywords: r.keywords,
            subject: r.subject, gradeBand: r.pic.gradeBand || '',
          })
          added += 1
        } catch (err) {
          console.warn('bulk activate failed', r.pic.id, err?.message)
        }
      }
      flash(`Added ${added} picture(s) to the bank — teachers can find them now.`, 8000)
      await load()
    } finally {
      setStagedBusy('')
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

      <StarterPackPanel pictures={pictures} uid={currentUser?.uid} flash={flash} onDone={load} />

      {loading ? (
        <p className="text-sm text-gray-500">Loading pictures…</p>
      ) : (
        <>
          {staged.length > 0 && (
            <section>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h2 className="text-lg font-black text-gray-900">
                  Needs tagging ({staged.length})
                </h2>
                <button
                  type="button"
                  onClick={() => autoNameStaged()}
                  disabled={Boolean(stagedBusy)}
                  className="rounded-lg px-3 py-1.5 text-sm font-bold bg-indigo-600 text-white disabled:opacity-50"
                >
                  {stagedBusy === 'naming' ? 'Naming…' : '✨ Auto-name all with AI'}
                </button>
                <button
                  type="button"
                  onClick={addAllStaged}
                  disabled={Boolean(stagedBusy)}
                  className="rounded-lg px-3 py-1.5 text-sm font-bold border border-emerald-300 text-emerald-700 disabled:opacity-50"
                >
                  {stagedBusy === 'activating' ? 'Adding…' : 'Add all named to bank'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3 max-w-3xl">
                Let the AI look at each image and suggest a name, keywords and
                subject — then review and add. Suggestions are editable; nothing
                goes live to teachers until you add it.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {staged.map((p) => (
                  <StagedCard
                    key={p.id}
                    pic={p}
                    url={urlFor(p)}
                    onActivate={onActivate}
                    onDiscard={() => setPendingDelete(p)}
                    onAutoName={() => autoNameStaged([p.id])}
                    naming={stagedBusy === 'naming'}
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
                      <img src={urlFor(p)} alt={p.name} loading="lazy" decoding="async"
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

function StagedCard({ pic, url, onActivate, onDiscard, onAutoName, naming }) {
  // Prefill from the AI suggestion when the agent has named this picture;
  // otherwise start blank (extracted images carry a placeholder name we don't
  // want to seed the field with).
  const [name, setName] = useState(pic.aiSuggestedName || '')
  const [keywords, setKeywords] = useState(
    Array.isArray(pic.aiSuggestedKeywords) ? pic.aiSuggestedKeywords.join(', ') : '',
  )
  const [subject, setSubject] = useState(pic.aiSuggestedSubject || pic.subject || '_generic')
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)

  // When the AI names this card (after a reload the same id is re-rendered),
  // adopt the suggestion unless the admin has already edited the fields.
  useEffect(() => {
    if (touched) return
    if (pic.aiSuggestedName) setName(pic.aiSuggestedName)
    if (Array.isArray(pic.aiSuggestedKeywords) && pic.aiSuggestedKeywords.length) {
      setKeywords(pic.aiSuggestedKeywords.join(', '))
    }
    if (pic.aiSuggestedSubject) setSubject(pic.aiSuggestedSubject)
  }, [pic.aiSuggestedName, pic.aiSuggestedSubject, pic.aiSuggestedKeywords, touched])

  async function activate() {
    setBusy(true)
    const ok = await onActivate(pic, { name, keywords, subject, gradeBand: pic.gradeBand || '' })
    if (!ok) setBusy(false)
  }

  return (
    <div className="border-2 border-dashed border-amber-300 rounded-xl p-3 bg-amber-50/40">
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-36 object-contain bg-white rounded-lg" />
      ) : (
        <div className="w-full h-36 bg-gray-100 rounded-lg" />
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-xs text-gray-500 truncate">
          From: {pic.sourceNote || 'sample paper'}
        </p>
        {onAutoName && (
          <button
            type="button"
            onClick={onAutoName}
            disabled={naming || busy}
            className="text-xs font-bold text-indigo-600 hover:underline disabled:opacity-50 shrink-0"
          >
            {naming ? '…' : '✨ Name'}
          </button>
        )}
      </div>
      {pic.aiSuggestedName && (
        <p className="text-[11px] text-indigo-600 mt-1">✨ AI-suggested — edit if needed</p>
      )}
      <input
        type="text"
        value={name}
        onChange={(e) => { setTouched(true); setName(e.target.value) }}
        placeholder='Name, e.g. "Human ear, labelled"'
        className="mt-2 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        maxLength={120}
      />
      <input
        type="text"
        value={keywords}
        onChange={(e) => { setTouched(true); setKeywords(e.target.value) }}
        placeholder="Keywords, comma-separated: ear, hearing, senses"
        className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
      />
      <select
        value={subject}
        onChange={(e) => { setTouched(true); setSubject(e.target.value) }}
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

// Batch-generates the curated starter figures (pictureBankStarterPack)
// that aren't in the bank yet, sequentially — each image costs money and
// shares a rate limit, and three consecutive failures abort the run so a
// provider outage doesn't burn the whole batch.
function StarterPackPanel({ pictures, uid, flash, onDone }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total, current }

  const missing = useMemo(() => {
    const have = new Set((pictures || []).map((p) => p.nameLower || String(p.name || '').toLowerCase()))
    return STARTER_PACK.filter((item) => !have.has(item.name.toLowerCase()))
  }, [pictures])

  async function run() {
    setRunning(true)
    let generated = 0
    let consecutiveFailures = 0
    try {
      for (let i = 0; i < missing.length; i++) {
        const item = missing[i]
        setProgress({ done: i, total: missing.length, current: item.name })
        try {
          await generateBankPicture({
            prompt: item.prompt,
            name: item.name,
            keywords: item.keywords,
            subject: item.subject,
            provider: item.provider,
            uid,
          })
          generated += 1
          consecutiveFailures = 0
        } catch (err) {
          consecutiveFailures += 1
          console.warn('starter pack item failed', item.name, err?.message)
          if (consecutiveFailures >= 3) {
            flash(`Stopped after repeated failures (${err?.message || 'generation error'}). ${generated} generated — run again later for the rest.`, 10000)
            return
          }
        }
      }
      flash(`Starter pack done — ${generated} picture(s) added and live for teachers.`, 10000)
    } finally {
      setRunning(false)
      setProgress(null)
      await onDone()
    }
  }

  if (missing.length === 0 && !running) {
    return (
      <section className="border border-gray-200 rounded-2xl p-4 bg-white text-sm text-gray-600">
        ✅ Starter pack complete — all {STARTER_PACK.length} core curriculum figures are in the bank.
      </section>
    )
  }

  return (
    <section className="border border-gray-200 rounded-2xl p-4 bg-white">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-base font-black text-gray-900 m-0">
            🎒 Starter pack — {missing.length} core figures missing
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Body systems, plant parts, the water cycle, Zambia's provinces,
            shapes, Venn templates, domestic animals and more — generated with
            AI, named and keyworded so teacher searches hit immediately.
            Roughly 4–6 US cents per image.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="bg-emerald-600 text-white rounded-lg px-5 py-2 text-sm font-bold disabled:opacity-50"
        >
          {running ? 'Generating…' : `Generate ${missing.length} missing`}
        </button>
      </div>
      {progress && (
        <div className="mt-3">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {progress.done}/{progress.total} · now drawing: {progress.current}
          </p>
        </div>
      )}
    </section>
  )
}

function IntakePanels({ uid, flash, onDone }) {
  const [tab, setTab] = useState('') // '' | 'upload' | 'bulk' | 'ai'
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
          onClick={() => setTab(tab === 'bulk' ? '' : 'bulk')}
          className={`rounded-lg px-4 py-2 text-sm font-bold border ${tab === 'bulk' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700'}`}
        >
          📦 Bulk upload + AI naming
        </button>
        <button
          type="button"
          onClick={() => setTab(tab === 'ai' ? '' : 'ai')}
          className={`rounded-lg px-4 py-2 text-sm font-bold border ${tab === 'ai' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700'}`}
        >
          ✨ Generate with AI
        </button>
      </div>

      {tab === 'bulk' && (
        <BulkUploadPanel uid={uid} flash={flash} onDone={onDone} onClose={() => setTab('')} />
      )}

      {(tab === 'upload' || tab === 'ai') && (
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

// Bulk upload — drop many images at once. They land as staged ("Needs
// tagging"); when "Auto-name with AI" is on, the vision agent then suggests a
// name + keywords + subject for each so teachers can search them, leaving the
// admin to review and add rather than type every caption by hand.
function BulkUploadPanel({ uid, flash, onDone, onClose }) {
  const [files, setFiles] = useState([])
  const [subject, setSubject] = useState('_generic')
  const [autoName, setAutoName] = useState(true)
  const [phase, setPhase] = useState('') // '' | 'uploading' | 'naming'
  const [progress, setProgress] = useState(null) // { done, total }

  async function run() {
    if (!files.length) return
    setPhase('uploading')
    setProgress({ done: 0, total: files.length })
    try {
      const { ids, failures } = await bulkUploadStagedPictures(files, {
        subject, uid,
        onProgress: (p) => setProgress(p),
      })
      let nameMsg = ''
      if (autoName && ids.length) {
        setPhase('naming')
        setProgress(null)
        try {
          const res = await nameStagedPictures(ids)
          nameMsg = ` AI named ${res?.named || 0} of ${ids.length}.`
        } catch (err) {
          nameMsg = ` (auto-naming failed: ${err?.message || err} — name them in “Needs tagging”.)`
        }
      }
      const failMsg = failures.length ? ` ${failures.length} failed.` : ''
      flash(`Uploaded ${ids.length} picture(s) to “Needs tagging”.${nameMsg}${failMsg} Review and add to the bank.`, 9000)
      setFiles([])
      onClose?.()
      await onDone()
    } catch (err) {
      flash(`Bulk upload failed: ${err?.message || err}`)
    } finally {
      setPhase('')
      setProgress(null)
    }
  }

  const busy = Boolean(phase)

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-gray-600 mb-1">
            Image files (select many — max 10 MB each)
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="text-sm"
            disabled={busy}
          />
          {files.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">{files.length} file(s) selected</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">
            Subject hint (applied to all)
          </label>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            disabled={busy}
          >
            {SUBJECT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoName}
              onChange={(e) => setAutoName(e.target.checked)}
              disabled={busy}
            />
            ✨ Auto-name with AI after upload
          </label>
        </div>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy || !files.length}
        className="bg-emerald-600 text-white rounded-lg px-5 py-2 text-sm font-bold disabled:opacity-50"
      >
        {phase === 'uploading' ? 'Uploading…' :
          phase === 'naming' ? 'AI naming…' :
            `Upload ${files.length || ''} & stage`}
      </button>
      {progress && (
        <div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Uploading {progress.done}/{progress.total}…
          </p>
        </div>
      )}
      {phase === 'naming' && (
        <p className="text-xs text-indigo-600">AI is naming your pictures — this can take a moment…</p>
      )}
    </div>
  )
}
