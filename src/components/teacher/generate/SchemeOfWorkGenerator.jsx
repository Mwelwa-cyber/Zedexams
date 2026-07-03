import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import {
  generateSchemeOfWork,
  TEACHER_LANGUAGES,
  SCHEME_TERMS,
  SCHEME_WEEK_COUNTS,
} from '../../../utils/teacherTools'
import { downloadSchemeOfWorkDocx } from '../../../utils/schemeOfWorkToDocx'
import { downloadSchemeOfWorkPdf } from '../../../utils/schemeOfWorkToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import SchemeOfWorkView from '../views/SchemeOfWorkView'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import {
  attachLibraryToGeneration,
  isFreePlanTeacher,
  listMyGenerations,
  titleForGeneration,
} from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import LiveGenerationCanvas from '../../ui/LiveGenerationCanvas'
import StudioCurriculumSelector from '../curriculum/StudioCurriculumSelector'
import { curriculumSeedFromProfile } from '../../../utils/teacherDefaults'
import { SOURCE_META } from '../views/SchemeOfWorkView'
import { FieldText, FieldTextarea, FieldSelect } from './studioFields'
import StudioOutputBoundary from '../StudioOutputBoundary'
import { useStudioInputDraft } from '../../../hooks/draft/useStudioInputDraft'
import { schemeInputDescriptor } from '../../../hooks/draft/descriptors'
import DraftStatusIndicator from '../../draft/DraftStatusIndicator'
import DraftRecoveryPrompt from '../../draft/DraftRecoveryPrompt'

