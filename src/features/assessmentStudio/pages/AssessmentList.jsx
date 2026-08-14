import { useState, useMemo, useEffect, useRef } from 'react'
import { where } from 'firebase/firestore'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardList, Search, FileText, Download, MoreHorizontal, Trash2 } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import { db } from '../../../firebase/config'
import { usePaginatedQuery } from '../../../hooks/usePaginatedQuery'
import { createFirestorePageFetcher } from '../services/firestorePage'
import { createPaginationKey } from '../lib/queryKeys'
import { PAGE_SIZES } from '../../../utils/pagination/cursors'
import { buildAssessmentName } from '../../../utils/downloadFilename'
import { isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { printAssessmentAsPdf, openPrintWindow } from '../../../utils/assessmentToPdf'
import { summarizeImportReview } from '../../../utils/importReviewSummary.js'
import {
  markAssessmentDeleted,
  unmarkAssessmentDeleted,
  subscribeAssessmentDeletion,
  logAssessmentDeletion,
  filterDeleted,
} from '../../../utils/assessmentDeletion'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'
import PaginationFooter from '../../../shared/components/PaginationFooter'
import { useToast } from '../../../shared/components/Toast'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import Chip from '../../../shared/components/Chip'
import ActionMenu from '../../../shared/components/ActionMenu'
import StudioPageHeader from '../../../shared/components/StudioPageHeader'
import { subjectVisual } from '../lib/subjectVisuals'
import { ASSESSMENT_TYPE_LABELS } from '../../../components/teacher/assessmentStudioMeta'
import { assessmentCategory } from '../../../components/teacher/paperTaxonomy'
import { readPaperTerm } from '../../../components/teacher/assessmentTitle'
import { paperCardTitle } from '../lib/paperNaming'
import { buildSavedAssessmentExportReadiness } from '../../../utils/assessmentExportReadiness'
import { renderDiagramSvg } from '../../../components/diagrams/diagramCatalog'

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
  const term = readPaperTerm(assessment)
  const review = summarizeImportReview(assessment)
  const visual = subjectVisual(assessment.subject)
  const SubjectIcon = visual.icon
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
    <div className="studio-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        {/* Subject icon tile — colour-coded so a subject keeps one identity
            across chips, tiles and palette pills. */}
        <div
          className="flex flex-shrink-0 items-center justify-center rounded-xl"
          style={{ width: 46, height: 46, background: visual.bg, color: visual.fg }}
          aria-hidden="true"
        >
          <SubjectIcon size={22} />
        </div>
        <div className="min-w-0 flex-1 basis-52">
          <p className="font-black text-sm leading-snug" style={{ color: 'var(--zt-text)', margin: 0 }}>
            {paperCardTitle(assessment, { fallbackLabel })}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip variant="neutral">{typeLabel}{term ? ` · T${term}` : ''}</Chip>
            {assessment.totalMarks != null && <Chip variant="amber">{assessment.totalMarks} marks</Chip>}
            {assessment.duration != null && <Chip variant="blue">{assessment.duration} min</Chip>}
            <Chip variant="neutral">{assessment.questionCount ?? 0} questions</Chip>
            {/* Phase 7: surface import-review state on the list so the teacher
                doesn't have to open every imported draft to find the ones that
                flagged warnings during parsing. One red chip, not a chip AND
                the old badge. */}
            {review.needsReview && (
              <Chip variant="red" title={review.sampleWarnings?.[0]}>⚠ Needs review</Chip>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--zt-text-muted)', margin: '6px 0 0' }}>
            {assessment.updatedAt
              ? `Updated ${formatDate(assessment.updatedAt)}`
              : `Created ${formatDate(assessment.createdAt)}`}
          </p>
        </div>

        {/* Max three visible actions; destructive ones live behind the kebab.
            flex-wrap lets the whole row drop below the text on narrow screens. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`${routeBase}/${id}/edit`}
            className="studio-btn-primary text-xs no-underline"
            style={{ padding: '8px 14px', borderRadius: 12 }}
          >
            Open
          </Link>
          <ActionMenu
            label={exporting ? (exporting === 'pdf-paper' ? 'Opening…' : 'Building…') : 'Download'}
            icon={Download}
            caret
            disabled={!!exporting || busy}
            buttonClassName="studio-btn-ghost !px-3.5 !py-2 text-xs"
            items={[
              { label: 'Paper (Word)', icon: FileText, onSelect: () => handleExport('docx', 'paper') },
              // The PDF item opens its print window synchronously inside
              // handleExport, before any await — see the comment there.
              { label: 'Paper (PDF)', icon: FileText, onSelect: () => handleExport('pdf', 'paper') },
              { label: 'Marking scheme (Word)', icon: FileText, onSelect: () => handleExport('docx', 'scheme') },
            ]}
          />
          <ActionMenu
            icon={MoreHorizontal}
            ariaLabel="More actions"
            disabled={busy}
            buttonClassName="studio-btn-ghost !px-2.5 !py-2 text-xs"
            items={[
              { label: 'Delete', icon: Trash2, danger: true, onSelect: () => onDelete(assessment) },
            ]}
          />
        </div>
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
  // Client-side text search over the ALREADY-LOADED rows (title/subject/type).
  const [searchQuery, setSearchQuery] = useState('')
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
  //
  // Defensive last line against resurrection: never render a paper whose id
  // is tombstoned this session, even if a page loaded after the delete
  // returned it from Firestore's offline cache. deletionVersion re-runs this
  // whenever the registry changes.
  const loadedRows = useMemo(
    () => filterDeleted(assessments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assessments, deletionVersion],
  )
  // Per-category counts for the toolbar chips — counts of the LOADED rows, so
  // while more pages remain they render with a trailing "+".
  const categoryCounts = useMemo(() => {
    const counts = { all: loadedRows.length, test: 0, examination: 0 }
    for (const a of loadedRows) {
      const cat = assessmentCategory(a.assessmentType)
      if (counts[cat] != null) counts[cat] += 1
    }
    return counts
  }, [loadedRows])
  const byCategory = useMemo(
    () => (categoryFilter === 'all'
      ? loadedRows
      : loadedRows.filter(a => assessmentCategory(a.assessmentType) === categoryFilter)),
    [loadedRows, categoryFilter],
  )
  const needsReviewCount = useMemo(
    () => byCategory.reduce((n, a) => (summarizeImportReview(a).needsReview ? n + 1 : n), 0),
    [byCategory],
  )
  const visible = useMemo(
    () => (needsReviewOnly ? byCategory.filter(a => summarizeImportReview(a).needsReview) : byCategory),
    [byCategory, needsReviewOnly],
  )
  // Search runs ON TOP of the category/needs-review view. It deliberately does
  // NOT feed the auto-continue effect below — a non-matching keystroke must
  // not walk the whole library.
  const searchText = searchQuery.trim().toLowerCase()
  const searched = useMemo(() => {
    if (!searchText) return visible
    return visible.filter(a => [
      a.title,
      paperCardTitle(a, { fallbackLabel: cfg.Noun }),
      a.subject,
      ASSESSMENT_TYPE_LABELS[a.assessmentType],
    ].filter(Boolean).join(' ').toLowerCase().includes(searchText))
  }, [visible, searchText, cfg.Noun])
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
          const { startBrandedDownload } = await import('../../../utils/assessmentExportClient')
          await startBrandedDownload({ assessmentId: assessment.id, exportType: mode === 'paper' ? 'paper-docx' : 'scheme-docx' })
          toast.success(mode === 'paper' ? 'Paper download started.' : 'Marking scheme download started.')
          return
        } catch { /* fall through to the in-browser download */ }
        const { downloadAssessmentDocx } = await import('../../../utils/assessmentToDocx')
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

      <StudioPageHeader
        eyebrow="Assessment Studio"
        title={cfg.heroTitle}
        subtitle="Topic tests, end-of-term tests and exams for your class — private to you, never shown to learners."
        icon={ClipboardList}
        metaItems={['Word & PDF export', 'Marking scheme', 'Teacher-private']}
        backTo="/teacher"
        backLabel="Dashboard"
        primaryAction={(
          <button
            type="button"
            className="studio-btn-primary"
            onClick={() => navigate(`${cfg.routeBase}/new`)}
          >
            + New paper
          </button>
        )}
      />

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
          <div className="mx-auto mb-3 flex items-center justify-center" style={{ color: 'var(--zt-text-muted)' }}>
            <FileText size={40} aria-hidden="true" />
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--zt-text)', margin: '0 0 6px' }}>
            No {cfg.nounPlural} yet
          </p>
          <p className="text-[13px]" style={{ color: 'var(--zt-text-muted)', margin: '0 0 16px' }}>
            Create your first topic test, end-of-term test, or examination paper.
          </p>
          <button
            type="button"
            className="studio-btn-primary"
            onClick={() => navigate(`${cfg.routeBase}/new`)}
          >
            + New paper
          </button>
        </div>
      ) : (
          <>
            {/* Toolbar — one row: category chips + needs-review chip on the
                left, search on the right. Wraps on narrow screens. */}
            <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter papers">
              {CATEGORY_FILTERS.map(f => {
                const active = categoryFilter === f.value
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setCategoryFilter(f.value)}
                    aria-pressed={active}
                    className="rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors"
                    style={{
                      borderColor: active ? 'var(--zt-sidebar-bg, #22304A)' : 'var(--zt-line)',
                      background: active ? 'var(--zt-sidebar-bg, #22304A)' : 'var(--zt-card)',
                      color: active ? 'var(--zt-on-dark, #ffffff)' : 'var(--zt-text)',
                    }}
                  >
                    {f.label} · {categoryCounts[f.value] ?? 0}{hasNextPage ? '+' : ''}
                  </button>
                )
              })}
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
                  borderColor: 'var(--warning)',
                  background: needsReviewOnly ? 'var(--warning-bg)' : 'var(--zt-card)',
                  color: 'var(--warning-fg)',
                }}
                title={needsReviewOnly
                  ? `Click to show all ${cfg.nounPlural}`
                  : needsReviewCount > 0
                    ? `${needsReviewCount}${hasNextPage ? '+' : ''} imported ${cfg.noun}${needsReviewCount === 1 && !hasNextPage ? '' : 's'} flagged for review`
                    : hasNextPage
                      ? 'Load more to check the rest of your library for imports needing review'
                      : 'No imports currently need review'}
              >
                ⚠ Needs review · {needsReviewCount}{hasNextPage ? '+' : ''}
              </button>
              <div className="relative ml-auto w-full sm:w-64">
                <Search
                  size={15}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--zt-text-muted)' }}
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search papers…"
                  aria-label="Search papers"
                  className="w-full rounded-full border-2 py-1.5 pl-9 pr-3 text-xs font-bold outline-none"
                  style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-line)', color: 'var(--zt-text)' }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--zt-text)', margin: 0 }}>
                {needsReviewOnly
                  ? `${visible.length} of ${byCategory.length}${hasNextPage ? '+' : ''} need review`
                  : `${byCategory.length}${hasNextPage ? '+' : ''} ${cfg.noun}${byCategory.length === 1 && !hasNextPage ? '' : 's'}`}
              </h2>
            </div>

            <div className="space-y-3">
              {searched.map(a => (
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
            {/* Search hides rows client-side only — say so rather than looking
                like an empty library. */}
            {searchText && searched.length === 0 && visible.length > 0 && (
              <p className="text-center text-sm font-bold mt-6" style={{ color: 'var(--zt-text-muted)' }}>
                No {cfg.nounPlural} match "{searchQuery.trim()}".
              </p>
            )}
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
        message={<>You're about to permanently delete <strong className="theme-text">"{pendingDelete ? paperCardTitle(pendingDelete, { fallbackLabel: cfg.Noun }) : `this ${cfg.noun}`}"</strong>. This cannot be undone.</>}
        confirmLabel="Delete"
        variant="danger"
        loading={Boolean(pendingDelete) && busyId === pendingDelete.id}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
