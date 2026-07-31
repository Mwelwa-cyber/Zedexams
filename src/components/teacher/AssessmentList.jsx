import { useState, useMemo, useEffect, useRef } from 'react'
import { where } from 'firebase/firestore'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { db } from '../../firebase/config'
import { usePaginatedQuery } from '../../hooks/usePaginatedQuery'
import { createFirestorePageFetcher } from '../../utils/pagination/firestorePage'
import { createPaginationKey } from '../../utils/pagination/queryKeys'
import { PAGE_SIZES } from '../../utils/pagination/cursors'
import { buildAssessmentName } from '../../utils/downloadFilename'
import { isFreePlanTeacher } from '../../utils/teacherLibraryService'
import { printAssessmentAsPdf, openPrintWindow } from '../../utils/assessmentToPdf'
import { summarizeImportReview } from '../../utils/importReviewSummary.js'
import {
  markAssessmentDeleted,
  unmarkAssessmentDeleted,
  subscribeAssessmentDeletion,
  logAssessmentDeletion,
  filterDeleted,
} from '../../utils/assessmentDeletion'
import ImportReviewBadge from '../quiz/ImportReviewBadge'
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'
import PaginationFooter from '../ui/PaginationFooter'
import { useToast } from '../ui/Toast'
import ConfirmDialog from '../ui/ConfirmDialog'
import { ASSESSMENT_TYPE_LABELS } from './assessmentStudioMeta'
import { assessmentCategory } from './paperTaxonomy'
import { buildSavedAssessmentExportReadiness } from '../../utils/assessmentExportReadiness'
import { renderDiagramSvg } from '../diagrams/diagramCatalog'

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function assessmentFileName(assessment, variant, ext = 'docx') {
  return buildAssessmentName({
    title: assessment.title,
    grade: assessment.grade,
    subject: assessment.subject,
    variant,
    ext,
  })
}