export default function SchemeOfWorkGenerator() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const urlDefaults = useFormDefaultsFromUrl()
  // Selector seed: a deep-link handoff (?grade=…) wins; otherwise the
  // teacher's saved curriculum defaults (Teacher Settings → My Teaching).
  // Read once on mount by the selector — never re-seeds reactively.
  const [selectorSeed, setSelectorSeed] = useState(() =>
    urlDefaults && (urlDefaults.grade || urlDefaults.subject || urlDefaults.topic)
      ? urlDefaults
      : curriculumSeedFromProfile(userProfile),
  )
  const [selectorKey, setSelectorKey] = useState(0)
  const [form, setForm] = useState(() => ({
    term: 1,
    numberOfWeeks: 12,
    language: 'english',
    teacherName: userProfile?.displayName || userProfile?.fullName || '',
    school: userProfile?.school || userProfile?.schoolName || '',
    instructions: '',
    ...urlDefaults,
  }))
  // Standardized curriculum selection (CBC/Previous → grade → subject). `curr`
  // holds the latest payload, including the server-ready grade/subject/
  // curriculum/framework fields.
  const [curr, setCurr] = useState({})
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const isMounted = useIsMounted()
  const [scheme, setScheme] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [advisories, setAdvisories] = useState([])
  const [curriculumSource, setCurriculumSource] = useState('')
  // Live Generation Canvas hand-off (see WorksheetGenerator for the pattern).
  const [handedOff, setHandedOff] = useState(false)

  // Universal Draft Manager: auto-save the scheme-of-work inputs.
  const draft = useStudioInputDraft({
    descriptor: schemeInputDescriptor,
    uid: currentUser?.uid,
    form, setForm, curr, setCurr,
    onReseedSelector: (c) => { setSelectorSeed(c); setSelectorKey((k) => k + 1) },
  })

  // Teacher's saved Class Timetables — attaching one makes the scheme
  // timetable-aware (periods/week + teaching days for the chosen subject).
  const [timetables, setTimetables] = useState([])
  const [timetableId, setTimetableId] = useState('')

  useEffect(() => {
    let cancelled = false
    const uid = userProfile?.uid
    if (!uid) return undefined
    listMyGenerations({ uid, tool: 'class_timetable' })
      .then((rows) => { if (!cancelled) setTimetables(rows || []) })
      .catch(() => { if (!cancelled) setTimetables([]) })
    return () => { cancelled = true }
  }, [userProfile?.uid])

  // Surface the matching-grade timetables first so the obvious pick is on top.
  const timetableOptions = useMemo(() => {
    const opts = [{ value: '', label: 'None — pace by curriculum only' }]
    const sorted = [...timetables].sort((a, b) => {
      const am = a.inputs?.grade === curr.grade ? 0 : 1
      const bm = b.inputs?.grade === curr.grade ? 0 : 1
      return am - bm
    })
    for (const t of sorted) {
      const grade = t.inputs?.grade
      const mismatch = grade && grade !== curr.grade ? ` · ${grade}` : ''
      opts.push({ value: t.id, label: `${titleForGeneration(t)}${mismatch}` })
    }
    return opts
  }, [timetables, curr.grade])

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function selectedTimetablePayload() {
    if (!timetableId) return null
    const gen = timetables.find((t) => t.id === timetableId)
    const out = gen?.output
    if (!out || typeof out !== 'object') return null
    // Trim to the fields the server trusts (it sanitises again).
    return {
      header: out.header || {},
      days: out.days || [],
      subjects: out.subjects || [],
      slots: out.slots || {},
    }
  }

  function buildInputs() {
    return {
      ...form,
      grade: curr.grade,
      subject: curr.subject,
      curriculum: curr.curriculum,
      framework: curr.framework,
      timetable: selectedTimetablePayload(),
    }
  }

  async function regenerateSection(sectionId) {
    const res = await generateSchemeOfWork(buildInputs())
    if (res.ok && res.data?.schemeOfWork) {
      const fresh = res.data.schemeOfWork
      setScheme((prev) => (prev ? { ...prev, [sectionId]: fresh[sectionId] } : fresh))
      return fresh
    }
    return null
  }

  function saveToLibrary() {
    if (!generationId) return
    attachLibraryToGeneration(generationId, {
      libraryType: LIBRARY_TYPES.SCHEMES_OF_WORK,
      grade:       curr.grade,
      term:        form.term,
      subject:     curr.subject,
    }).catch((err) => console.error('[library attach]', err))
  }

  async function onGenerate(e) {
    e?.preventDefault?.()
    if (!curr.curriculumMode) {
      setErrorMessage('Please choose a curriculum.')
      setStatus('error')
      return
    }
    if (!curr.grade || !curr.subject) {
      setErrorMessage('Please select a class and subject.')
      setStatus('error')
      return
    }
    if (!ensureCanGenerate('scheme_of_work')) return
    setHandedOff(false)
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setAdvisories([])
    setCurriculumSource('')
    setScheme(null)

    const res = await generateSchemeOfWork(buildInputs())
    if (!isMounted.current) return
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error)
      return
    }
    setScheme(res.data.schemeOfWork)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setAdvisories(Array.isArray(res.data.advisories) ? res.data.advisories : [])
    setCurriculumSource(res.data.curriculumSource || '')
    setStatus('success')
    draft.clear().catch(() => {})

    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.SCHEMES_OF_WORK,
        grade:       curr.grade,
        term:        form.term,
        subject:     curr.subject,
      }).catch(() => { /* non-fatal — doc still readable via legacy path */ })
    }
  }

  function onExportDocx() {
    if (!scheme) return
    const name = buildDownloadName({
      docType: 'Scheme of Work',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      term: form.term,
    })
    downloadSchemeOfWorkDocx(scheme, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  function onExportPdf() {
    if (!scheme) return
    const name = buildDownloadName({
      docType: 'Scheme of Work',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      term: form.term,
      ext: 'pdf',
    })
    downloadSchemeOfWorkPdf(scheme, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  return (
    <div className="studio-page">
      <SeoHelmet title="Scheme of work" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Scheme of Work"
          title="Plan your whole term"
          subtitle="Week-by-week CBC pacing in the official 9-column format — competences, activities, expected standards, methods, and T/L aids in one printable doc."
          emoji="🦁"
        />

        <div className="space-y-6">
          <div className="max-w-2xl mx-auto w-full">
            <DraftRecoveryPrompt {...draft} label="scheme of work" />
          </div>
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 max-w-2xl mx-auto w-full"
          >
            <div className="flex justify-end">
              <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
            </div>
            <StudioCurriculumSelector
              key={selectorKey}
              value={selectorSeed}
              onChange={setCurr}
              showTopicSubtopic={false}
            />
            <FieldSelect
              label="Term"
              value={String(form.term)}
              options={SCHEME_TERMS.map((t) => ({ value: String(t.value), label: t.label }))}
              onChange={(v) => updateField('term', Number(v))}
            />
            <FieldSelect
              label="Number of weeks"
              value={String(form.numberOfWeeks)}
              options={SCHEME_WEEK_COUNTS.map((p) => ({ value: String(p.value), label: p.label }))}
              onChange={(v) => updateField('numberOfWeeks', Number(v))}
            />
            <div>
              <FieldSelect
                label="Class timetable (optional)"
                value={timetableId}
                options={timetableOptions}
                onChange={setTimetableId}
              />
              <p className="text-xs mt-1" style={{ color: '#566f76' }}>
                {timetables.length
                  ? 'Attach a saved timetable to pace the scheme around your real periods and teaching days.'
                  : 'No saved timetables yet — create one in the Class Timetable Studio to make schemes timetable-aware.'}
              </p>
            </div>
            <FieldSelect
              label="Language"
              value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => updateField('language', v)}
            />
            <FieldText
              label="School"
              placeholder="School name"
              value={form.school}
              onChange={(v) => updateField('school', v)}
              maxLength={120}
            />
            <FieldText
              label="Teacher name"
              placeholder="Mr / Mrs ..."
              value={form.teacherName}
              onChange={(v) => updateField('teacherName', v)}
              maxLength={80}
            />
            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder="e.g. Emphasise revision in the last two weeks. Include a mock exam in Week 11."
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)}
              maxLength={500}
            />

            <button
              type="submit"
              disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3"
            >
              {status === 'generating' ? 'Generating…' : '▶ Generate Scheme of Work'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} schemes used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          {handedOff && status === 'success' && scheme ? (
          <section className="studio-card p-5 min-h-[400px]">
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>Your Scheme of Work</h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      {scheme.header?.numberOfWeeks || scheme.weeks?.length} weeks · Term {scheme.header?.term}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={onExportDocx} className="studio-btn-ghost">
                      📄 Download .docx (landscape)
                    </button>
                    <button onClick={onExportPdf} className="studio-btn-ghost">
                      📄 Download .pdf
                    </button>
                    <button onClick={() => setStatus('idle')} className="studio-btn-primary">
                      ▶ Generate Another
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <AdvisoryPanel advisories={advisories} curriculumSource={curriculumSource} />
                <SchemeOfWorkView scheme={scheme} />
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved as generation <code>{generationId}</code>.
                  </div>
                )}
              </>
          </section>
          ) : (
            <LiveGenerationCanvas
              tool="scheme"
              status={status}
              result={scheme}
              docTitle={scheme?.header ? `Scheme of Work — Term ${scheme.header.term || ''}`.trim() : undefined}
              title="Mapping your scheme of work…"
              emptyState={<EmptyState />}
              errorMessage={errorMessage}
              savedToLibrary={Boolean(generationId)}
              onStop={() => setStatus('idle')}
              onRegenerate={() => onGenerate()}
              onRegenerateSection={regenerateSection}
              onSaveToLibrary={saveToLibrary}
              onContinueEditing={() => setHandedOff(true)}
              onRetry={() => setStatus('idle')}
              continueLabel="Continue to editing & export"
            />
          )}
          </StudioOutputBoundary>
        </div>
      </div>
    </div>
  )
}

