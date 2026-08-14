import { useCallback, useEffect, useMemo, useState } from 'react'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import SyllabusPdfUploadPanel from '../components/SyllabusPdfUploadPanel'
import BulkGenerateButton from '../components/BulkGenerateButton'
import BulkPublishQuizzesButton from '../components/BulkPublishQuizzesButton'
import ExamPaperLibraryPanel from '../components/ExamPaperLibraryPanel'
import {
  getActiveKbVersion, KB_VERSION,
  listCbcTopics, saveCbcTopic, deleteCbcTopic,
  subtopicName,
  ASSESSMENT_FORMAT_TYPES, ASSESSMENT_FORMAT_BANDS,
  listAssessmentFormats, saveAssessmentFormat, deleteAssessmentFormat,
  importBuiltInAssessmentFormats,
  uploadAssessmentFormatSample, extractAssessmentFormat,
  listAssessmentFormatDrafts, deleteAssessmentFormatDraft,
  approveAssessmentFormatDraft, listPastPapersForExtraction,
  analyzeExamPaper, listExamPaperSamples, deleteExamPaperSample,
  synthesizeAssessmentFormat,
} from '../../../utils/adminCbcKbService'
import { useAuth } from '../../../contexts/AuthContext'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import {
  getMergedSyllabi, saveSyllabusRow, removeSyllabusRow, restoreSyllabusRow,
  invalidateSyllabiCache,
} from '../../../utils/syllabusKbService'
import {
  STUDIO_SUBJECT_TO_KB, sheetNameToGrade,
  syllabiToKbTopics,
} from '../../../utils/syllabusMapping'
import {
  TEACHER_GRADES, TEACHER_SUBJECTS,
} from '../../../utils/teacherTools'
import { normalizeSubject } from '../../../config/curriculum.js'

// ── Visual constants (mirrors src/components/teacher/SyllabiLibrary.jsx) ──
// Subject metadata — long syllabi names get a short label, icon and the
// category they belong to. New entries fall back to a generic icon.

const META = {
  'Early Childhood Education Syllabi (3-5 Years)':       { icon: '🌱', cat: 'Early Childhood', short: 'Early Childhood Ed.' },
  'Lower Primary Syllabi (Grades 1-3)':                  { icon: '📚', cat: 'Lower Primary',   short: 'Lower Primary' },
  'Mathematics Syllabus (Grades 4-6)':                   { icon: '➗', cat: 'Upper Primary',   short: 'Mathematics (Gr. 4)' },
  'Science Syllabus (Grades 4-6)':                       { icon: '🔬', cat: 'Upper Primary',   short: 'Science (Gr. 4)' },
  'Social Studies Syllabus (Grades 4-6)':                { icon: '🌍', cat: 'Upper Primary',   short: 'Social Studies (Gr. 4)' },
  'Home Economics & Hospitality Syllabus (Grades 4-6)':  { icon: '🏠', cat: 'Upper Primary',   short: 'Home Economics (Gr. 4)' },
  'Technology Studies Syllabus (Grades 4-6)':            { icon: '⚙️', cat: 'Upper Primary',   short: 'Technology Studies (Gr. 4)' },
  'Mathematics Syllabus (Forms 1-4)':                    { icon: '📐', cat: 'Secondary',       short: 'Mathematics' },
  'Mathematics II Syllabus (Forms 1-4)':                 { icon: '📏', cat: 'Secondary',       short: 'Mathematics II' },
  'Physics Syllabus (Forms 1-4)':                        { icon: '⚡', cat: 'Secondary',       short: 'Physics' },
  'History Syllabus (Forms 1-4)':                        { icon: '🏛️', cat: 'Secondary',       short: 'History' },
  'Geography Syllabus (Forms 1-4)':                      { icon: '🗺️', cat: 'Secondary',       short: 'Geography' },
  'ICT Syllabus (Forms 1-4)':                            { icon: '💻', cat: 'Secondary',       short: 'ICT' },
  'Literature in English Syllabus (Forms 1-4)':          { icon: '📖', cat: 'Secondary',       short: 'Literature in English' },
  'Religious Education Syllabus (Forms 1-4)':            { icon: '✝️', cat: 'Secondary',       short: 'Religious Education' },
  'Physical Education Syllabus (Forms 1-4)':             { icon: '🏃', cat: 'Secondary',       short: 'Physical Education' },
  'Food & Nutrition Syllabus (Forms 1-4)':               { icon: '🥗', cat: 'Secondary',       short: 'Food & Nutrition' },
  'Fashion & Fabrics Syllabus (Forms 1-4)':              { icon: '🧵', cat: 'Secondary',       short: 'Fashion & Fabrics' },
  'Hospitality Management Syllabus (Forms 1-4)':         { icon: '🏨', cat: 'Secondary',       short: 'Hospitality Management' },
  'Travel & Tourism Syllabus (Forms 1-4)':               { icon: '✈️', cat: 'Secondary',       short: 'Travel & Tourism' },
}

const CAT_ORDER = ['Early Childhood', 'Lower Primary', 'Upper Primary', 'Secondary']
const CAT_LABELS = {
  'Early Childhood': 'ECE · Ages 3–5',
  'Lower Primary':   'Lower Primary · Grades 1–3',
  'Upper Primary':   'Upper Primary · Grades 4–6',
  'Secondary':       'Secondary · Forms 1–4',
}

const EDITABLE_COLUMNS = [
  'TOPIC',
  'SUB-TOPIC',
  'SPECIFIC COMPETENCES',
  'LEARNING ACTIVITIES',
  'EXPECTED STANDARD',
]

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text, q) {
  if (!q || !text) return text
  const re = new RegExp(escapeRegex(q), 'gi')
  const parts = []
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<mark key={`${m.index}-${parts.length}`}>{m[0]}</mark>)
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderCell(val, q) {
  if (!val) return null
  if (val.includes('\n')) {
    const lines = val.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length > 1) {
      return (
        <ul>
          {lines.map((line, i) => {
            const cleaned = line.replace(/^•\s*/, '')
            if (!cleaned) return null
            return <li key={i}>{highlight(cleaned, q)}</li>
          })}
        </ul>
      )
    }
    return highlight(lines[0] || '', q)
  }
  return highlight(val, q)
}

function enrichSubjects(rawData) {
  const enriched = {}
  for (const [subj, sheets] of Object.entries(rawData || {})) {
    const meta = META[subj] || { icon: '📄', cat: 'Other', short: subj.slice(0, 30) }
    enriched[subj] = { ...meta, sheets }
  }
  return enriched
}

function groupByCategory(data) {
  const grouped = {}
  for (const [subj, meta] of Object.entries(data || {})) {
    if (!grouped[meta.cat]) grouped[meta.cat] = []
    grouped[meta.cat].push([subj, meta])
  }
  return grouped
}

function countTopicsInSheet(sheet) {
  if (!sheet?.rows) return 0
  let count = 0
  for (const row of sheet.rows) {
    if (row.type === 'data' && row.cells?.TOPIC && row.cells.TOPIC.trim()) count++
  }
  return count
}