function AssessmentRow({ assessment, onDelete, onExport, busy, routeBase, fallbackLabel }) {
  const id = assessment.id
  const typeLabel = ASSESSMENT_TYPE_LABELS[assessment.assessmentType] || fallbackLabel
  const [exporting, setExporting] = useState(null)
  const toast = useToast()

  async function handleExport(format, mode) {
    // For PDF: open the window now, synchronously, while still in the direct
    // click handler. Browsers block window.open once we await async work.
    let win = null
    if (format === 'pdf') {
      win = openPrintWindow()
      if (!win) {
        toast.error('Your browser blocked the print window. Please allow pop-ups for this site and try again.')
        return
      }
    }
    setExporting(`${format}-${mode}`)
    try {
      await onExport(assessment, format, mode, win)
    } catch (err) {
      toast.error(err?.message || 'Export failed — please try again.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="studio-card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: '#e8d8f0' }}>
          🦅
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm leading-snug" style={{ color: 'var(--zt-text)' }}>{assessment.title || `Untitled ${fallbackLabel.toLowerCase()}`}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
            <span className="text-xs font-bold" style={{ color: 'var(--zt-text-muted)' }}>{typeLabel}</span>
            {assessment.grade && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#e6f5ed', color: 'var(--success-fg)' }}>Grade {assessment.grade}</span>}
            {assessment.subject && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#e3eef0', color: '#16505d' }}>{assessment.subject}</span>}
            {assessment.term && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--sv-canvas)', color: 'var(--sv-muted)' }}>T{assessment.term}</span>}
            {assessment.totalMarks != null && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fde9b8', color: '#8a3d12' }}>{assessment.totalMarks} marks</span>}
            {assessment.duration != null && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fff5e6', color: '#a5523a' }}>{assessment.duration} min</span>}
            {/* Phase 7: surface import-review state on the list so the teacher
                doesn't have to open every imported draft to find the ones
                that flagged warnings during parsing. */}
            <ImportReviewBadge record={assessment} />
          </div>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            {assessment.questionCount ?? 0} questions · Created {formatDate(assessment.createdAt)}
            {assessment.updatedAt && ` · Updated ${formatDate(assessment.updatedAt)}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`${routeBase}/${id}/edit`}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold no-underline transition-colors"
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)', color: 'var(--zt-text)' }}
        >
          ✏️ Edit
        </Link>
        <button
          type="button"
          onClick={() => handleExport('docx', 'paper')}
          disabled={!!exporting || busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)', color: 'var(--zt-text)' }}
        >
          {exporting === 'docx-paper' ? 'Building…' : '📝 Paper (Word)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('pdf', 'paper')}
          disabled={!!exporting || busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)', color: 'var(--zt-text)' }}
        >
          {exporting === 'pdf-paper' ? 'Opening…' : '📄 Paper (PDF)'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('docx', 'scheme')}
          disabled={!!exporting || busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)', color: 'var(--zt-text)' }}
        >
          {exporting === 'docx-scheme' ? 'Building…' : '🗒️ Scheme (Word)'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(assessment)}
          disabled={busy}
          className="rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger-fg)', background: 'var(--zt-card)' }}
        >
          🗑 Delete
        </button>
      </div>
    </div>
  )
}

// Static studio identity, shared with AssessmentStudio.jsx — one unified
// library shows every assessment paper (tests AND examinations) from the one
// `assessments` collection; the category filter below narrows the VIEW, it
// never scopes the query into two disjoint libraries.
const STUDIO_COPY = {
  studioName: 'Assessment Paper Studio',
  heroTitle: 'My assessment papers',
  routeBase: '/teacher/assessment-papers',
  noun: 'assessment paper',
  nounPlural: 'assessment papers',
  Noun: 'Assessment paper',
  NounPlural: 'Assessment papers',
}

const CATEGORY_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'test', label: 'Tests' },
  { value: 'examination', label: 'Examinations' },
]

export default function AssessmentList() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { getAssessmentQuestions, deleteAssessment } = useFirestore()
  const navigate = useNavigate()
  const toast = useToast()
  const cfg = STUDIO_COPY

  const uid = currentUser?.uid
  const pageSize = PAGE_SIZES.DESKTOP_LIST

  const [busyId, setBusyId] = useState(null)
  // Test vs Examination — narrows the view, never the underlying query (both
  // categories live in the same `assessments` collection).
  const [categoryFilter, setCategoryFilter] = useState('all')
  // Phase 8: teacher-side counterpart to ManageContent's filter chip — drops
  // the list to imports the parser flagged for review. Off by default so
  // a teacher landing here still sees everything.
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false)
  // Assessment queued for deletion — drives the ConfirmDialog.
  const [pendingDelete, setPendingDelete] = useState(null)
  // Bumped whenever the deletion registry changes (a local delete, or another
  // tab's) so the filtered views below recompute and drop tombstoned rows even
  // if a page loaded after the delete re-introduced one from a stale cache.
  const [deletionVersion, setDeletionVersion] = useState(0)

  // Cursor-based pagination over the teacher's own assessments (newest first).
  // Replaces the old "read up to 300 in one shot" load: a prolific author now
  // gets a small first page immediately and pulls more only on demand, and the
  // hard 300-doc cap that silently truncated big libraries is gone. The
  // (createdBy, createdAt DESC) composite index already exists; the appended
  // __name__ DESC tiebreaker matches Firestore's implicit ordering, so no new
  // index is required.
  const fetchPage = useMemo(
    () => createFirestorePageFetcher({
      db,
      path: 'assessments',
      constraints: uid ? [where('createdBy', '==', uid)] : [],
      orderByFields: [{ field: 'createdAt', direction: 'desc' }],
    }),
    [uid],
  )

  const queryKey = useMemo(
    () => createPaginationKey({
      scope: 'assessment-list',
      userId: uid,
      sortField: 'createdAt',
      sortDirection: 'desc',
      pageSize,
    }),
    [uid, pageSize],
  )

  const {
    items: assessments,
    isInitialLoading,
    isLoadingNextPage,
    hasNextPage,
    error: pageError,
    loadNextPage,
    removeItem,
  } = usePaginatedQuery({
    queryKey,
    fetchPage,
    pageSize,
    enabled: Boolean(uid),
  })

  const loading = isInitialLoading
  const error = pageError && assessments.length === 0
    ? (pageError.message || 'Failed to load assessments.')
    : ''

  // View filters narrow the ALREADY-LOADED rows only — they never re-query or
  // split the `assessments` collection. Because a matching row could still be
  // sitting on an unfetched page, a filter that currently shows nothing does
  // NOT prove none exist. Compute the filtered views here (not inside the JSX)
  // so the auto-continue effect below can react to them.
  const byCategory = useMemo(
    () => {
      const scoped = categoryFilter === 'all'
        ? assessments
        : assessments.filter(a => assessmentCategory(a.assessmentType) === categoryFilter)
      // Defensive last line against resurrection: never render a paper whose id
      // is tombstoned this session, even if a page loaded after the delete
      // returned it from Firestore's offline cache. deletionVersion re-runs this
      // whenever the registry changes.
      return filterDeleted(scoped)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assessments, categoryFilter, deletionVersion],
  )
  const needsReviewCount = useMemo(
    () => byCategory.reduce((n, a) => (summarizeImportReview(a).needsReview ? n + 1 : n), 0),
    [byCategory],
  )
  const visible = useMemo(
    () => (needsReviewOnly ? byCategory.filter(a => summarizeImportReview(a).needsReview) : byCategory),
    [byCategory, needsReviewOnly],
  )
  const filterActive = categoryFilter !== 'all' || needsReviewOnly
  // True only once the whole library has been walked — the point at which an
  // empty filtered view really does mean "none exist".
  const fullyLoaded = !hasNextPage && !isLoadingNextPage && !isInitialLoading

  // Apply-before-paginating: when a filter is active and has surfaced no matches
  // in the loaded rows, keep pulling pages until a match appears or we hit the
  // true end. Without this the list would falsely report "none" (and disable
  // the Needs-review chip) for rows that simply hadn't loaded yet.
  useEffect(() => {
    if (filterActive && visible.length === 0 && hasNextPage && !isLoadingNextPage && !isInitialLoading) {
      loadNextPage()
    }
  }, [filterActive, visible.length, hasNextPage, isLoadingNextPage, isInitialLoading, loadNextPage])

  // Ids whose delete this component is currently driving. A local delete is
  // finalised by confirmDelete itself (removeItem on success, restore-by-filter
  // on failure), so the registry listener must NOT also drop those rows — only
  // the ones deleted elsewhere.
  const deletingLocallyRef = useRef(new Set())

  // Registry changes — a delete from another tab / surface, or the tombstone
  // being lifted after a failed delete here. Recompute the filtered view every
  // time; permanently drop only rows deleted elsewhere.
  useEffect(() => subscribeAssessmentDeletion((id, deleted) => {
    setDeletionVersion(v => v + 1)
    if (deleted && !deletingLocallyRef.current.has(id)) removeItem(id)
  }), [removeItem])

  async function confirmDelete() {
    const assessment = pendingDelete
    if (!assessment) return
    const startedAt = Date.now()
    setBusyId(assessment.id)
    deletingLocallyRef.current.add(assessment.id)
    // Tombstone BEFORE the network round-trip: this instantly hides the row
    // (via the tombstone filter below), blocks any concurrent editor autosave
    // (this tab or another) from re-persisting the paper mid-delete, and —
    // because the tombstone is persisted to sessionStorage and survives a
    // refresh — stops a stale offline-cache read from resurfacing it. The row
    // is only truly dropped on success; on failure the tombstone is lifted and
    // the row reappears (no un-rollbackable optimistic removal).
    markAssessmentDeleted(assessment.id)
    try {
      await deleteAssessment(assessment.id)
      // Drop it from the loaded pages — no full refetch (§19). The server delete
      // has been awaited, so this is a confirmed removal, not an optimistic one.
      removeItem(assessment.id)
      toast.success('Assessment deleted.')
      logAssessmentDeletion({
        event: 'assessment_delete',
        assessmentId: assessment.id,
        userId: uid,
        deletionMode: 'permanent',
        source: 'assessment-studio',
        startedAt,
        completedAt: Date.now(),
        success: true,
      })
    } catch (err) {
      // The delete failed — the paper still exists, so lift the tombstone
      // (which makes the row reappear via the filter) and show a clear error.
      unmarkAssessmentDeleted(assessment.id)
      toast.error(`Delete failed: ${err.message || 'unexpected error'}`)
      logAssessmentDeletion({
        event: 'assessment_delete',
        assessmentId: assessment.id,
        userId: uid,
        deletionMode: 'permanent',
        source: 'assessment-studio',
        startedAt,
        completedAt: Date.now(),
        success: false,
        errorCode: err?.code || err?.message || 'unknown',
      })
    } finally {
      deletingLocallyRef.current.delete(assessment.id)
      setBusyId(null)
      setPendingDelete(null)
    }
  }

  async function handleExport(assessment, format, mode, win = null) {
    try {
      const questions = await getAssessmentQuestions(assessment.id)
      if (!questions || questions.length === 0) {
        toast.error('This assessment has no questions to export yet.')
        return
      }
      // The SAME readiness decision the studio makes, before any route to a
      // file. Exporting from this list used to bypass every blocking rule the
      // studio enforced — an unfinished question or a diagram the catalog
      // cannot draw sailed straight through to Word, PDF and print.
      //
      // Checked BEFORE the branded server download below, not after: that path
      // is the one a teacher actually gets, and the server's only content check
      // is "does this paper have any questions at all". A gate placed after it
      // would guard the fallback and leave the main road open.
      const { gate } = buildSavedAssessmentExportReadiness(assessment, questions, renderDiagramSvg)
      if (gate.blocked) {
        toast.error(gate.message)
        // A print window is opened before this handler runs so the browser does
        // not treat it as a popup. Blocked means no export, so it must not be
        // left standing empty.
        try { win?.close() } catch { /* already gone */ }
        return
      }
      const variant = mode === 'paper' ? undefined : 'Marking Key'
      if (format === 'docx') {
        // Branded, cached download first: stream the pre-generated Word file
        // FROM zedexams.com (no client generation, no firebasestorage URL). Fall
        // back to the in-browser build if the server path is unavailable.
        try {
          const { startBrandedDownload } = await import('../../utils/assessmentExportClient')
          await startBrandedDownload({ assessmentId: assessment.id, exportType: mode === 'paper' ? 'paper-docx' : 'scheme-docx' })
          toast.success(mode === 'paper' ? 'Paper download started.' : 'Marking scheme download started.')
          return
        } catch { /* fall through to the in-browser download */ }
        const { downloadAssessmentDocx } = await import('../../utils/assessmentToDocx')
        await downloadAssessmentDocx(assessment, questions, assessmentFileName(assessment, variant), { mode, attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
        toast.success(mode === 'paper' ? 'Paper download started.' : 'Marking scheme download started.')
      } else {
        // Pass the pre-opened window so the browser doesn't treat this as a
        // popup (window.open was already called before the async fetch above).
        // Free-plan prints carry the same attribution as the Word export.
        printAssessmentAsPdf(assessment, questions, { mode, win, attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
      }
    } catch (err) {
      toast.error(`Export failed: ${err.message || 'unexpected error'}`)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(n => (
          <Skeleton key={n} height={96} className="!rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <SeoHelmet title={cfg.NounPlural} noIndex />
      {/* Page header — brand on the left, action on the right */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to="/teacher" className="flex items-center gap-2.5 no-underline" style={{ color: 'var(--zt-text)' }}>
          <span style={{ fontSize: 22 }}>🦅</span>
          <div className="leading-tight">
            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 16, margin: 0, color: 'var(--zt-text)' }}>
              ZedExams <span style={{ color: '#d97757' }}>•</span>
            </p>
            <p style={{ fontSize: 11.5, color: 'var(--zt-text-muted)', margin: 0, fontWeight: 600 }}>
              {cfg.studioName}
            </p>
          </div>
        </Link>
        <Link
          to="/teacher"
          className="inline-flex items-center gap-2 rounded-xl border-2 font-bold no-underline transition-colors"
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-card-border)', color: 'var(--zt-text)', padding: '8px 14px', fontSize: 13 }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f5efe1' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--zt-card)' }}
        >
          ← Dashboard
        </Link>
      </div>

      {/* Dark brand hero */}
      <div
        className="rounded-3xl p-7 sm:p-9 mb-8 flex items-center gap-6 flex-wrap"
        style={{ background: 'linear-gradient(135deg, #0e2a32 0%, #16505d 100%)', color: '#fff', boxShadow: '0 12px 32px rgba(14,42,50,.18)' }}
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <span
            className="inline-flex items-center gap-2 mb-3 rounded-full text-xs font-bold uppercase tracking-wider"
            style={{ background: '#d97757', color: '#fff', padding: '7px 14px' }}
          >
            🦅 Sharp Eagle
          </span>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 36, lineHeight: 1.05, margin: '0 0 8px', letterSpacing: '-.3px' }}>
            {cfg.heroTitle}
          </h1>
          <p style={{ fontSize: 14.5, opacity: .88, marginBottom: 16, maxWidth: 520, lineHeight: 1.55 }}>
            Topic tests, weekly tests, end-of-term tests, mock examinations, and formal
            examination papers you've created for your class — private to you, never
            shown to learners. Download as Word (.docx), print, or open the marking scheme.
          </p>
          <div className="flex gap-4 flex-wrap mb-5" style={{ fontSize: 13, opacity: .78, fontWeight: 500 }}>
            <span>📝 Word (.docx) export</span>
            <span>🗒️ Marking scheme</span>
            <span>🔒 Teacher-private</span>
          </div>
          <button
            type="button"
            onClick={() => navigate(`${cfg.routeBase}/new`)}
            className="inline-flex items-center gap-2.5 rounded-2xl font-bold no-underline transition-colors"
            style={{ background: '#d97757', color: '#fff', padding: '13px 22px', fontSize: 14.5, border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#c5613f' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#d97757' }}
          >
            ▶ New {cfg.noun}
          </button>
        </div>
        <div
          className="flex-shrink-0 hidden sm:grid place-items-center"
          style={{ width: 150, height: 150, borderRadius: '50%', background: 'var(--zt-card)', fontSize: 68, boxShadow: '0 8px 28px rgba(0,0,0,.25)' }}
        >
          🦅
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-5">
          {error}
        </div>
      )}

      {assessments.length === 0 ? (
        <div
          className="text-center py-12 rounded-2xl border-2 border-dashed"
          style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-line)' }}
        >
          <div style={{ fontSize: 40, marginBottom: 12, opacity: .5 }}>📂</div>
          <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 17, color: 'var(--zt-text)', marginBottom: 6 }}>
            No {cfg.nounPlural} yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--zt-text-muted)', margin: '0 0 16px' }}>
            Create your first topic test, end-of-term test, or examination paper.
          </p>
          <button
            type="button"
            onClick={() => navigate(`${cfg.routeBase}/new`)}
            className="inline-flex items-center gap-2 rounded-xl font-bold transition-colors"
            style={{ background: '#d97757', color: '#fff', border: 'none', cursor: 'pointer', padding: '10px 18px', fontSize: 14 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#c5613f' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#d97757' }}
          >
            + Create {cfg.noun}
          </button>
        </div>
      ) : (
          <>
            <div className="flex items-center gap-2.5 mb-3" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#d97757' }}>
              <span style={{ width: 32, height: 3, background: '#d97757', borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
              Saved
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label="Filter by category">
              {CATEGORY_FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setCategoryFilter(f.value)}
                  aria-pressed={categoryFilter === f.value}
                  className="rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors"
                  style={{
                    borderColor: categoryFilter === f.value ? 'var(--zt-sidebar-bg)' : 'var(--zt-line)',
                    background: categoryFilter === f.value ? 'var(--zt-sidebar-bg)' : 'var(--zt-card)',
                    color: categoryFilter === f.value ? 'var(--zt-on-dark)' : 'var(--zt-text)',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
              <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 24, color: 'var(--zt-text)', margin: 0 }}>
                {needsReviewOnly
                  ? `${visible.length} of ${byCategory.length}${hasNextPage ? '+' : ''} need review`
                  : `${byCategory.length}${hasNextPage ? '+' : ''} ${cfg.noun}${byCategory.length === 1 && !hasNextPage ? '' : 's'}`}
              </h2>
              <button
                type="button"
                onClick={() => setNeedsReviewOnly(v => !v)}
                aria-pressed={needsReviewOnly}
                // Only disable once the whole library is loaded and still shows
                // nothing to review — while more pages remain, a flagged import
                // could be on one of them, so keep the chip enabled.
                disabled={!needsReviewOnly && needsReviewCount === 0 && fullyLoaded}
                className="rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  borderColor: needsReviewOnly ? '#d97706' : 'var(--zt-line)',
                  background: needsReviewOnly ? '#fef3c7' : '#fff',
                  color: needsReviewOnly ? '#92400e' : 'var(--zt-text)',
                }}
                title={needsReviewOnly
                  ? `Click to show all ${cfg.nounPlural}`
                  : needsReviewCount > 0
                    ? `${needsReviewCount}${hasNextPage ? '+' : ''} imported ${cfg.noun}${needsReviewCount === 1 && !hasNextPage ? '' : 's'} flagged for review`
                    : hasNextPage
                      ? 'Load more to check the rest of your library for imports needing review'
                      : 'No imports currently need review'}
              >
                ⚠️ Needs review
                {needsReviewCount > 0 && (
                  <span
                    className="ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-black text-white min-w-[20px]"
                    style={{ background: '#d97706' }}
                  >
                    {needsReviewCount}
                  </span>
                )}
              </button>
            </div>
            <div className="space-y-3">
              {visible.map(a => (
                <AssessmentRow
                  key={a.id}
                  assessment={a}
                  onDelete={setPendingDelete}
                  onExport={handleExport}
                  busy={busyId === a.id}
                  routeBase={cfg.routeBase}
                  fallbackLabel={cfg.Noun}
                />
              ))}
            </div>

            {/* Load-More paging — pulls the next page from the full library
                regardless of the Test/Examination or Needs-review view filter.
                Existing rows stay visible while the next page loads (§8/§9). */}
            <PaginationFooter
              hasNextPage={hasNextPage}
              isLoadingNextPage={isLoadingNextPage}
              error={pageError}
              onLoadMore={loadNextPage}
              loadedCount={assessments.length}
              noun={cfg.noun}
              nounPlural={cfg.nounPlural}
            />
            {/* While pages are still auto-loading to satisfy an active filter,
                say so — never claim "none" for rows that just haven't loaded. */}
            {filterActive && visible.length === 0 && !fullyLoaded && (
              <p className="text-center text-sm font-bold mt-6" style={{ color: 'var(--zt-text-muted)' }}>
                Searching the rest of your library…
              </p>
            )}
            {needsReviewOnly && visible.length === 0 && fullyLoaded && (
              <p className="text-center text-sm font-bold mt-6" style={{ color: 'var(--zt-text-muted)' }}>
                No {cfg.nounPlural} need review right now. Click the chip again to see all of them.
              </p>
            )}
            {!needsReviewOnly && byCategory.length === 0 && fullyLoaded && (
              <p className="text-center text-sm font-bold mt-6" style={{ color: 'var(--zt-text-muted)' }}>
                No {categoryFilter === 'test' ? 'tests' : 'examinations'} yet — try the "All" filter or create one.
              </p>
            )}
          </>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete this ${cfg.noun}?`}
        message={<>You're about to permanently delete <strong className="theme-text">"{pendingDelete?.title || `this ${cfg.noun}`}"</strong>. This cannot be undone.</>}
        confirmLabel="Delete"
        variant="danger"
        loading={Boolean(pendingDelete) && busyId === pendingDelete.id}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