/* ── Curriculum advisories + provenance ─────────────────────── */

function AdvisoryPanel({ advisories, curriculumSource }) {
  const list = Array.isArray(advisories) ? advisories : []
  const sourceMeta = SOURCE_META[curriculumSource]
  if (list.length === 0 && !sourceMeta) return null

  return (
    <div className="mb-5 space-y-2">
      {sourceMeta && (
        <div
          className="rounded-xl border px-4 py-2.5 text-sm flex items-center gap-2"
          style={{ background: '#f0f7f4', borderColor: '#bfe3d4', color: '#0e2a32' }}
        >
          <span>🧭</span>
          <span>
            Curriculum source:{' '}
            <strong style={{ color: sourceMeta.fg }}>{sourceMeta.label}</strong>
            {curriculumSource === 'ai_inferred' &&
              ' — no official outline was found, so general CBC knowledge was used.'}
            {curriculumSource === 'uploaded_module' &&
              ' — grounded on an uploaded module.'}
            {curriculumSource === 'syllabi_studio' &&
              ' — topics pulled from the official Syllabi Studio outline.'}
          </span>
        </div>
      )}
      {list.map((a, i) => {
        const warn = a.level === 'warning'
        return (
          <div
            key={`${a.code || 'adv'}-${i}`}
            className="rounded-xl border px-4 py-2.5 text-sm flex items-start gap-2"
            style={warn
              ? { background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' }
              : { background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }}
          >
            <span>{warn ? '⚠️' : 'ℹ️'}</span>
            <span>{a.message}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Input components (same as other generators) ────────────── */

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div style={{ width: 86, height: 86, borderRadius: '50%', background: '#faecb8', display: 'grid', placeItems: 'center', fontSize: 44 }}>
        🦁
      </div>
      <h3 className="studio-display mt-4" style={{ fontSize: 20 }}>Plan a whole term at once</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>
        Pick grade, subject, and term. You'll get a full week-by-week scheme of
        work — ready to print for your head teacher.
      </p>
    </div>
  )
}