function countOverrides(rawData) {
  let inserted = 0
  let edited = 0
  for (const subj of Object.values(rawData || {})) {
    const sheets = subj?.sheets || subj
    for (const sheet of Object.values(sheets || {})) {
      for (const row of sheet?.rows || []) {
        if (row.__override?.kind === 'inserted') inserted++
        else if (row.__override?.kind === 'edited') edited++
      }
    }
  }
  return { inserted, edited }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CbcKbAdmin() {
  const { currentUser } = useAuth()
  const [rawData, setRawData] = useState(null)
  const [customTopics, setCustomTopics] = useState([])
  const [formatProfiles, setFormatProfiles] = useState([])
  const [editingFormat, setEditingFormat] = useState(null) // profile, or 'new'
  const [formatDrafts, setFormatDrafts] = useState([])
  const [reviewingDraft, setReviewingDraft] = useState(null) // draft doc under review
  const [examPaperSamples, setExamPaperSamples] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeVersion, setActiveVersion] = useState(null)

  const [query, setQuery] = useState('')
  const debouncedRawQuery = useDebouncedValue(query, 250)
  const debouncedQuery = debouncedRawQuery.trim()
  const [currentSubject, setCurrentSubject] = useState(null)
  const [currentSheet, setCurrentSheet] = useState(null)
  const [rowFilter, setRowFilter] = useState('')
  const [editing, setEditing] = useState(null) // { studioSubject, sheet, mode, original?, cells }
  const [editingCustom, setEditingCustom] = useState(null) // KB-shape topic, or 'new'
  const [toast, setToast] = useState('')
  // Delete awaiting ConfirmDialog approval —
  // { kind: 'row', payload } | { kind: 'custom', topic }.
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const flashToast = useCallback((msg, ms = 5000) => {
    setToast(msg)
    if (ms > 0) setTimeout(() => setToast(''), ms)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [merged, firestoreTopics, formats, drafts, samples] = await Promise.all([
        getMergedSyllabi({ forceOverrides: true }),
        listCbcTopics().catch(() => []),
        listAssessmentFormats().catch(() => []),
        listAssessmentFormatDrafts().catch(() => []),
        listExamPaperSamples().catch(() => []),
      ])
      setFormatProfiles(formats)
      setFormatDrafts(drafts)
      setExamPaperSamples(samples)
      setRawData(enrichSubjects(merged))
      // A Firestore topic is "custom" when it doesn't shadow an entry in
      // the syllabi-data layer. The merged-source rebuild already covers
      // shadowed cases (Firestore wins on collision in the AI's read
      // path), so the admin only needs to see what's *uniquely* in
      // Firestore — typically PDF-extracted rows + manual additions
      // that don't map to the official syllabi.
      const syllabiKeys = new Set()
      for (const t of syllabiToKbTopics(merged)) {
        syllabiKeys.add(`${String(t.grade).toUpperCase()}|${String(t.subject).toLowerCase()}|${String(t.topic).toLowerCase()}`)
      }
      const custom = (firestoreTopics || []).filter((t) => {
        const k = `${String(t.grade || '').toUpperCase()}|${String(t.subject || '').toLowerCase()}|${String(t.topic || '').toLowerCase()}`
        return !syllabiKeys.has(k)
      })
      setCustomTopics(custom)
    } catch (err) {
      setError(err?.message || 'Could not load curriculum data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let cancelled = false
    getActiveKbVersion()
      .then((v) => { if (!cancelled) setActiveVersion(v) })
      .catch(() => { /* fallback handled inside */ })
    return () => { cancelled = true }
  }, [])

  // Inject Playfair Display once — matches the SyllabiLibrary headings.
  useEffect(() => {
    const id = 'cbc-kb-admin-playfair'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&display=swap'
    document.head.appendChild(link)
  }, [])

  const view = debouncedQuery ? 'search' : (currentSubject ? 'subject' : 'home')

  function showHome() {
    setCurrentSubject(null)
    setCurrentSheet(null)
    setQuery('')
    setRowFilter('')
  }

  function showSubject(subj) {
    const sheetNames = Object.keys(rawData[subj].sheets)
    setCurrentSubject(subj)
    setCurrentSheet(sheetNames[0] || null)
    setRowFilter('')
    setQuery('')
  }

  function openEditRow(studioSubject, sheet, row) {
    const cells = row?.cells || {}
    setEditing({
      mode: 'update',
      studioSubject,
      sheet,
      original: {
        topic: String(cells.TOPIC || '').trim(),
        subtopic: String(cells['SUB-TOPIC'] || cells.SUBTOPIC || '').trim(),
      },
      cells: {
        TOPIC: cells.TOPIC || '',
        'SUB-TOPIC': cells['SUB-TOPIC'] || cells.SUBTOPIC || '',
        'SPECIFIC COMPETENCES': cells['SPECIFIC COMPETENCES'] || '',
        'LEARNING ACTIVITIES': cells['LEARNING ACTIVITIES'] || '',
        'EXPECTED STANDARD': cells['EXPECTED STANDARD'] || '',
      },
    })
  }

  function openAddRow(studioSubject, sheet, defaults = {}) {
    setEditing({
      mode: 'insert',
      studioSubject,
      sheet,
      original: { topic: '', subtopic: '' },
      cells: {
        TOPIC: defaults.TOPIC || '',
        'SUB-TOPIC': '',
        'SPECIFIC COMPETENCES': '',
        'LEARNING ACTIVITIES': '',
        'EXPECTED STANDARD': '',
      },
    })
  }

  async function onSaveRow(payload) {
    const res = await saveSyllabusRow(payload)
    if (!res.ok) { flashToast(`Save failed: ${res.error}`); return false }
    flashToast(payload.mode === 'insert' ?
      'Row added. AIs will see the new entry within ~60 seconds.' :
      'Row updated. AIs will see the change within ~60 seconds.')
    setEditing(null)
    await load()
    return true
  }

  function onDeleteRow(payload) {
    setPendingDelete({ kind: 'row', payload })
  }

  async function performDeleteRow(payload) {
    setDeleteBusy(true)
    try {
      const res = await removeSyllabusRow(payload)
      if (!res.ok) { flashToast(`Delete failed: ${res.error}`); return }
      flashToast('Row deleted. Use "View overrides" to restore.')
      await load()
    } finally {
      setDeleteBusy(false)
      setPendingDelete(null)
    }
  }

  async function onRestoreRow({ studioSubject, sheet, topic, subtopic }) {
    const res = await restoreSyllabusRow({ studioSubject, sheet, topic, subtopic })
    if (!res.ok) { flashToast(`Restore failed: ${res.error}`); return }
    flashToast('Override removed — base syllabus value restored.')
    await load()
  }

  async function onSaveCustomTopic(payload) {
    try {
      await saveCbcTopic(payload)
      flashToast(payload._editing ?
        'Topic updated. AIs will pick up the change within ~60 seconds.' :
        'Custom topic added.')
      setEditingCustom(null)
      await load()
      return true
    } catch (err) {
      flashToast(`Save failed: ${err?.message || err}`)
      return false
    }
  }

  function onDeleteCustomTopic(topic) {
    setPendingDelete({ kind: 'custom', topic })
  }

  async function onSaveFormatProfile(payload) {
    try {
      await saveAssessmentFormat(payload)
      flashToast(payload._editing ?
        'Format profile updated. The assessment generator picks it up within ~60 seconds.' :
        'Format profile added.')
      setEditingFormat(null)
      await load()
      return true
    } catch (err) {
      flashToast(`Save failed: ${err?.message || err}`)
      return false
    }
  }

  function onDeleteFormatProfile(profile) {
    setPendingDelete({ kind: 'format', profile })
  }

  async function performDeleteFormatProfile(profile) {
    setDeleteBusy(true)
    try {
      const ok = await deleteAssessmentFormat(profile.id)
      if (ok) {
        flashToast('Format profile deleted. The built-in seed for this combination (if any) applies again.')
        await load()
      } else {
        flashToast('Delete failed — check console.')
      }
    } finally {
      setDeleteBusy(false)
      setPendingDelete(null)
    }
  }

  async function onImportBuiltInFormats() {
    const res = await importBuiltInAssessmentFormats()
    if (!res.ok) { flashToast(`Import failed: ${res.error}`); return }
    flashToast(`Imported ${res.written} built-in format profiles into ${res.kbVersion}.`)
    await load()
  }

  // Extract a format-profile draft from a sample paper. `intake` is
  // { file? , paperId?, assessmentType, gradeBand, subject }.
  async function onExtractFormat(intake) {
    try {
      let storagePath = null
      if (intake.file) {
        flashToast('Uploading sample paper…', 0)
        storagePath = await uploadAssessmentFormatSample(intake.file, currentUser?.uid)
      }
      flashToast('Reading the paper and distilling its format — this can take a minute…', 0)
      const res = await extractAssessmentFormat({
        storagePath,
        paperId: intake.paperId || null,
        assessmentType: intake.assessmentType,
        gradeBand: intake.gradeBand,
        subject: intake.subject,
      })
      if (!res.ok) { flashToast(`Extraction failed: ${res.error}`); return false }
      flashToast(res.warning ?
        `Draft created — ${res.warning}` :
        'Draft created. Review it under "Pending review" below.', 10000)
      await load()
      return true
    } catch (err) {
      flashToast(`Extraction failed: ${err?.message || err}`)
      return false
    }
  }

  async function onApproveDraft(payload) {
    try {
      await approveAssessmentFormatDraft({
        ...payload,
        origin: reviewingDraft?.origin,
        draftId: reviewingDraft?.draftId,
      })
      flashToast('Format profile approved and live. The generator picks it up within ~60 seconds.')
      setReviewingDraft(null)
      await load()
      return true
    } catch (err) {
      flashToast(`Approve failed: ${err?.message || err}`)
      return false
    }
  }

  function onRejectDraft(draft) {
    setPendingDelete({ kind: 'draft', draft })
  }

  async function performRejectDraft(draft) {
    setDeleteBusy(true)
    try {
      const ok = await deleteAssessmentFormatDraft(draft.draftId)
      flashToast(ok ? 'Draft rejected.' : 'Reject failed — check console.')
      if (ok) await load()
    } finally {
      setDeleteBusy(false)
      setPendingDelete(null)
    }
  }

  // ── Exam Paper Library ────────────────────────────────────────────────
  // Upload + analyse a batch of real papers (shared classification), then
  // synthesise a bucket into a format-profile draft for the existing review
  // flow. `batch` is { files[], grade, subject, assessmentType, year, region }.
  async function onAnalyzeExamPapers(batch) {
    const files = Array.isArray(batch.files) ? batch.files : []
    if (files.length === 0) return false
    // Each paper is dominated by a ~30s Claude read, so analysing them strictly
    // one-by-one made big batches painfully slow. Run a small fixed-size pool of
    // workers instead — same total work, ~PAPER_CONCURRENCY× less wall-clock time,
    // without hammering the API. One paper failing never stops the others.
    const PAPER_CONCURRENCY = 3
    let analyzed = 0
    let done = 0
    const errors = []

    async function analyzeOne(file) {
      try {
        const storagePath = await uploadAssessmentFormatSample(file, currentUser?.uid)
        const res = await analyzeExamPaper({
          storagePath,
          grade: batch.grade,
          subject: batch.subject,
          assessmentType: batch.assessmentType,
          title: file.name,
          year: batch.year ? Number(batch.year) : null,
          region: batch.region || '',
        })
        if (res.ok) analyzed += 1
        else errors.push(`${file.name}: ${res.error}`)
      } catch (err) {
        errors.push(`${file.name}: ${err?.message || err}`)
      } finally {
        done += 1
        flashToast(`Analysing papers… ${done} of ${files.length} done`, 0)
      }
    }

    flashToast(`Analysing ${files.length} paper${files.length === 1 ? '' : 's'}…`, 0)
    let cursor = 0
    async function worker() {
      while (cursor < files.length) {
        const idx = cursor++
        await analyzeOne(files[idx])
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PAPER_CONCURRENCY, files.length) }, () => worker()),
    )
    await load()
    if (errors.length === 0) {
      flashToast(`Analysed ${analyzed} paper${analyzed === 1 ? '' : 's'} into the library.`, 8000)
      return true
    }
    flashToast(`Analysed ${analyzed} of ${files.length}. ${errors.length} failed: ${errors[0]}`, 12000)
    return analyzed > 0
  }

  async function onDeleteExamPaperSample(sample) {
    const ok = await deleteExamPaperSample(sample.id)
    flashToast(ok ? 'Paper removed from the library.' : 'Delete failed — check console.')
    if (ok) await load()
  }

  async function onSynthesizeFormat({ assessmentType, gradeBand, subject }) {
    flashToast('Merging the analysed papers into one format profile…', 0)
    const res = await synthesizeAssessmentFormat({ assessmentType, gradeBand, subject })
    if (!res.ok) { flashToast(`Synthesis failed: ${res.error}`); return false }
    flashToast(res.warning ?
      `Draft created from ${res.sampleCount} paper(s) — ${res.warning}` :
      `Draft created from ${res.sampleCount} paper(s). Review it under "Pending review" in Assessment Formats.`, 12000)
    await load()
    return true
  }

  async function performDeleteCustomTopic(topic) {
    setDeleteBusy(true)
    try {
      const ok = await deleteCbcTopic(topic.id)
      if (ok) {
        flashToast('Topic deleted.')
        await load()
      } else {
        flashToast('Delete failed — check console.')
      }
    } finally {
      setDeleteBusy(false)
      setPendingDelete(null)
    }
  }

  const grouped = useMemo(() => (rawData ? groupByCategory(rawData) : {}), [rawData])

  const stats = useMemo(() => {
    if (!rawData) return { subjects: 0, levels: 0, topics: 0 }
    let levels = 0
    let topics = 0
    for (const meta of Object.values(rawData)) {
      const sheetList = Object.values(meta.sheets)
      levels += sheetList.length
      for (const sh of sheetList) topics += countTopicsInSheet(sh)
    }
    return { subjects: Object.keys(rawData).length, levels, topics }
  }, [rawData])

  const overrideCounts = useMemo(() => countOverrides(rawData), [rawData])

  const searchResults = useMemo(() => {
    if (!rawData || !debouncedQuery) return []
    const lq = debouncedQuery.toLowerCase()
    const results = []
    outer:
    for (const [subj, meta] of Object.entries(rawData)) {
      for (const [sheetName, sheet] of Object.entries(meta.sheets)) {
        let count = 0
        for (const row of sheet.rows) {
          if (row.type !== 'data') continue
          if (Object.values(row.cells).some(c => c && c.toLowerCase().includes(lq))) count++
        }
        if (count > 0) {
          results.push({ subj, sheetName, count, icon: meta.icon, short: meta.short, cat: meta.cat })
          if (results.length >= 60) break outer
        }
      }
    }
    return results
  }, [rawData, debouncedQuery])

  const isCustomVersion = activeVersion && activeVersion !== KB_VERSION

  return (
    <section className="ss-root" data-view={view}>
      <SeoHelmet title="CBC Knowledge Base" noIndex />
      <SyllabiStudioStyles />

      <div className="ss-header">
        <div className="ss-logo-mark" aria-hidden>📘</div>
        <div className="ss-logo-text-wrap">
          <div className="ss-logo-text">CBC Knowledge Base</div>
          <div className="ss-logo-sub">
            Admin editor · grounds every AI generator
            {activeVersion && (
              <>
                {' '}· <code className={`ss-version-pill ${isCustomVersion ? 'is-custom' : ''}`}>{activeVersion}</code>
                {isCustomVersion ? ' active' : ' seed'}
              </>
            )}
          </div>
        </div>
        <div className="ss-spacer" />
        <label className="ss-search-wrap">
          <span className="sr-only">Search topics or competences</span>
          <input
            type="text"
            className="ss-search-box"
            placeholder="Search topics, competences…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            disabled={!rawData}
          />
        </label>
      </div>

      {toast && (
        <div className="ss-toast">{toast}</div>
      )}

      <div className="ss-layout">
        <Sidebar
          data={rawData}
          grouped={grouped}
          currentSubject={currentSubject}
          onSelectSubject={showSubject}
          onHome={showHome}
        />

        <main className="ss-main">
          {loading && (
            <div className="ss-loading">
              <div className="ss-loading-dot" />
              <p>Loading curriculum data…</p>
            </div>
          )}

          {!loading && error && (
            <div className="ss-error">
              <p className="ss-error-title">Could not load curriculum data</p>
              <p className="ss-error-detail">{error}</p>
            </div>
          )}

          {!loading && !error && view === 'home' && rawData && (
            <HomeView
              stats={stats}
              grouped={grouped}
              overrideCounts={overrideCounts}
              customTopics={customTopics}
              onSelectSubject={showSubject}
              onLoaded={load}
              flashToast={flashToast}
              onEditCustomTopic={(t) => setEditingCustom(t)}
              onAddCustomTopic={() => setEditingCustom('new')}
              onDeleteCustomTopic={onDeleteCustomTopic}
              formatProfiles={formatProfiles}
              onAddFormat={() => setEditingFormat('new')}
              onEditFormat={(p) => setEditingFormat(p)}
              onDeleteFormat={onDeleteFormatProfile}
              onImportFormats={onImportBuiltInFormats}
              formatDrafts={formatDrafts}
              onExtractFormat={onExtractFormat}
              onReviewDraft={(d) => setReviewingDraft(d)}
              onRejectDraft={onRejectDraft}
              examPaperSamples={examPaperSamples}
              onAnalyzeExamPapers={onAnalyzeExamPapers}
              onDeleteExamPaperSample={onDeleteExamPaperSample}
              onSynthesizeFormat={onSynthesizeFormat}
            />
          )}

          {!loading && !error && view === 'subject' && currentSubject && rawData && (
            <SubjectDetail
              studioSubject={currentSubject}
              meta={rawData[currentSubject]}
              currentSheet={currentSheet}
              onSelectSheet={setCurrentSheet}
              rowFilter={rowFilter}
              onRowFilter={setRowFilter}
              onBack={showHome}
              onEditRow={openEditRow}
              onAddRow={openAddRow}
              onDeleteRow={onDeleteRow}
              onRestoreRow={onRestoreRow}
            />
          )}

          {!loading && !error && view === 'search' && (
            <SearchResults
              query={debouncedQuery}
              results={searchResults}
              onOpenResult={(subj, sheetName) => {
                setQuery('')
                setCurrentSubject(subj)
                setCurrentSheet(sheetName)
                setRowFilter(debouncedQuery)
              }}
            />
          )}
        </main>
      </div>

      {editing && (
        <EditRowModal
          editing={editing}
          onCancel={() => setEditing(null)}
          onSave={onSaveRow}
        />
      )}

      {editingCustom && (
        <CustomTopicModal
          topic={editingCustom === 'new' ? null : editingCustom}
          onCancel={() => setEditingCustom(null)}
          onSave={onSaveCustomTopic}
        />
      )}

      {editingFormat && (
        <FormatProfileModal
          profile={editingFormat === 'new' ? null : editingFormat}
          onCancel={() => setEditingFormat(null)}
          onSave={onSaveFormatProfile}
        />
      )}

      {reviewingDraft && (
        <FormatProfileModal
          profile={reviewingDraft}
          reviewing
          onCancel={() => setReviewingDraft(null)}
          onSave={onApproveDraft}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.kind === 'row' ? 'Delete this row?' :
          pendingDelete?.kind === 'format' ? 'Delete this format profile?' :
            pendingDelete?.kind === 'draft' ? 'Reject this draft?' :
              'Delete this custom topic?'}
        message={pendingDelete?.kind === 'row' ? (
          <>
            <p>Topic: <strong className="theme-text">{pendingDelete?.payload?.topic || '—'}</strong></p>
            <p>Sub-topic: <strong className="theme-text">{pendingDelete?.payload?.subtopic || '—'}</strong></p>
            <p className="mt-2">It will be hidden from teachers and the AI generators.</p>
          </>
        ) : pendingDelete?.kind === 'format' ? (
          <>You're about to delete <strong className="theme-text">"{pendingDelete?.profile?.label}"</strong>. The built-in seed for this combination (if any) applies again.</>
        ) : pendingDelete?.kind === 'draft' ? (
          <>You're about to reject the extracted draft <strong className="theme-text">"{pendingDelete?.draft?.label}"</strong>. Nothing was published; this just discards it.</>
        ) : (
          <>You're about to delete <strong className="theme-text">"{pendingDelete?.topic?.topic}"</strong> ({pendingDelete?.topic?.grade} {pendingDelete?.topic?.subject}).</>
        )}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteBusy}
        onConfirm={() => {
          if (!pendingDelete) return
          if (pendingDelete.kind === 'row') performDeleteRow(pendingDelete.payload)
          else if (pendingDelete.kind === 'format') performDeleteFormatProfile(pendingDelete.profile)
          else if (pendingDelete.kind === 'draft') performRejectDraft(pendingDelete.draft)
          else performDeleteCustomTopic(pendingDelete.topic)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────

function Sidebar({ data, grouped, currentSubject, onSelectSubject, onHome }) {
  if (!data) {
    return (
      <nav className="ss-sidebar" aria-label="Subjects">
        <div className="ss-sidebar-placeholder">Loading subjects…</div>
      </nav>
    )
  }
  return (
    <nav className="ss-sidebar" aria-label="Subjects">
      <button
        type="button"
        className={`ss-nav-item ss-home-item ${!currentSubject ? 'is-active' : ''}`}
        onClick={onHome}
      >
        <span className="ss-nav-icon" aria-hidden>🏠</span>
        <span className="ss-nav-text">Home</span>
      </button>
      {CAT_ORDER.map(cat => {
        const list = grouped[cat]
        if (!list || list.length === 0) return null
        return (
          <div key={cat} className="ss-sb-group">
            <div className="ss-sb-label">{cat.toUpperCase()}</div>
            {list.map(([subj, meta]) => (
              <button
                key={subj}
                type="button"
                className={`ss-nav-item ${currentSubject === subj ? 'is-active' : ''}`}
                onClick={() => onSelectSubject(subj)}
              >
                <span className="ss-nav-icon" aria-hidden>{meta.icon}</span>
                <span className="ss-nav-text">{meta.short}</span>
              </button>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

// ── Home view ────────────────────────────────────────────────────────────

function HomeView({
  stats, grouped, overrideCounts, customTopics,
  onSelectSubject, onLoaded, flashToast,
  onEditCustomTopic, onAddCustomTopic, onDeleteCustomTopic,
  formatProfiles, onAddFormat, onEditFormat, onDeleteFormat, onImportFormats,
  formatDrafts, onExtractFormat, onReviewDraft, onRejectDraft,
  examPaperSamples, onAnalyzeExamPapers, onDeleteExamPaperSample,
  onSynthesizeFormat,
}) {
  return (
    <div className="ss-home">
      <section className="ss-hero" aria-label="Editor overview">
        <div className="ss-hero-text">
          <div className="ss-hero-label">✦ CBC KNOWLEDGE BASE</div>
          <h1 className="ss-hero-title">Zambian National<br />Curriculum</h1>
          <p className="ss-hero-blurb">
            Edit any row of the syllabus.<br />
            Every AI generator (lesson plans, quizzes, worksheets, notes,
            schemes of work) reads from this source within ~60 seconds.
          </p>
        </div>
        <div className="ss-hero-emoji" aria-hidden>📘</div>
      </section>

      <div className="ss-stats-row">
        <StatCard value={stats.subjects} label="Subjects" />
        <StatCard value={stats.levels}   label="Grade/Form Levels" />
        <StatCard value={stats.topics}   label="Topics" />
        <StatCard
          value={overrideCounts.inserted + overrideCounts.edited}
          label={`Admin edits (${overrideCounts.edited} edited · ${overrideCounts.inserted} added)`}
        />
      </div>

      {/* Syllabus PDF upload — extracts topics with Claude and stages
          them in the topic-shape KB (separate from row-level overrides). */}
      <div className="ss-pdf-upload-wrap">
        <SyllabusPdfUploadPanel onComplete={() => {
          invalidateSyllabiCache()
          onLoaded()
          flashToast('PDF processed — find new entries under "Admin-added topics" below.', 8000)
        }} />
      </div>

      <CustomTopicsPanel
        topics={customTopics}
        onAdd={onAddCustomTopic}
        onEdit={onEditCustomTopic}
        onDelete={onDeleteCustomTopic}
      />

      <AssessmentFormatsPanel
        profiles={formatProfiles}
        onAdd={onAddFormat}
        onEdit={onEditFormat}
        onDelete={onDeleteFormat}
        onImport={onImportFormats}
        drafts={formatDrafts}
        onExtract={onExtractFormat}
        onReviewDraft={onReviewDraft}
        onRejectDraft={onRejectDraft}
      />

      <ExamPaperLibraryPanel
        samples={examPaperSamples}
        profiles={formatProfiles}
        drafts={formatDrafts}
        onAnalyzeBatch={onAnalyzeExamPapers}
        onDelete={onDeleteExamPaperSample}
        onSynthesize={onSynthesizeFormat}
      />

      {CAT_ORDER.map(cat => {
        const list = grouped[cat]
        if (!list || list.length === 0) return null
        return (
          <section key={cat} className="ss-cat-section">
            <div className="ss-section-heading">
              <span className="ss-sh-dash">{cat.toUpperCase()}</span>
              <h2 className="ss-sh-title">{CAT_LABELS[cat] || cat}</h2>
            </div>
            <div className="ss-cards-grid">
              {list.map(([subj, meta]) => {
                const sheetCount = Object.keys(meta.sheets).length
                let topicCount = 0
                for (const sh of Object.values(meta.sheets)) topicCount += countTopicsInSheet(sh)
                return (
                  <button
                    key={subj}
                    type="button"
                    className="ss-subj-card"
                    onClick={() => onSelectSubject(subj)}
                  >
                    <span className="ss-card-badge">
                      {sheetCount} level{sheetCount > 1 ? 's' : ''}
                    </span>
                    <div className="ss-card-icon-wrap" aria-hidden>{meta.icon}</div>
                    <div className="ss-card-name">{meta.short}</div>
                    <div className="ss-card-meta">{topicCount} topics</div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function StatCard({ value, label }) {
  return (
    <div className="ss-stat-card">
      <div className="ss-stat-num">{value === 0 ? '—' : value}</div>
      <div className="ss-stat-lbl">{label}</div>
    </div>
  )
}

// ── Custom (Firestore-only) topics panel ────────────────────────────────
// Surfaces topics in cbcKnowledgeBase/{version}/topics/* that don't shadow
// any entry in curriculum-data.json. These are the PDF-extracted rows + any
// manually added topics — they ground the AI but were previously invisible
// in the new browsable layout.

function CustomTopicsPanel({ topics, onAdd, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const grouped = useMemo(() => {
    const byGrade = new Map()
    for (const t of topics || []) {
      const g = String(t.grade || '?').toUpperCase()
      if (!byGrade.has(g)) byGrade.set(g, [])
      byGrade.get(g).push(t)
    }
    return Array.from(byGrade.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([grade, list]) => [grade, list.sort((x, y) => String(x.subject).localeCompare(String(y.subject)))])
  }, [topics])

  const total = (topics || []).length
  const open = expanded || total > 0

  return (
    <section className="ss-custom-panel" aria-label="Admin-added topics">
      <div className="ss-custom-head">
        <div>
          <div className="ss-sh-dash">ADMIN-ADDED TOPICS</div>
          <h2 className="ss-sh-title">
            Custom topics
            {total > 0 && <span className="ss-custom-count">{total}</span>}
          </h2>
          <p className="ss-custom-blurb">
            Topics added through PDF upload, manual entry, or imports that
            don't shadow the official syllabi. They ground the AI alongside
            the syllabi above.
          </p>
        </div>
        <div className="ss-custom-actions">
          <button type="button" className="ss-add-row-btn" onClick={onAdd}>
            + Add custom topic
          </button>
          {total > 0 && (
            <button
              type="button"
              className="ss-tab-btn"
              onClick={() => setExpanded((v) => !v)}
            >
              {open && expanded ? 'Collapse' : 'Show all'}
            </button>
          )}
        </div>
      </div>

      {total === 0 && (
        <p className="ss-custom-empty">
          No custom topics yet. Use the PDF upload above, or click
          <strong> + Add custom topic</strong> to add one manually.
        </p>
      )}

      {total > 0 && expanded && (
        <div className="ss-custom-grid">
          {grouped.map(([grade, list]) => (
            <div key={grade} className="ss-custom-grade-block">
              <div className="ss-custom-grade-label">{grade}</div>
              {list.map((t) => (
                <div key={t.id} className="ss-custom-card">
                  <div className="ss-custom-card-meta">
                    {formatSubject(t.subject)}
                  </div>
                  <div className="ss-custom-card-title">{t.topic}</div>
                  {Array.isArray(t.subtopics) && t.subtopics.length > 0 && (
                    <div className="ss-custom-card-subs">
                      {t.subtopics.slice(0, 3).map(subtopicName).filter(Boolean).join(' · ')}
                      {t.subtopics.length > 3 && ` · +${t.subtopics.length - 3} more`}
                    </div>
                  )}
                  <div className="ss-custom-card-actions">
                    <button
                      type="button"
                      className="ss-row-btn ss-row-edit"
                      onClick={() => onEdit(t)}
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      className="ss-row-btn ss-row-delete"
                      onClick={() => onDelete(t)}
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Assessment format profiles panel ────────────────────────────────────
// Zambian paper-format conventions (sections, instruction wording,
// numbering, marks patterns, paraphrased exemplars) that ground the
// My Assessment generator. Built-in seeds always apply; Firestore docs
// shown here override the seed with the same id.

const FORMAT_TYPE_LABELS = Object.fromEntries(
  ASSESSMENT_FORMAT_TYPES.map((t) => [t.value, t.label]),
)
const FORMAT_BAND_LABELS = Object.fromEntries(
  ASSESSMENT_FORMAT_BANDS.map((b) => [b.value, b.label]),
)

// Where a profile's house style came from. Surfaced as a badge on each card
// so an admin can tell at a glance whether the generator is grounded on a
// hand-written profile, the built-in seed corpus, a one-off extracted sample,
// or — the green one — a profile distilled from real uploaded papers in the
// Exam Paper Library. `origin` is set server-side (assessmentFormats.js) and
// survives draft approval (saveAssessmentFormat).
const FORMAT_ORIGIN_BADGES = {
  builtin_seed: { label: 'Built-in seed', bg: '#eef2f7', fg: '#475569' },
  manual: { label: 'Manual', bg: '#eef2f7', fg: '#475569' },
  pdf_extract: { label: 'From sample paper', bg: '#fef6e7', fg: '#92600a' },
  docx_extract: { label: 'From sample paper', bg: '#fef6e7', fg: '#92600a' },
  library_synthesis: { label: '✦ From paper library', bg: '#e7f6ee', fg: '#13683b' },
}

function FormatOriginBadge({ origin, sourceNote }) {
  const meta = FORMAT_ORIGIN_BADGES[origin] || FORMAT_ORIGIN_BADGES.manual
  return (
    <span
      title={sourceNote || undefined}
      style={{
        display: 'inline-block', fontSize: 11, fontWeight: 600,
        padding: '1px 8px', borderRadius: 999,
        background: meta.bg, color: meta.fg,
      }}
    >
      {meta.label}
    </span>
  )
}

function AssessmentFormatsPanel({
  profiles, onAdd, onEdit, onDelete, onImport,
  drafts, onExtract, onReviewDraft, onRejectDraft,
}) {
  const [expanded, setExpanded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showIntake, setShowIntake] = useState(false)
  const grouped = useMemo(() => {
    const byType = new Map()
    for (const p of profiles || []) {
      const t = String(p.assessmentType || '?')
      if (!byType.has(t)) byType.set(t, [])
      byType.get(t).push(p)
    }
    return ASSESSMENT_FORMAT_TYPES
      .map((t) => [t.value, (byType.get(t.value) || []).sort(
        (a, b) => String(a.id).localeCompare(String(b.id)),
      )])
      .filter(([, list]) => list.length > 0)
  }, [profiles])

  const total = (profiles || []).length

  async function runImport() {
    setImporting(true)
    try { await onImport() } finally { setImporting(false) }
  }

  return (
    <section className="ss-custom-panel" aria-label="Assessment format profiles">
      <div className="ss-custom-head">
        <div>
          <div className="ss-sh-dash">ZAMBIAN ASSESSMENT FORMATS</div>
          <h2 className="ss-sh-title">
            Assessment format profiles
            {total > 0 && <span className="ss-custom-count">{total}</span>}
          </h2>
          <p className="ss-custom-blurb">
            How Zambian papers look: sections, instruction wording, numbering,
            marks patterns and paraphrased exemplar questions. The My Assessment
            generator follows the matching profile (assessment type + grade band
            + subject). Built-in profiles ship with the code; rows here override
            them — never paste questions from a real ECZ paper.
          </p>
        </div>
        <div className="ss-custom-actions">
          <button type="button" className="ss-add-row-btn" onClick={onAdd}>
            + Add format profile
          </button>
          <button
            type="button"
            className="ss-tab-btn"
            onClick={() => setShowIntake((v) => !v)}
          >
            {showIntake ? 'Hide extraction' : 'Extract from a sample paper'}
          </button>
          <button
            type="button"
            className="ss-tab-btn"
            onClick={runImport}
            disabled={importing}
          >
            {importing ? 'Importing…' : 'Import built-in formats'}
          </button>
          <a href="/admin/picture-bank" className="ss-tab-btn">
            🖼 Picture bank
          </a>
          {total > 0 && (
            <button
              type="button"
              className="ss-tab-btn"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Collapse' : 'Show all'}
            </button>
          )}
        </div>
      </div>

      {showIntake && <FormatExtractIntake onExtract={onExtract} />}

      {(drafts || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="ss-custom-grade-label">
            PENDING REVIEW ({drafts.length})
          </div>
          <div className="ss-custom-grid">
            {drafts.map((d) => (
              <div key={d.draftId} className="ss-custom-card">
                <div className="ss-custom-card-meta">
                  {(FORMAT_TYPE_LABELS[d.assessmentType] || d.assessmentType)}
                  {' · '}
                  {(FORMAT_BAND_LABELS[d.gradeBand] || d.gradeBand)}
                  {' · '}
                  {d.subject === '_generic' ? 'All subjects' : formatSubject(d.subject)}
                </div>
                <div className="ss-custom-card-title">{d.label || '(untitled draft)'}</div>
                <div className="ss-custom-card-subs">
                  {d.origin === 'library_synthesis' ?
                    `Synthesised from ${d.synthesizedFromCount || (d.synthesizedFromIds || []).length || 'several'} real papers.` :
                    `Extracted from ${d.sourceNote || d.sourceKind || 'a sample paper'}.`}
                  {Array.isArray(d.validationErrors) && d.validationErrors.length > 0 && (
                    <span style={{ color: '#b91c1c' }}>
                      {' '}Needs fixes: {d.validationErrors.join('; ')}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 4 }}>
                  <FormatOriginBadge origin={d.origin} />
                </div>
                <div className="ss-custom-card-actions">
                  <button
                    type="button"
                    className="ss-row-btn ss-row-edit"
                    onClick={() => onReviewDraft(d)}
                  >
                    review
                  </button>
                  <button
                    type="button"
                    className="ss-row-btn ss-row-delete"
                    onClick={() => onRejectDraft(d)}
                  >
                    reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {total === 0 && (
        <p className="ss-custom-empty">
          No Firestore overrides yet — the generator is using the built-in
          seed profiles. Click <strong>Import built-in formats</strong> to copy
          them here and make them editable, or add a profile manually.
        </p>
      )}

      {total > 0 && expanded && (
        <div className="ss-custom-grid">
          {grouped.map(([type, list]) => (
            <div key={type} className="ss-custom-grade-block">
              <div className="ss-custom-grade-label">
                {FORMAT_TYPE_LABELS[type] || type}
              </div>
              {list.map((p) => (
                <div key={p.id} className="ss-custom-card">
                  <div className="ss-custom-card-meta">
                    {(FORMAT_BAND_LABELS[p.gradeBand] || p.gradeBand)}
                    {' · '}
                    {p.subject === '_generic' ? 'All subjects' : formatSubject(p.subject)}
                  </div>
                  <div className="ss-custom-card-title">{p.label}</div>
                  <div className="ss-custom-card-subs">
                    {(p.paperStructure || []).map((s) => s.name).filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <FormatOriginBadge origin={p.origin} sourceNote={p.sourceNote} />
                  </div>
                  <div className="ss-custom-card-actions">
                    <button
                      type="button"
                      className="ss-row-btn ss-row-edit"
                      onClick={() => onEdit(p)}
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      className="ss-row-btn ss-row-delete"
                      onClick={() => onDelete(p)}
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Format extraction intake ─────────────────────────────────────────────
// Two ways in: upload a sample paper (.pdf/.docx) directly, or pick an
// already-uploaded past paper. The admin classifies the paper (type /
// band / subject) because that drives the profile id the draft would
// publish under — Claude only distils the format.

function FormatExtractIntake({ onExtract }) {
  const [meta, setMeta] = useState({
    assessmentType: 'end_of_term',
    gradeBand: 'upper_primary',
    subject: '_generic',
  })
  const [mode, setMode] = useState('upload') // 'upload' | 'past-paper'
  const [file, setFile] = useState(null)
  const [papers, setPapers] = useState(null) // null until loaded
  const [paperId, setPaperId] = useState('')
  const [busy, setBusy] = useState(false)
  const update = (k, v) => setMeta((m) => ({ ...m, [k]: v }))

  useEffect(() => {
    if (mode !== 'past-paper' || papers !== null) return
    let cancelled = false
    listPastPapersForExtraction()
      .then((list) => {
        if (!cancelled) setPapers(list)
      })
      .catch(() => {
        if (!cancelled) setPapers([])
      })
    return () => { cancelled = true }
  }, [mode, papers])

  const ready = mode === 'upload' ? Boolean(file) : Boolean(paperId)

  async function run() {
    setBusy(true)
    try {
      const ok = await onExtract({
        ...meta,
        file: mode === 'upload' ? file : null,
        paperId: mode === 'past-paper' ? paperId : null,
      })
      if (ok) { setFile(null); setPaperId('') }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid #d9cfb8', borderRadius: 10, padding: 14, marginTop: 12 }}>
      <p className="ss-custom-blurb" style={{ marginTop: 0 }}>
        Claude reads the paper and distils its <em>format</em> — structure,
        wording, numbering, marks habits — into a draft profile for your
        review. It writes fresh paraphrased exemplars and never copies the
        paper's questions.
      </p>
      <div className="ss-ct-grade-row">
        <div className="ss-field">
          <label>Assessment type</label>
          <select value={meta.assessmentType}
            onChange={(e) => update('assessmentType', e.target.value)}>
            {ASSESSMENT_FORMAT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="ss-field">
          <label>Grade band</label>
          <select value={meta.gradeBand}
            onChange={(e) => update('gradeBand', e.target.value)}>
            {ASSESSMENT_FORMAT_BANDS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>
        <div className="ss-field">
          <label>Subject</label>
          <select value={meta.subject}
            onChange={(e) => update('subject', e.target.value)}>
            <option value="_generic">All subjects (generic)</option>
            {TEACHER_SUBJECTS.filter((s) => s.value).map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="ss-ct-grade-row">
        <div className="ss-field">
          <label>Source</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="upload">Upload a sample paper (.pdf / .docx / photo)</option>
            <option value="past-paper">Use an uploaded past paper</option>
          </select>
        </div>
        {mode === 'upload' ? (
          <div className="ss-field">
            <label>Sample paper file</label>
            <input
              type="file"
              accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        ) : (
          <div className="ss-field">
            <label>Past paper</label>
            <select value={paperId} onChange={(e) => setPaperId(e.target.value)}>
              <option value="">
                {papers === null ? 'Loading…' : 'Pick a paper…'}
              </option>
              {(papers || []).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <button
        type="button"
        className="ss-btn-primary"
        onClick={run}
        disabled={busy || !ready}
      >
        {busy ? 'Extracting… (about a minute)' : 'Extract format profile'}
      </button>
    </div>
  )
}

// ── Format profile edit modal ───────────────────────────────────────────

const FORMAT_QUESTION_TYPES = [
  'multiple_choice', 'short_answer', 'structured',
  'calculation', 'true_false', 'essay',
]

const EMPTY_FORMAT_SECTION = {
  name: '', heading: '', instructions: '',
  questionTypes: '', questionCountHint: '', marksShare: 0,
  marksPerQuestionHint: '',
}
const EMPTY_FORMAT_EXEMPLAR = { type: 'short_answer', marks: 1, prompt: '', note: '' }

function FormatProfileModal({ profile, onCancel, onSave, reviewing = false }) {
  const editing = !!profile
  const [form, setForm] = useState(() => ({
    assessmentType: profile?.assessmentType || 'end_of_term',
    gradeBand: profile?.gradeBand || 'upper_primary',
    subject: profile?.subject || '_generic',
    label: profile?.label || '',
    paperStructure: (profile?.paperStructure?.length ? profile.paperStructure : [EMPTY_FORMAT_SECTION])
      .map((s) => ({ ...s, questionTypes: Array.isArray(s.questionTypes) ? s.questionTypes.join(', ') : (s.questionTypes || '') })),
    coverInstructions: (profile?.coverInstructions || []).join('\n'),
    numberingStyle: profile?.numberingStyle || '',
    phrasingNotes: (profile?.phrasingNotes || []).join('\n'),
    marksConventions: (profile?.marksConventions || []).join('\n'),
    diagramConventions: (profile?.diagramConventions || []).join('\n'),
    exemplarQuestions: profile?.exemplarQuestions?.length ?
      profile.exemplarQuestions : [{ ...EMPTY_FORMAT_EXEMPLAR }, { ...EMPTY_FORMAT_EXEMPLAR }],
    sourceNote: profile?.sourceNote || '',
  }))
  const [saving, setSaving] = useState(false)
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean)

  const updateSection = (i, k, v) => update('paperStructure',
    form.paperStructure.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)))
  const updateExemplar = (i, k, v) => update('exemplarQuestions',
    form.exemplarQuestions.map((q, idx) => (idx === i ? { ...q, [k]: v } : q)))

  const shareSum = form.paperStructure
    .reduce((sum, s) => sum + (Math.round(Number(s.marksShare)) || 0), 0)

  async function submit() {
    setSaving(true)
    const ok = await onSave({
      ...form,
      paperStructure: form.paperStructure.map((s) => ({
        ...s,
        marksShare: Math.round(Number(s.marksShare)) || 0,
        questionTypes: String(s.questionTypes || '').split(',')
          .map((t) => t.trim().toLowerCase().replace(/\s+/g, '_'))
          .filter((t) => FORMAT_QUESTION_TYPES.includes(t)),
      })),
      coverInstructions: lines(form.coverInstructions),
      phrasingNotes: lines(form.phrasingNotes),
      marksConventions: lines(form.marksConventions),
      diagramConventions: lines(form.diagramConventions),
      exemplarQuestions: form.exemplarQuestions.filter((q) => String(q.prompt || '').trim()),
      _editing: editing,
    })
    if (!ok) setSaving(false)
  }

  return (
    <div className="ss-modal-backdrop">
      <div className="ss-modal">
        <div className="ss-modal-head">
          <h2>
            {reviewing ? 'Review extracted draft' :
              editing ? 'Edit format profile' : 'Add a format profile'}
          </h2>
          <p>
            Goes into <code>cbcKnowledgeBase/&#123;version&#125;/assessmentFormats</code>.
            The My Assessment generator follows it for this assessment type +
            grade band + subject. Write exemplars in the Zambian style but
            <strong> never copy questions from a real paper</strong>.
            {reviewing && (
              <>
                {' '}Approving publishes this draft; check the exemplars are
                paraphrases, not transcriptions.
              </>
            )}
          </p>
          {reviewing && Array.isArray(profile?.validationErrors) &&
            profile.validationErrors.length > 0 && (
            <p style={{ color: '#b91c1c' }}>
              Fix before approving: {profile.validationErrors.join('; ')}
            </p>
          )}
        </div>
        <div className="ss-modal-body">
          <div className="ss-ct-grade-row">
            <div className="ss-field">
              <label>Assessment type</label>
              <select
                value={form.assessmentType}
                onChange={(e) => update('assessmentType', e.target.value)}
                disabled={editing}
              >
                {ASSESSMENT_FORMAT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="ss-field">
              <label>Grade band</label>
              <select
                value={form.gradeBand}
                onChange={(e) => update('gradeBand', e.target.value)}
                disabled={editing}
              >
                {ASSESSMENT_FORMAT_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>
            <div className="ss-field">
              <label>Subject</label>
              <select
                value={form.subject}
                onChange={(e) => update('subject', e.target.value)}
                disabled={editing}
              >
                <option value="_generic">All subjects (generic)</option>
                {TEACHER_SUBJECTS.filter((s) => s.value).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ss-field">
            <label>Label</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder="e.g. Upper Primary Mathematics — End of Term Test"
              maxLength={120}
            />
          </div>

          <div className="ss-field">
            <label>
              Paper sections
              <span style={{ fontWeight: 400, marginLeft: 8, color: shareSum === 100 ? undefined : '#b91c1c' }}>
                (marks shares sum to {shareSum}% — must be 100%)
              </span>
            </label>
            {form.paperStructure.map((s, i) => (
              <div key={i} style={{ border: '1px solid #d9cfb8', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div className="ss-ct-grade-row">
                  <div className="ss-field">
                    <label>Name</label>
                    <input type="text" value={s.name} maxLength={60}
                      placeholder="SECTION A"
                      onChange={(e) => updateSection(i, 'name', e.target.value)} />
                  </div>
                  <div className="ss-field">
                    <label>Heading (as printed)</label>
                    <input type="text" value={s.heading} maxLength={120}
                      placeholder="SECTION A: MULTIPLE CHOICE"
                      onChange={(e) => updateSection(i, 'heading', e.target.value)} />
                  </div>
                  <div className="ss-field">
                    <label>% of marks</label>
                    <input type="number" min={0} max={100} value={s.marksShare}
                      onChange={(e) => updateSection(i, 'marksShare', e.target.value)} />
                  </div>
                </div>
                <div className="ss-field">
                  <label>Section instruction text</label>
                  <input type="text" value={s.instructions} maxLength={400}
                    placeholder="Answer ALL questions in this section. Circle the letter of the correct answer."
                    onChange={(e) => updateSection(i, 'instructions', e.target.value)} />
                </div>
                <div className="ss-ct-grade-row">
                  <div className="ss-field">
                    <label>Question types (comma-separated)</label>
                    <input type="text" value={s.questionTypes}
                      placeholder="multiple_choice, short_answer"
                      onChange={(e) => updateSection(i, 'questionTypes', e.target.value)} />
                  </div>
                  <div className="ss-field">
                    <label>How many questions</label>
                    <input type="text" value={s.questionCountHint} maxLength={30}
                      placeholder="8-10"
                      onChange={(e) => updateSection(i, 'questionCountHint', e.target.value)} />
                  </div>
                  <div className="ss-field">
                    <label>Marks per question</label>
                    <input type="text" value={s.marksPerQuestionHint} maxLength={120}
                      placeholder="1 mark each"
                      onChange={(e) => updateSection(i, 'marksPerQuestionHint', e.target.value)} />
                  </div>
                </div>
                {form.paperStructure.length > 1 && (
                  <button type="button" className="ss-row-btn ss-row-delete"
                    onClick={() => update('paperStructure', form.paperStructure.filter((_, idx) => idx !== i))}>
                    remove section
                  </button>
                )}
              </div>
            ))}
            {form.paperStructure.length < 6 && (
              <button type="button" className="ss-tab-btn"
                onClick={() => update('paperStructure', [...form.paperStructure, { ...EMPTY_FORMAT_SECTION }])}>
                + Add section
              </button>
            )}
          </div>

          <div className="ss-field">
            <label>Front-page instructions (one per line)</label>
            <textarea rows={4} value={form.coverInstructions}
              placeholder={'Write your name and class in the spaces provided.\nAnswer ALL questions.'}
              onChange={(e) => update('coverInstructions', e.target.value)} />
          </div>
          <div className="ss-field">
            <label>Numbering style</label>
            <textarea rows={3} value={form.numberingStyle} maxLength={600}
              placeholder="Sections are lettered A, B, C. Questions are numbered continuously…"
              onChange={(e) => update('numberingStyle', e.target.value)} />
          </div>
          <div className="ss-field">
            <label>Phrasing &amp; register notes (one per line)</label>
            <textarea rows={3} value={form.phrasingNotes}
              placeholder="Use ECZ command words: State, Name, List, Calculate…"
              onChange={(e) => update('phrasingNotes', e.target.value)} />
          </div>
          <div className="ss-field">
            <label>Marks conventions (one per line)</label>
            <textarea rows={3} value={form.marksConventions}
              placeholder="Calculations: 1 mark for method + 1 mark for the answer."
              onChange={(e) => update('marksConventions', e.target.value)} />
          </div>
          <div className="ss-field">
            <label>Diagram conventions (one per line)</label>
            <textarea rows={2} value={form.diagramConventions}
              placeholder="Geometry items need labelled figures; describe them in the diagram field."
              onChange={(e) => update('diagramConventions', e.target.value)} />
          </div>

          <div className="ss-field">
            <label>Exemplar questions (2-4, paraphrased — never from a real paper)</label>
            {form.exemplarQuestions.map((q, i) => (
              <div key={i} style={{ border: '1px solid #d9cfb8', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div className="ss-ct-grade-row">
                  <div className="ss-field">
                    <label>Type</label>
                    <select value={q.type}
                      onChange={(e) => updateExemplar(i, 'type', e.target.value)}>
                      {FORMAT_QUESTION_TYPES.map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ss-field">
                    <label>Marks</label>
                    <input type="number" min={1} max={20} value={q.marks}
                      onChange={(e) => updateExemplar(i, 'marks', e.target.value)} />
                  </div>
                </div>
                <div className="ss-field">
                  <label>Question text</label>
                  <textarea rows={2} value={q.prompt} maxLength={500}
                    onChange={(e) => updateExemplar(i, 'prompt', e.target.value)} />
                </div>
                <div className="ss-field">
                  <label>Style note (optional)</label>
                  <input type="text" value={q.note} maxLength={200}
                    placeholder="e.g. trailing-ellipsis MCQ stem, ECZ house style"
                    onChange={(e) => updateExemplar(i, 'note', e.target.value)} />
                </div>
                {form.exemplarQuestions.length > 2 && (
                  <button type="button" className="ss-row-btn ss-row-delete"
                    onClick={() => update('exemplarQuestions', form.exemplarQuestions.filter((_, idx) => idx !== i))}>
                    remove exemplar
                  </button>
                )}
              </div>
            ))}
            {form.exemplarQuestions.length < 4 && (
              <button type="button" className="ss-tab-btn"
                onClick={() => update('exemplarQuestions', [...form.exemplarQuestions, { ...EMPTY_FORMAT_EXEMPLAR }])}>
                + Add exemplar
              </button>
            )}
          </div>

          <div className="ss-field">
            <label>Source note (optional — provenance only, e.g. "format of 2024 school mock")</label>
            <input type="text" value={form.sourceNote} maxLength={300}
              onChange={(e) => update('sourceNote', e.target.value)} />
          </div>

          <p className="ss-modal-note">
            Saves land in Firestore and reach the assessment generator within
            ~60 seconds. The profile id is derived from type + band + subject,
            so saving over an existing combination replaces it.
          </p>
        </div>
        <div className="ss-modal-foot">
          <button type="button" className="ss-btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="ss-btn-primary"
            onClick={submit}
            disabled={saving || !form.label.trim() || shareSum !== 100}
          >
            {saving ? 'Saving…' :
              reviewing ? 'Approve & publish' :
                editing ? 'Save changes' : 'Add profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Custom topic edit modal ─────────────────────────────────────────────

function CustomTopicModal({ topic, onCancel, onSave }) {
  const editing = !!topic
  const [form, setForm] = useState(() => ({
    grade: topic?.grade || 'G10',
    // 'biology' is not a CBC subject, so a topic missing a subject used to
    // yield an unreachable quiz (no learner filter matches it). Default to a
    // real CBC subject and normalize so it resolves to a valid learner label
    // ('Integrated Science') end-to-end through subjectForLearnerCollection.
    subject: normalizeSubject(topic?.subject || 'science'),
    topic: topic?.topic || '',
    subtopics: arrFromTopic(topic, 'subtopics', subtopicName),
    specificOutcomes: arrFromTopic(topic, 'specificOutcomes'),
    keyCompetencies: arrFromTopic(topic, 'keyCompetencies'),
    values: arrFromTopic(topic, 'values'),
    suggestedMaterials: arrFromTopic(topic, 'suggestedMaterials'),
  }))
  const [saving, setSaving] = useState(false)
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    setSaving(true)
    const ok = await onSave({
      ...form,
      subtopics: form.subtopics.filter(Boolean),
      specificOutcomes: form.specificOutcomes.filter(Boolean),
      keyCompetencies: form.keyCompetencies.filter(Boolean),
      values: form.values.filter(Boolean),
      suggestedMaterials: form.suggestedMaterials.filter(Boolean),
      _editing: editing,
    })
    if (!ok) setSaving(false)
  }

  return (
    <div className="ss-modal-backdrop">
      <div className="ss-modal">
        <div className="ss-modal-head">
          <h2>{editing ? 'Edit custom topic' : 'Add a custom topic'}</h2>
          <p>
            Goes into <code>cbcKnowledgeBase/&#123;version&#125;/topics</code>.
            Grounds the AI on top of any syllabi-data row with the same
            grade + subject + topic name.
          </p>
        </div>
        <div className="ss-modal-body">
          <div className="ss-ct-grade-row">
            <div className="ss-field">
              <label>Grade</label>
              <select
                value={form.grade}
                onChange={(e) => update('grade', e.target.value)}
              >
                {TEACHER_GRADES.filter((g) => g.value).map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <div className="ss-field">
              <label>Subject</label>
              <select
                value={form.subject}
                onChange={(e) => update('subject', e.target.value)}
              >
                {TEACHER_SUBJECTS.filter((s) => s.value).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ss-field">
            <label>Topic name</label>
            <input
              type="text"
              value={form.topic}
              onChange={(e) => update('topic', e.target.value)}
              placeholder="e.g. Cell Division (Mitosis & Meiosis)"
              maxLength={200}
            />
          </div>

          <CustomArrayEditor
            label="Sub-topics"
            hint="One per line."
            values={form.subtopics}
            onChange={(v) => update('subtopics', v)}
          />
          <CustomArrayEditor
            label="Specific outcomes"
            hint="Measurable CBC outcomes."
            values={form.specificOutcomes}
            onChange={(v) => update('specificOutcomes', v)}
          />
          <CustomArrayEditor
            label="Key competencies"
            hint="From the CBC competencies list."
            values={form.keyCompetencies}
            onChange={(v) => update('keyCompetencies', v)}
          />
          <CustomArrayEditor
            label="Values"
            values={form.values}
            onChange={(v) => update('values', v)}
          />
          <CustomArrayEditor
            label="Suggested teaching/learning materials"
            values={form.suggestedMaterials}
            onChange={(v) => update('suggestedMaterials', v)}
          />

          <p className="ss-modal-note">
            Edits land in Firestore and reach every AI generator within
            ~60 seconds. Use the row-level editor above for tweaks that
            belong on the official syllabi rows; this form is for
            entries that don't map to any syllabus.
          </p>
        </div>
        <div className="ss-modal-foot">
          <button type="button" className="ss-btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="ss-btn-primary"
            onClick={submit}
            disabled={saving || !form.topic.trim()}
          >
            {saving ? 'Saving…' : (editing ? 'Save changes' : 'Add topic')}
          </button>
        </div>
      </div>
    </div>
  )
}

function CustomArrayEditor({ label, hint, values, onChange }) {
  const update = (i, v) => onChange(values.map((x, idx) => (idx === i ? v : x)))
  const add = () => onChange([...values, ''])
  const remove = (i) => onChange(
    values.filter((_, idx) => idx !== i).concat(values.length === 1 ? [''] : []),
  )
  return (
    <div className="ss-field">
      <label>{label}</label>
      {hint && <p className="ss-ct-hint">{hint}</p>}
      <div className="ss-ct-list">
        {values.map((v, i) => (
          <div key={i} className="ss-ct-row">
            <input
              type="text"
              value={v}
              onChange={(e) => update(i, e.target.value)}
              placeholder={`${label.replace(/s$/, '')} ${i + 1}`}
            />
            {values.length > 1 && (
              <button
                type="button"
                className="ss-row-btn ss-row-delete"
                onClick={() => remove(i)}
              >
                remove
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="ss-ct-add" onClick={add}>
        + Add another
      </button>
    </div>
  )
}

function arrFromTopic(topic, key, mapper) {
  const v = topic?.[key]
  const list = Array.isArray(v) ? v : []
  const mapped = mapper ? list.map(mapper).filter(Boolean) : list.filter(Boolean)
  return mapped.length > 0 ? mapped : ['']
}

// ── Subject detail (editable table) ──────────────────────────────────────

function SubjectDetail({
  studioSubject, meta, currentSheet, onSelectSheet, rowFilter, onRowFilter,
  onBack, onEditRow, onAddRow, onDeleteRow, onRestoreRow,
}) {
  const sheetNames = useMemo(() => Object.keys(meta.sheets), [meta])
  const activeSheetName = sheetNames.includes(currentSheet) ? currentSheet : sheetNames[0]
  const sheet = activeSheetName ? meta.sheets[activeSheetName] : null

  // Convert the visible sheet rows into KB topics for the bulk-actions
  // toolbar — bulk publish / bulk generate only acts on what's on-screen.
  const visibleTopics = useMemo(() => {
    if (!sheet) return []
    const subset = { [studioSubject]: { [activeSheetName]: sheet } }
    return syllabiToKbTopics(subset)
  }, [sheet, studioSubject, activeSheetName])

  const renderedRows = useMemo(() => {
    if (!sheet) return { rows: [], shown: 0 }
    const out = []
    const q = rowFilter.trim().toLowerCase()
    let lastTopic = ''
    let groupOddCounter = 0
    let shown = 0
    let idx = 0
    for (const row of sheet.rows) {
      if (row.type === 'section') {
        out.push({ kind: 'section', key: `s-${idx++}`, label: row.label })
        lastTopic = ''
        groupOddCounter = 0
        continue
      }
      if (row.type !== 'data') continue
      const cells = (sheet.columns || EDITABLE_COLUMNS).map(c => (row.cells?.[c] || ''))
      if (q && !cells.some(c => c.toLowerCase().includes(q))) continue
      shown++

      const rawTopic = String(row.cells?.TOPIC || '').trim()
      if (rawTopic && rawTopic !== lastTopic) {
        out.push({ kind: 'topic', key: `t-${idx++}`, label: rawTopic })
        lastTopic = rawTopic
        groupOddCounter = 0
      }
      groupOddCounter++
      out.push({
        kind: 'data',
        key: `d-${idx++}`,
        cells,
        row,
        topic: rawTopic || lastTopic,
        subtopic: String(row.cells?.['SUB-TOPIC'] || row.cells?.SUBTOPIC || '').trim(),
        odd: groupOddCounter % 2 === 0,
        firstInGroup: groupOddCounter === 1,
        override: row.__override || null,
      })
    }
    return { rows: out, shown }
  }, [sheet, rowFilter])

  if (!sheet) {
    return <p className="ss-empty">No sheet to display.</p>
  }

  const showTopicCell = Boolean(rowFilter.trim())
  const dataColumns = sheet.columns || EDITABLE_COLUMNS
  const columnCount = dataColumns.length + 1 // +1 for the actions column
  const grade = sheetNameToGrade(activeSheetName)
  const kbSubject = STUDIO_SUBJECT_TO_KB[studioSubject]

  return (
    <div className="ss-detail">
      <button type="button" className="ss-back-btn" onClick={onBack}>
        ← All Subjects
      </button>

      <section className="ss-detail-hero">
        <div className="ss-dh-icon" aria-hidden>{meta.icon}</div>
        <div className="ss-dh-text">
          <h1>{meta.short}</h1>
          <p>
            {sheetNames.length} level{sheetNames.length > 1 ? 's' : ''}
            {sheetNames.length > 0 ? '  ·  ' : ''}
            {sheetNames.join('  ·  ')}
            {grade && kbSubject && (
              <>
                {'  ·  '}
                <span className="ss-dh-mapping">
                  current sheet → <code>{grade}</code> / <code>{kbSubject}</code>
                </span>
              </>
            )}
          </p>
        </div>
        <div className="ss-dh-actions">
          <BulkPublishQuizzesButton topics={visibleTopics} />
          <BulkGenerateButton topics={visibleTopics} />
        </div>
      </section>

      <div className="ss-tabs-bar" role="tablist" aria-label="Levels">
        {sheetNames.map(name => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={name === activeSheetName}
            className={`ss-tab-btn ${name === activeSheetName ? 'is-active' : ''}`}
            onClick={() => onSelectSheet(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="ss-table-wrap">
        <div className="ss-table-toolbar">
          <input
            type="text"
            className="ss-tbl-search"
            placeholder="Filter rows in this level…"
            value={rowFilter}
            onChange={e => onRowFilter(e.target.value)}
          />
          <span className="ss-row-count">
            {renderedRows.shown} row{renderedRows.shown !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            className="ss-add-row-btn"
            onClick={() => onAddRow(studioSubject, activeSheetName)}
          >
            + Add row
          </button>
        </div>
        <div className="ss-tbl-container">
          <table className="ss-table">
            <thead>
              <tr>
                {dataColumns.map((col, i) => (
                  <th key={col} style={i === 0 && !showTopicCell ? { display: 'none' } : undefined}>
                    {col}
                  </th>
                ))}
                <th className="ss-actions-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {renderedRows.rows.map(row => {
                if (row.kind === 'section') {
                  return (
                    <tr key={row.key} className="ss-section-row">
                      <td colSpan={showTopicCell ? columnCount : columnCount - 1}>
                        {row.label}
                      </td>
                    </tr>
                  )
                }
                if (row.kind === 'topic') {
                  return (
                    <tr key={row.key} className="ss-topic-header-row">
                      <td colSpan={showTopicCell ? columnCount : columnCount - 1}>
                        {row.label}
                        <button
                          type="button"
                          className="ss-add-row-inline"
                          title="Add a row under this topic"
                          onClick={() => onAddRow(studioSubject, activeSheetName, { TOPIC: row.label })}
                        >
                          + add row
                        </button>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={row.key} className={`ss-data-row ${row.odd ? 'ss-odd-row' : ''} ${row.override ? `ss-ov-${row.override.kind}` : ''}`}>
                    {row.cells.map((val, ci) => {
                      if (ci === 0 && !showTopicCell) return null
                      const className = ci === 0
                        ? 'ss-topic-cell-dim'
                        : ci === 1
                          ? `ss-subtopic-cell ${row.firstInGroup ? 'ss-first-in-group' : ''}`
                          : ci === 2
                            ? 'ss-competences-cell'
                            : ci === 3
                              ? 'ss-activities-cell'
                              : 'ss-standard-cell'
                      return (
                        <td key={ci} className={className}>
                          {renderCell(val, rowFilter.trim())}
                          {ci === 1 && row.override && (
                            <span className={`ss-ov-badge ss-ov-badge-${row.override.kind}`}>
                              {row.override.kind === 'inserted' ? 'added' : 'edited'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className="ss-actions-cell">
                      <button
                        type="button"
                        className="ss-row-btn ss-row-edit"
                        onClick={() => onEditRow(studioSubject, activeSheetName, row.row)}
                      >
                        edit
                      </button>
                      {row.override && (
                        <button
                          type="button"
                          className="ss-row-btn ss-row-restore"
                          onClick={() => onRestoreRow({
                            studioSubject,
                            sheet: activeSheetName,
                            topic: row.topic,
                            subtopic: row.subtopic,
                          })}
                          title="Discard override and restore base value"
                        >
                          restore
                        </button>
                      )}
                      <button
                        type="button"
                        className="ss-row-btn ss-row-delete"
                        onClick={() => onDeleteRow({
                          studioSubject,
                          sheet: activeSheetName,
                          topic: row.topic,
                          subtopic: row.subtopic,
                        })}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Search ───────────────────────────────────────────────────────────────

function SearchResults({ query, results, onOpenResult }) {
  return (
    <div className="ss-search-results">
      <div className="ss-sr-header">
        <h2>Search results</h2>
        <p>
          {results.length}{results.length >= 60 ? '+' : ''} levels match
          {' '}&ldquo;<strong>{query}</strong>&rdquo;
        </p>
      </div>
      {results.length === 0 && (
        <p className="ss-sr-empty">No results found.</p>
      )}
      <div className="ss-sr-list">
        {results.map(r => (
          <button
            key={`${r.subj}||${r.sheetName}`}
            type="button"
            className="ss-sri"
            onClick={() => onOpenResult(r.subj, r.sheetName)}
          >
            <span className="ss-sri-icon" aria-hidden>{r.icon}</span>
            <span className="ss-sri-body">
              <span className="ss-sri-title">{r.short}</span>
              <span className="ss-sri-meta">{r.cat} · {r.sheetName}</span>
            </span>
            <span className="ss-pill">{r.count} match{r.count > 1 ? 'es' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Edit row modal ───────────────────────────────────────────────────────

function EditRowModal({ editing, onCancel, onSave }) {
  const [cells, setCells] = useState(editing.cells)
  const [saving, setSaving] = useState(false)
  const isInsert = editing.mode === 'insert'

  function update(col, value) {
    setCells((c) => ({ ...c, [col]: value }))
  }

  async function submit() {
    setSaving(true)
    const ok = await onSave({
      mode: editing.mode,
      studioSubject: editing.studioSubject,
      sheet: editing.sheet,
      topic: editing.original.topic,
      subtopic: editing.original.subtopic,
      cells,
    })
    if (!ok) setSaving(false)
  }

  return (
    <div className="ss-modal-backdrop">
      <div className="ss-modal">
        <div className="ss-modal-head">
          <h2>{isInsert ? 'Add syllabus row' : 'Edit syllabus row'}</h2>
          <p>{editing.studioSubject} · {editing.sheet}</p>
        </div>
        <div className="ss-modal-body">
          {EDITABLE_COLUMNS.map((col) => (
            <div key={col} className="ss-field">
              <label htmlFor={`f-${col}`}>{col}</label>
              <textarea
                id={`f-${col}`}
                value={cells[col] || ''}
                onChange={(e) => update(col, e.target.value)}
                rows={col === 'TOPIC' || col === 'SUB-TOPIC' ? 2 : 5}
                placeholder={
                  col === 'LEARNING ACTIVITIES' ?
                    'Use a new line per bullet. Lines starting with • are rendered as a list.' :
                    ''
                }
              />
            </div>
          ))}
          <p className="ss-modal-note">
            Edits are saved as overrides on top of the base curriculum-data.
            Every AI generator picks them up within ~60 seconds (the KB
            cache TTL). Use the row's <strong>restore</strong> action to
            discard an override and fall back to the original.
          </p>
        </div>
        <div className="ss-modal-foot">
          <button type="button" className="ss-btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="ss-btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : (isInsert ? 'Add row' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────
// Built on the same palette + layout primitives as SyllabiLibrary so the
// admin page is visually a 1:1 of the teacher-facing studio, with edit /
// delete affordances added.

function SyllabiStudioStyles() {
  return (
    <style>{`
.ss-root {
  --ss-cream:  #F2EDE3;
  --ss-cream2: #EBE4D8;
  --ss-teal:   #1B3A4B;
  --ss-orange: #C66E4F;
  --ss-white:  #FFFFFF;
  --ss-text:   #1a1a1a;
  --ss-muted:  #6B6B6B;
  /* Ink half of --ss-teal — see the twin comment in SyllabiLibrary.jsx. The
     token FILLS chrome that stays dark in both themes AND inks headings that
     must invert; the two halves need separate names. Identical here. */
  --ss-ink-strong: var(--ss-teal);
  /* Same split for --ss-orange, for the second reason: it FILLS accent bars,
     the active-tab underline and badges that carry white text, and it also
     INKS the sidebar group labels — where #C66E4F on white measures 3.66:1,
     under the 4.5 a 10px label needs. The ink half is darkened; the fills are
     untouched, so nothing in the layout moves. */
  --ss-accent-ink: #A5522F;
  /* And a third: the same accent as a FILL under white text. #C66E4F carries
     white at 3.66:1 — a 11px bold pill fails. Deepened just enough to clear
     4.5 while staying the same hue, so the chips read as they always did. */
  --ss-orange-solid: #AE5A39;
  --ss-radius: 14px;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--ss-cream);
  color: var(--ss-text);
  border-radius: 22px;
  overflow: hidden;
  border: 1.5px solid var(--ss-cream2);
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 160px);
}
.ss-root *, .ss-root *::before, .ss-root *::after { box-sizing: border-box; }
.ss-root mark { background: #FFE082; border-radius: 2px; padding: 0 2px; color: inherit; }
.ss-root .sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

.ss-root .ss-header {
  min-height: 64px;
  background: var(--ss-teal);
  color: white;
  display: flex; align-items: center;
  padding: 10px 24px; gap: 16px;
  flex-shrink: 0; z-index: 5;
}
.ss-root .ss-logo-mark {
  width: 36px; height: 36px;
  background: var(--ss-orange); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; flex-shrink: 0;
}
.ss-root .ss-logo-text-wrap { display: flex; flex-direction: column; line-height: 1.15; }
.ss-root .ss-logo-text {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 20px; font-weight: 700;
}
.ss-root .ss-logo-sub { font-size: 12px; opacity: 0.7; }
.ss-root .ss-version-pill {
  display: inline-block; padding: 1px 6px; border-radius: 6px;
  background: rgba(255,255,255,0.18); color: white; font-family: monospace;
  font-size: 11px; margin: 0 2px;
}
.ss-root .ss-version-pill.is-custom { background: var(--ss-orange); }
.ss-root .ss-spacer { flex: 1; }
.ss-root .ss-search-wrap { position: relative; display: inline-flex; }
.ss-root .ss-search-box {
  background: rgba(255,255,255,0.12);
  border: 1.5px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  color: white;
  padding: 8px 14px 8px 36px;
  font-size: 14px; width: 280px; outline: none; font-family: inherit;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='rgba(255,255,255,0.5)' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: 12px center;
}
.ss-root .ss-search-box::placeholder { color: rgba(255,255,255,0.5); }
.ss-root .ss-search-box:focus { background-color: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.5); }
.ss-root .ss-search-box:disabled { opacity: 0.55; cursor: not-allowed; }

.ss-root .ss-toast {
  margin: 12px 24px 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: #ECFDF5;
  border: 1.5px solid #6EE7B7;
  color: #065F46;
  font-size: 13px;
  font-weight: 600;
}

.ss-root .ss-layout { display: flex; flex: 1; min-height: 0; }

.ss-root .ss-sidebar {
  width: 260px;
  background: var(--ss-white);
  border-right: 1.5px solid var(--ss-cream2);
  display: flex; flex-direction: column; flex-shrink: 0;
  padding: 16px 0 24px;
  overflow-y: auto;
  max-height: calc(100vh - 160px);
  position: sticky; top: 0;
}
.ss-root .ss-sidebar-placeholder { padding: 16px 20px; font-size: 12px; color: var(--ss-muted); }
.ss-root .ss-sb-group { margin-bottom: 6px; }
.ss-root .ss-sb-label {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 20px 6px;
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px;
  color: var(--ss-accent-ink);
}
.ss-root .ss-sb-label::before {
  content: ''; display: inline-block;
  width: 18px; height: 2px;
  background: var(--ss-orange); border-radius: 2px;
}
.ss-root .ss-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 20px;
  font-size: 13.5px;
  cursor: pointer;
  color: var(--ss-text);
  border-left: 3px solid transparent;
  background: transparent;
  border-top: none; border-right: none; border-bottom: none;
  width: 100%; text-align: left; font-family: inherit;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ss-root .ss-nav-item:hover { background: var(--ss-cream); }
.ss-root .ss-nav-item.is-active {
  background: var(--ss-cream);
  border-left-color: var(--ss-orange);
  font-weight: 600; color: var(--ss-ink-strong);
}
.ss-root .ss-home-item { margin: 0 0 12px; }
.ss-root .ss-nav-icon { font-size: 15px; flex-shrink: 0; }

.ss-root .ss-main {
  flex: 1; min-width: 0;
  padding: 28px 32px;
  overflow-y: auto;
  max-height: calc(100vh - 160px);
}

.ss-root .ss-loading, .ss-root .ss-error {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-cream2);
  border-radius: var(--ss-radius);
  padding: 24px; text-align: center; color: var(--ss-muted);
}
.ss-root .ss-loading-dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--ss-orange);
  margin: 0 auto 10px;
  animation: ssPulse 1.1s ease-in-out infinite;
}
@keyframes ssPulse {
  0%,100% { transform: scale(0.7); opacity: 0.5; }
  50%     { transform: scale(1.1); opacity: 1; }
}
.ss-root .ss-error-title { font-weight: 700; color: #B7331C; margin-bottom: 4px; }
.ss-root .ss-error-detail { font-size: 13px; }
.ss-root .ss-empty { color: var(--ss-muted); font-size: 14px; padding: 24px; }

.ss-root .ss-hero {
  background: var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 28px 32px;
  color: white;
  margin-bottom: 28px;
  display: flex; align-items: center; gap: 20px;
}
.ss-root .ss-hero-label {
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px;
  color: var(--ss-accent-ink);
  margin-bottom: 8px;
}
.ss-root .ss-hero-title {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 30px; font-weight: 900; line-height: 1.1;
  margin: 0 0 6px;
}
.ss-root .ss-hero-blurb { font-size: 14px; opacity: 0.8; margin: 0; }
.ss-root .ss-hero-emoji { font-size: 56px; margin-left: auto; }

.ss-root .ss-stats-row {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 12px; margin-bottom: 28px;
}
.ss-root .ss-stat-card {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 16px 18px;
  border-left: 4px solid var(--ss-orange);
}
.ss-root .ss-stat-num {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 28px; font-weight: 900;
  color: var(--ss-ink-strong);
}
.ss-root .ss-stat-lbl {
  font-size: 11px; color: var(--ss-muted);
  text-transform: uppercase; letter-spacing: 0.6px;
  font-weight: 600; margin-top: 2px;
}

.ss-root .ss-pdf-upload-wrap { margin-bottom: 28px; }

.ss-root .ss-cat-section { margin-bottom: 36px; }
.ss-root .ss-section-heading {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 16px; margin-top: 8px;
}
.ss-root .ss-sh-dash {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px;
  color: var(--ss-accent-ink);
}
.ss-root .ss-sh-dash::before {
  content: ''; display: inline-block;
  width: 22px; height: 2.5px;
  background: var(--ss-orange); border-radius: 2px;
}
.ss-root .ss-sh-title {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 22px; font-weight: 900;
  color: var(--ss-ink-strong); margin: 0;
}

.ss-root .ss-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 14px;
}
.ss-root .ss-subj-card {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 20px 18px 16px;
  cursor: pointer; position: relative;
  transition: transform 0.15s, box-shadow 0.15s;
  text-align: left; font-family: inherit; color: inherit; width: 100%;
}
.ss-root .ss-subj-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(27,58,75,0.13); }
.ss-root .ss-card-icon-wrap {
  width: 48px; height: 48px;
  background: var(--ss-cream);
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; margin-bottom: 12px;
}
.ss-root .ss-card-name {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 15px; font-weight: 700;
  color: var(--ss-ink-strong); line-height: 1.3; margin-bottom: 6px;
}
.ss-root .ss-card-meta { font-size: 12px; color: var(--ss-muted); }
.ss-root .ss-card-badge {
  position: absolute; top: 14px; right: 14px;
  background: var(--ss-teal); color: white;
  font-size: 10px; font-weight: 700;
  padding: 3px 8px; border-radius: 20px;
}

.ss-root .ss-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px;
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: 8px;
  font-size: 13px; cursor: pointer;
  color: var(--ss-ink-strong); font-weight: 600;
  margin-bottom: 20px; font-family: inherit;
  transition: background 0.15s;
}
.ss-root .ss-back-btn:hover { background: var(--ss-cream); }

.ss-root .ss-detail-hero {
  background: var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 22px 28px;
  color: white;
  margin-bottom: 20px;
  display: flex; align-items: center; gap: 18px;
}
.ss-root .ss-dh-icon {
  width: 56px; height: 56px;
  background: rgba(255,255,255,0.15); border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 30px; flex-shrink: 0;
}
.ss-root .ss-dh-text h1 {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 22px; font-weight: 900;
  margin: 0 0 4px;
}
.ss-root .ss-dh-text p { font-size: 13px; opacity: 0.75; margin: 0; }
.ss-root .ss-dh-mapping code {
  background: rgba(255,255,255,0.12);
  padding: 1px 6px; border-radius: 4px; font-size: 12px;
}
.ss-root .ss-dh-actions {
  margin-left: auto; display: flex; gap: 8px; flex-shrink: 0;
}

.ss-root .ss-tabs-bar {
  display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap;
}
.ss-root .ss-tab-btn {
  padding: 8px 18px;
  font-size: 13px; font-weight: 600;
  cursor: pointer; border-radius: 8px;
  border: 1.5px solid var(--ss-teal);
  background: var(--ss-white);
  color: var(--ss-ink-strong);
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.ss-root .ss-tab-btn:hover { background: var(--ss-cream); }
.ss-root .ss-tab-btn.is-active {
  background: var(--ss-teal); color: white; border-color: var(--ss-teal);
}

.ss-root .ss-table-wrap {
  background: var(--ss-white);
  border: 2px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  overflow: hidden;
}
.ss-root .ss-table-toolbar {
  padding: 12px 18px;
  display: flex; align-items: center; gap: 12px;
  background: var(--ss-cream2);
  border-bottom: 2px solid var(--ss-teal);
}
.ss-root .ss-tbl-search {
  padding: 7px 14px;
  border: 1.5px solid var(--ss-teal);
  border-radius: 8px;
  font-size: 13px; width: 260px;
  outline: none; font-family: inherit;
  background: white; color: var(--ss-text);
}
.ss-root .ss-tbl-search:focus {
  border-color: var(--ss-orange);
  box-shadow: 0 0 0 2px rgba(198,110,79,0.15);
}
.ss-root .ss-row-count {
  font-size: 12px; color: var(--ss-muted);
  margin-left: auto; font-weight: 600;
}
.ss-root .ss-add-row-btn {
  background: var(--ss-orange-solid); color: white;
  border: none; border-radius: 8px;
  padding: 7px 14px; font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit;
}
.ss-root .ss-add-row-btn:hover { background: #B55E40; }

.ss-root .ss-tbl-container {
  overflow-x: auto;
  max-height: calc(100vh - 380px);
}
.ss-root .ss-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ss-root .ss-table thead th {
  background: var(--ss-teal); color: white;
  padding: 12px 16px; text-align: left;
  font-weight: 700; font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.8px;
  white-space: nowrap;
  position: sticky; top: 0; z-index: 10;
  border-right: 1px solid rgba(255,255,255,0.15);
}
.ss-root .ss-table thead th:last-child { border-right: none; }
.ss-root .ss-actions-th { width: 130px; }

.ss-root .ss-section-row td {
  background: var(--ss-teal); color: white;
  font-weight: 700; font-size: 12px;
  text-transform: uppercase; letter-spacing: 1px;
  padding: 10px 16px; border: none;
}
.ss-root .ss-topic-header-row td {
  background: #D4E4EC;
  color: var(--ss-ink-strong);
  font-weight: 800; font-size: 13px;
  padding: 11px 16px;
  border-top: 2.5px solid var(--ss-teal);
  border-bottom: 1.5px solid #9BBECE;
  letter-spacing: 0.2px;
  border-left: 4px solid var(--ss-orange);
}
.ss-root .ss-add-row-inline {
  float: right; background: transparent;
  border: 1.5px dashed var(--ss-teal);
  color: var(--ss-ink-strong); font-weight: 700; font-size: 11px;
  padding: 2px 10px; border-radius: 5px; cursor: pointer;
  font-family: inherit;
}
.ss-root .ss-add-row-inline:hover { background: var(--ss-cream); }

.ss-root .ss-data-row { border-bottom: 1px solid #E8E0D4; }
.ss-root .ss-data-row:last-child { border-bottom: none; }
.ss-root .ss-data-row:hover { background: #FBF8F3; }
.ss-root .ss-data-row.ss-odd-row { background: #FAFAF8; }
.ss-root .ss-data-row.ss-odd-row:hover { background: #F5F2EC; }
.ss-root .ss-data-row.ss-ov-edited { background: #FFFBEB; }
.ss-root .ss-data-row.ss-ov-edited:hover { background: #FEF3C7; }
.ss-root .ss-data-row.ss-ov-inserted { background: #ECFDF5; }
.ss-root .ss-data-row.ss-ov-inserted:hover { background: #D1FAE5; }
.ss-root .ss-ov-badge {
  display: inline-block; margin-left: 6px;
  padding: 1px 6px; border-radius: 4px;
  font-size: 9px; font-weight: 800; text-transform: uppercase;
  vertical-align: middle;
}
.ss-root .ss-ov-badge-edited { background: #F59E0B; color: white; }
.ss-root .ss-ov-badge-inserted { background: #10B981; color: white; }

.ss-root .ss-table td {
  padding: 11px 16px;
  vertical-align: top;
  line-height: 1.6;
  border-right: 1px solid #EDE7DB;
}
.ss-root .ss-table td:last-child { border-right: none; }
.ss-root .ss-topic-cell-dim { opacity: 0.45; font-size: 11px; }
.ss-root .ss-subtopic-cell {
  font-weight: 600; color: var(--ss-ink-strong);
  min-width: 180px;
  border-left: 3px solid transparent;
}
.ss-root .ss-subtopic-cell.ss-first-in-group { border-left-color: #9BBECE; }
.ss-root .ss-competences-cell { min-width: 180px; }
.ss-root .ss-activities-cell { min-width: 260px; max-width: 380px; }
.ss-root .ss-standard-cell {
  min-width: 160px; color: #555;
  font-style: italic; font-size: 12.5px;
}
.ss-root .ss-table td ul { padding-left: 16px; margin: 3px 0; }
.ss-root .ss-table td ul li { margin: 4px 0; }

.ss-root .ss-actions-cell {
  display: flex; flex-direction: column; gap: 4px;
  align-items: flex-start;
}
.ss-root .ss-row-btn {
  background: transparent; border: none;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; padding: 0;
}
.ss-root .ss-row-edit { color: var(--ss-ink-strong); }
.ss-root .ss-row-edit:hover { text-decoration: underline; }
.ss-root .ss-row-delete { color: #B91C1C; }
.ss-root .ss-row-delete:hover { text-decoration: underline; }
.ss-root .ss-row-restore { color: #B45309; }
.ss-root .ss-row-restore:hover { text-decoration: underline; }

.ss-root .ss-search-results .ss-sr-header { margin-bottom: 20px; }
.ss-root .ss-sr-header h2 {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 24px; font-weight: 900;
  color: var(--ss-ink-strong); margin: 0 0 4px;
}
.ss-root .ss-sr-header p { font-size: 13px; color: var(--ss-muted); margin: 0; }
.ss-root .ss-sr-empty { font-size: 14px; color: var(--ss-muted); }
.ss-root .ss-sr-list { display: flex; flex-direction: column; gap: 10px; }
.ss-root .ss-sri {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 14px 18px;
  cursor: pointer;
  display: flex; align-items: center; gap: 14px;
  font-family: inherit; text-align: left; width: 100%; color: inherit;
}
.ss-root .ss-sri:hover { box-shadow: 0 4px 16px rgba(27,58,75,0.12); transform: translateY(-1px); }
.ss-root .ss-sri-icon {
  width: 40px; height: 40px;
  background: var(--ss-cream); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; flex-shrink: 0;
}
.ss-root .ss-sri-body { flex: 1; display: flex; flex-direction: column; }
.ss-root .ss-sri-title { font-size: 14px; font-weight: 700; color: var(--ss-ink-strong); margin-bottom: 2px; }
.ss-root .ss-sri-meta { font-size: 12px; color: var(--ss-muted); }
.ss-root .ss-pill {
  display: inline-block;
  padding: 3px 10px; border-radius: 20px;
  font-size: 11px; font-weight: 700;
  background: var(--ss-orange-solid); color: white;
}

/* ── Custom (Firestore-only) topics panel ───────────────────────────── */
.ss-root .ss-custom-panel {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 22px 26px;
  margin-bottom: 28px;
  border-left: 4px solid var(--ss-orange);
}
.ss-root .ss-custom-head {
  display: flex; align-items: flex-start; gap: 18px;
  margin-bottom: 14px;
}
.ss-root .ss-custom-head h2 { margin: 0 0 4px; }
.ss-root .ss-custom-count {
  display: inline-block;
  margin-left: 10px;
  padding: 2px 10px;
  font-size: 12px;
  border-radius: 12px;
  background: var(--ss-orange-solid); color: white;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  vertical-align: middle;
}
.ss-root .ss-custom-blurb {
  font-size: 13px; color: var(--ss-muted); margin: 0; max-width: 56ch;
}
.ss-root .ss-custom-actions {
  margin-left: auto; display: flex; gap: 8px; flex-shrink: 0; align-items: center;
}
.ss-root .ss-custom-empty {
  font-size: 13px; color: var(--ss-muted); margin: 0;
  padding: 12px 14px;
  background: var(--ss-cream);
  border-radius: 8px;
}
.ss-root .ss-custom-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}
.ss-root .ss-custom-grade-block { display: flex; flex-direction: column; gap: 8px; }
.ss-root .ss-custom-grade-label {
  font-size: 11px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 1px;
  color: var(--ss-ink-strong);
  padding-bottom: 4px;
  border-bottom: 1.5px dashed var(--ss-cream2);
}
.ss-root .ss-custom-card {
  background: #FBF8F3;
  border: 1.5px solid #E8E0D4;
  border-radius: 10px;
  padding: 12px 14px;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    "meta meta"
    "title actions"
    "subs subs";
  gap: 4px 12px;
}
.ss-root .ss-custom-card-meta {
  grid-area: meta;
  font-size: 11px; color: var(--ss-accent-ink);
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
}
.ss-root .ss-custom-card-title {
  grid-area: title;
  font-family: 'Playfair Display', serif;
  font-weight: 800; font-size: 15px;
  color: var(--ss-ink-strong);
}
.ss-root .ss-custom-card-subs {
  grid-area: subs;
  font-size: 12px; color: var(--ss-muted); margin-top: 2px;
}
.ss-root .ss-custom-card-actions {
  grid-area: actions;
  display: flex; gap: 10px; align-items: center;
}

/* Custom topic modal helpers */
.ss-ct-grade-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;
}
.ss-ct-hint { font-size: 12px; color: #6B6B6B; margin: -2px 0 6px; }
.ss-ct-list { display: flex; flex-direction: column; gap: 6px; }
.ss-ct-row {
  display: flex; gap: 8px; align-items: center;
}
.ss-ct-row input {
  flex: 1;
  border: 1.5px solid #E2D7C2; border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit; font-size: 14px; outline: none;
}
.ss-ct-row input:focus { border-color: #C66E4F; box-shadow: 0 0 0 2px rgba(198,110,79,0.15); }
.ss-ct-add {
  margin-top: 6px;
  background: transparent; border: none;
  color: #047857; font-weight: 700; font-size: 12px;
  cursor: pointer; font-family: inherit; padding: 0;
}
.ss-ct-add:hover { text-decoration: underline; }
.ss-field select {
  width: 100%;
  border: 1.5px solid #E2D7C2; border-radius: 8px;
  padding: 9px 10px;
  font-family: inherit; font-size: 14px; background: white;
  outline: none;
}

.ss-modal-backdrop {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(15, 23, 42, 0.6);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px; overflow-y: auto;
}
.ss-modal {
  background: var(--ss-white, #FFFFFF);
  border-radius: 16px; max-width: 760px; width: 100%;
  margin: 32px 0; box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  font-family: 'Inter', system-ui, sans-serif;
}
.ss-modal-head {
  padding: 18px 24px; border-bottom: 1.5px solid #EBE4D8;
}
.ss-modal-head h2 {
  font-family: 'Playfair Display', serif;
  font-size: 20px; font-weight: 900; margin: 0 0 2px;
  color: #1B3A4B;
}
.ss-modal-head p { font-size: 12px; color: #6B6B6B; margin: 0; }
.ss-modal-body { padding: 20px 24px; }
.ss-field { margin-bottom: 14px; }
.ss-field label {
  display: block;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.8px;
  color: #1B3A4B; margin-bottom: 6px;
}
.ss-field textarea {
  width: 100%;
  border: 1.5px solid #E2D7C2;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: inherit; font-size: 14px; line-height: 1.5;
  resize: vertical; min-height: 56px; outline: none;
}
.ss-field textarea:focus { border-color: #C66E4F; box-shadow: 0 0 0 2px rgba(198,110,79,0.15); }
.ss-modal-note {
  font-size: 12px; color: #6B6B6B; margin: 10px 0 0;
  padding: 10px 12px; background: #FBF8F3; border-radius: 8px;
  border-left: 3px solid #C66E4F;
}
.ss-modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 24px; border-top: 1.5px solid #EBE4D8;
}
.ss-btn-ghost {
  background: transparent;
  border: 1.5px solid #E2D7C2; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; color: #1B3A4B;
}
.ss-btn-ghost:hover { background: #FBF8F3; }
.ss-btn-primary {
  background: linear-gradient(90deg, #10B981, #14B8A6);
  color: white; border: none; border-radius: 8px;
  padding: 8px 18px; font-size: 13px; font-weight: 800;
  cursor: pointer; font-family: inherit;
}
.ss-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 900px) {
  .ss-root .ss-sidebar { display: none; }
  .ss-root .ss-main { padding: 20px 18px; max-height: none; }
  .ss-root .ss-stats-row { grid-template-columns: repeat(2, 1fr); }
  .ss-root .ss-hero { padding: 20px 22px; }
  .ss-root .ss-hero-title { font-size: 24px; }
  .ss-root .ss-hero-emoji { font-size: 40px; }
  .ss-root .ss-search-box { width: 160px; }
  .ss-root .ss-dh-actions { display: none; }
}
@media (max-width: 560px) {
  .ss-root .ss-stats-row { grid-template-columns: 1fr 1fr; }
  .ss-root .ss-header { padding: 10px 14px; }
  .ss-root .ss-search-box { width: 140px; padding-left: 32px; }
  .ss-root .ss-logo-sub { display: none; }
}

/* ── NIGHT THEME ─────────────────────────────────────────────────────── */
/* The admin twin of the block at the end of SyllabiLibrary.jsx. The two
   stylesheets are independent copies of one design system, so a fix applied
   to one is invisible in the other — keep them in step.

   --ss-teal stays dark: it fills the header, the section rows and the
   active tab, which are dark in both themes. Ink drawn in teal reads
   --ss-ink-strong and inverts. */
[data-theme='night'] .ss-root {
  --ss-cream:  #1A222E;
  --ss-cream2: #3B4757;
  --ss-teal:   #16303F;
  --ss-orange: #D9784F;
  --ss-white:  #232D3B;
  --ss-text:   #EDE7DC;
  --ss-muted:  #94A0AF;
  --ss-ink-strong: #CFE3EE;
  --ss-accent-ink: #E58A62;
  --ss-orange-solid: #AE5A39;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
}
[data-theme='night'] .ss-root mark { background: #7A5F00; color: #FFE9A8; }
[data-theme='night'] .ss-root .ss-error-title { color: #F1A08C; }
[data-theme='night'] .ss-root .ss-add-row-btn:hover { background: #E8865C; }
[data-theme='night'] .ss-root .ss-toast {
  background: #16332A;
  border-color: #2E6B55;
  color: #8FE3C2;
}

/* Table chrome + the row-state tints the editor adds on top of it. */
[data-theme='night'] .ss-root .ss-topic-header-row td {
  background: #223543;
  border-bottom-color: #3E5A6B;
}
[data-theme='night'] .ss-root .ss-data-row { border-bottom-color: #313D4C; }
[data-theme='night'] .ss-root .ss-data-row:hover { background: #2A3646; }
[data-theme='night'] .ss-root .ss-data-row.ss-odd-row { background: #1F2836; }
[data-theme='night'] .ss-root .ss-data-row.ss-odd-row:hover { background: #2A3646; }
[data-theme='night'] .ss-root .ss-data-row.ss-ov-edited { background: #3A3116; }
[data-theme='night'] .ss-root .ss-data-row.ss-ov-edited:hover { background: #4A3E1B; }
[data-theme='night'] .ss-root .ss-data-row.ss-ov-inserted { background: #16332A; }
[data-theme='night'] .ss-root .ss-data-row.ss-ov-inserted:hover { background: #1D4335; }
[data-theme='night'] .ss-root .ss-table td { border-right-color: #313D4C; }
[data-theme='night'] .ss-root .ss-subtopic-cell.ss-first-in-group { border-left-color: #3E5A6B; }
[data-theme='night'] .ss-root .ss-standard-cell { color: #AEB8C4; }
[data-theme='night'] .ss-root .ss-row-delete { color: #F1A08C; }
[data-theme='night'] .ss-root .ss-row-restore { color: #E7B268; }

/* The edit/insert modal and the custom-topic panel are rendered outside
   .ss-root, so the token restatement above never reaches them — they carry
   their own literals and need naming one by one. */
[data-theme='night'] .ss-modal {
  background: #232D3B;
  color: #EDE7DC;
}
[data-theme='night'] .ss-modal-head { border-bottom-color: #3B4757; }
[data-theme='night'] .ss-modal-head h2 { color: #CFE3EE; }
[data-theme='night'] .ss-modal-head p,
[data-theme='night'] .ss-ct-hint { color: #94A0AF; }
[data-theme='night'] .ss-field label { color: #CFE3EE; }
[data-theme='night'] .ss-field textarea,
[data-theme='night'] .ss-field select,
[data-theme='night'] .ss-ct-row input {
  background: #1A222E;
  border-color: #3B4757;
  color: #EDE7DC;
}
[data-theme='night'] .ss-modal-note {
  background: #1F2836;
  color: #94A0AF;
}
[data-theme='night'] .ss-modal-foot { border-top-color: #3B4757; }
[data-theme='night'] .ss-btn-ghost {
  border-color: #3B4757;
  color: #CFE3EE;
}
[data-theme='night'] .ss-btn-ghost:hover { background: #2A3646; }
[data-theme='night'] .ss-ct-add { color: #6EE7B7; }
`}</style>
  )
}
