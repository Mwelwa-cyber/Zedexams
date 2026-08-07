import { useState, useMemo, useEffect, useRef } from 'react'
import { where } from 'firebase/firestore'
import { Link, useNavigate } from 'react-router-dom'
import {
  ClipboardList, Search, ChevronDown, MoreHorizontal, Download, Plus,
  TriangleAlert, FolderOpen, Copy, Pencil, Trash2, FileText, FileType2,
} from 'lucide-react'
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
import SeoHelmet from '../seo/SeoHelmet'
import Skeleton from '../ui/Skeleton'
import PaginationFooter from '../ui/PaginationFooter'
import MenuButton, { MenuItem } from '../ui/MenuButton'
import { useToast } from '../ui/Toast'
import ConfirmDialog from '../ui/ConfirmDialog'
import { ASSESSMENT_TYPE_LABELS } from './assessmentStudioMeta'
import { assessmentCategory } from './paperTaxonomy'
import { paperCardTitle, paperDisplayFacts } from './paperDisplayTitle'
import { SubjectTile } from './subjectIcons'
import { buildSavedAssessmentExportReadiness } from '../../utils/assessmentExportReadiness'
import { renderDiagramSvg } from '../diagrams/diagramCatalog'
import './assessmentLibrary.css'

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

/**
 * Everything the search box matches against — the words a teacher would type
 * to find this paper. Built from the DERIVED facts rather than the stored
 * title, so searching "Term 2" finds the paper whose stored title still says
 * Term 1 (the same drift the card title corrects).
 */
function paperSearchText(assessment) {
  const facts = paperDisplayFacts(assessment)
  return [
    paperCardTitle(assessment),
    facts.level,
    facts.subject,
    facts.type,
    facts.year,
    assessment.className,
    facts.term ? `term ${facts.term} t${facts.term}` : '',
  ].filter(Boolean).join(' ').toLowerCase()
}

function PaperCard({ assessment, onDelete, onRename, onDuplicate, onExport, busy, routeBase }) {
  const id = assessment.id
  const typeLabel = ASSESSMENT_TYPE_LABELS[assessment.assessmentType] || 'Assessment paper'
  const [exporting, setExporting] = useState(null)
  const toast = useToast()
  const needsReview = summarizeImportReview(assessment).needsReview
  const facts = paperDisplayFacts(assessment)

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

  // "Updated" only. The card used to print both dates plus the question count,
  // which is three facts competing for the one line a teacher scans.
  const updated = assessment.updatedAt || assessment.createdAt

  return (
    <div className="zt-paper-card">
      <SubjectTile subject={assessment.subject} />

      <div className="zt-paper-card-body">
        <p className="zt-paper-card-title">{paperCardTitle(assessment)}</p>
        <div className="zt-paper-card-chips">
          <span className="zt-pill zt-pill-neutral">
            {typeLabel}{facts.term ? ` · T${facts.term}` : ''}
          </span>
          {assessment.totalMarks != null && (
            <span className="zt-pill zt-pill-warn">{assessment.totalMarks} marks</span>
          )}
          {assessment.duration != null && (
            <span className="zt-pill zt-pill-info">{assessment.duration} min</span>
          )}
          <span className="zt-pill zt-pill-neutral">
            {assessment.questionCount ?? 0} question{(assessment.questionCount ?? 0) === 1 ? '' : 's'}
          </span>
          {needsReview && (
            <span className="zt-pill zt-pill-bad">
              <TriangleAlert size={12} aria-hidden="true" /> Needs review
            </span>
          )}
        </div>
        <p className="zt-paper-card-meta">Updated {formatDate(updated)}</p>
      </div>

      <div className="zt-paper-card-actions">
        <Link
          to={`${routeBase}/${id}/edit`}
          className="zt-btn zt-btn-primary zt-btn-sm"
          style={{ textDecoration: 'none' }}
        >
          Open
        </Link>

        <MenuButton
          triggerClassName="zt-btn zt-btn-secondary zt-btn-sm"
          disabled={Boolean(exporting) || busy}
          label={<>
            <Download size={14} aria-hidden="true" />
            {exporting ? 'Preparing…' : 'Download'}
            <ChevronDown size={14} aria-hidden="true" />
          </>}
          title={`Download ${paperCardTitle(assessment)}`}
        >
          {({ close }) => (
            <>
              <MenuItem
                icon={<FileText size={15} aria-hidden="true" />}
                onClick={() => { close(); handleExport('docx', 'paper') }}
              >Paper (Word)</MenuItem>
              <MenuItem
                icon={<FileType2 size={15} aria-hidden="true" />}
                onClick={() => { close(); handleExport('pdf', 'paper') }}
              >Paper (PDF)</MenuItem>
              <MenuItem
                icon={<ClipboardList size={15} aria-hidden="true" />}
                onClick={() => { close(); handleExport('docx', 'scheme') }}
              >Marking scheme (Word)</MenuItem>
            </>
          )}
        </MenuButton>

        {/* Destructive actions never sit as buttons on the card — Delete lives
            here and then asks. */}
        <MenuButton
          triggerClassName="zt-btn zt-btn-quiet zt-btn-sm zt-btn-icon"
          ariaLabel={`More actions for ${paperCardTitle(assessment)}`}
          disabled={busy}
          label={<MoreHorizontal size={17} aria-hidden="true" />}
        >
          {({ close }) => (
            <>
              <MenuItem
                icon={<Copy size={15} aria-hidden="true" />}
                onClick={() => { close(); onDuplicate(assessment) }}
              >Duplicate</MenuItem>
              <MenuItem
                icon={<Pencil size={15} aria-hidden="true" />}
                onClick={() => { close(); onRename(assessment) }}
              >Rename</MenuItem>
              <div className="zt-menu-sep" />
              <MenuItem
                danger
                icon={<Trash2 size={15} aria-hidden="true" />}
                onClick={() => { close(); onDelete(assessment) }}
              >Delete</MenuItem>
            </>
          )}
        </MenuButton>
      </div>
    </div>
  )
}

// Static studio identity, shared with AssessmentStudio.jsx — one unified
// library shows every assessment paper (tests AND examinations) from the one
// `assessments` collection; the category filter below narrows the VIEW, it
// never scopes the query into two disjoint libraries.
const STUDIO_COPY = {
  studioName: 'Assessment Studio',
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
  const {
    getAssessmentQuestions, deleteAssessment, updateAssessment,
    createAssessment, saveAssessmentQuestions,
  } = useFirestore()
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
  const [search, setSearch] = useState('')
  // Assessment queued for deletion / rename — drives the dialogs.
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingRename, setPendingRename] = useState(null)
  const [renameText, setRenameText] = useState('')
  // Bumped whenever the deletion registry changes (a local delete, or another
  // tab's) so the filtered views below recompute and drop tombstoned rows even
  // if a page loaded after the delete re-introduced one from a stale cache.
  const [deletionVersion, setDeletionVersion] = useState(0)
  // Titles renamed this session, applied over the loaded pages. The pagination
  // hook can remove a row but not rewrite one, and refetching the whole library
  // to show one new name would throw away every page the teacher has loaded.
  const [renamedTitles, setRenamedTitles] = useState({})

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
  // Defensive last line against resurrection: never render a paper whose id is
  // tombstoned this session, even if a page loaded after the delete returned it
  // from Firestore's offline cache. deletionVersion re-runs this whenever the
  // registry changes.
  const live = useMemo(
    () => filterDeleted(assessments).map(a => (
      renamedTitles[a.id]
        ? { ...a, title: renamedTitles[a.id], titleSource: 'manual' }
        : a
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assessments, deletionVersion, renamedTitles],
  )

  // Counts sit ON the filter chips, so a teacher can see how their library
  // splits without clicking through each filter to find out.
  const counts = useMemo(() => ({
    all: live.length,
    test: live.filter(a => assessmentCategory(a.assessmentType) === 'test').length,
    examination: live.filter(a => assessmentCategory(a.assessmentType) === 'examination').length,
  }), [live])

  const byCategory = useMemo(
    () => (categoryFilter === 'all'
      ? live
      : live.filter(a => assessmentCategory(a.assessmentType) === categoryFilter)),
    [live, categoryFilter],
  )
  const needsReviewCount = useMemo(
    () => byCategory.reduce((n, a) => (summarizeImportReview(a).needsReview ? n + 1 : n), 0),
    [byCategory],
  )
  const searchTerm = search.trim().toLowerCase()
  const visible = useMemo(
    () => {
      const scoped = needsReviewOnly
        ? byCategory.filter(a => summarizeImportReview(a).needsReview)
        : byCategory
      if (!searchTerm) return scoped
      return scoped.filter(a => paperSearchText(a).includes(searchTerm))
    },
    [byCategory, needsReviewOnly, searchTerm],
  )
  const filterActive = categoryFilter !== 'all' || needsReviewOnly || Boolean(searchTerm)
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

  function openRename(assessment) {
    setPendingRename(assessment)
    // Seed with the name the teacher currently READS, so renaming starts from
    // what is on the card rather than from a stored string they never saw.
    setRenameText(paperCardTitle(assessment))
  }

  async function confirmRename() {
    const assessment = pendingRename
    const title = renameText.trim()
    if (!assessment || !title) return
    setBusyId(assessment.id)
    try {
      // `titleSource: 'manual'` is the flag the title backfill and the phantom
      // cleanup both honour — it is what stops a migration rewriting a name a
      // teacher chose.
      await updateAssessment(assessment.id, { title, titleSource: 'manual' })
      setRenamedTitles(prev => ({ ...prev, [assessment.id]: title }))
      toast.success('Paper renamed.')
    } catch (err) {
      toast.error(`Rename failed: ${err.message || 'unexpected error'}`)
    } finally {
      setBusyId(null)
      setPendingRename(null)
    }
  }

  async function handleDuplicate(assessment) {
    setBusyId(assessment.id)
    try {
      const questions = await getAssessmentQuestions(assessment.id)
      // Copy the paper's own fields only. The document id, the server
      // timestamps and the questionCount are re-established by the write path;
      // carrying them over would file a copy that claims to be the original.
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = assessment
      const copyTitle = `${paperCardTitle(assessment)} (copy)`
      const newId = await createAssessment({
        ...fields,
        title: copyTitle,
        titleSource: 'manual',
        createdBy: uid,
        questionCount: questions.length,
      })
      if (questions.length) {
        // Strip the source question ids — these are NEW documents in a new
        // subcollection, and a carried-over id is the one field that could make
        // the copy write over its original.
        await saveAssessmentQuestions(newId, questions.map(({ id: _qid, ...q }) => q))
      }
      toast.success('Paper duplicated — opening the copy.')
      navigate(`${cfg.routeBase}/${newId}/edit`)
    } catch (err) {
      toast.error(`Duplicate failed: ${err.message || 'unexpected error'}`)
    } finally {
      setBusyId(null)
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
      <div className="zt-lib space-y-3">
        {[1, 2, 3].map(n => (
          <Skeleton key={n} height={96} className="!rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="zt-lib">
      <SeoHelmet title={cfg.NounPlural} noIndex />

      {/* Compact header band. This replaced a ~450px dark hero (with a codename
          badge and a mascot) that pushed every paper below the fold on a
          1366×768 laptop — the library's whole job is to show the papers. */}
      <header className="zt-lib-header">
        <span className="zt-lib-header-icon">
          <ClipboardList size={27} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="zt-lib-header-body">
          <span className="zt-lib-eyebrow">Assessment Studio</span>
          <h1 className="zt-lib-title">{cfg.heroTitle}</h1>
          <p className="zt-lib-lede">
            Topic tests, end-of-term tests and exams for your class — private to you,
            never shown to learners.
          </p>
          <p className="zt-lib-meta">Word &amp; PDF export · Marking scheme · Teacher-private</p>
        </div>
        <div className="zt-lib-header-action">
          <button
            type="button"
            className="zt-btn zt-btn-primary"
            onClick={() => navigate(`${cfg.routeBase}/new`)}
          >
            <Plus size={16} aria-hidden="true" /> New paper
          </button>
        </div>
      </header>

      {error && <div className="zt-lib-error">{error}</div>}

      {assessments.length === 0 ? (
        <div className="zt-lib-empty">
          <FolderOpen size={38} strokeWidth={1.6} aria-hidden="true" style={{ opacity: 0.5 }} />
          <h2>No {cfg.nounPlural} yet</h2>
          <p>Create your first topic test, end-of-term test, or examination paper.</p>
          <button
            type="button"
            className="zt-btn zt-btn-primary"
            onClick={() => navigate(`${cfg.routeBase}/new`)}
          >
            <Plus size={16} aria-hidden="true" /> Create {cfg.noun}
          </button>
        </div>
      ) : (
        <>
          <div className="zt-lib-toolbar">
            <div
              role="group"
              aria-label="Filter by category"
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            >
              {CATEGORY_FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  className="zt-lib-chip"
                  onClick={() => setCategoryFilter(f.value)}
                  aria-pressed={categoryFilter === f.value}
                >
                  {/* The space is deliberate: without a text node between the
                      label and the count, the accessible name comes out as
                      "All· 2". Layout spacing is the flex gap's job. */}
                  {f.label}{' '}
                  <span className="zt-chip-count">· {counts[f.value]}{hasNextPage ? '+' : ''}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="zt-lib-chip zt-lib-chip-warn"
              onClick={() => setNeedsReviewOnly(v => !v)}
              aria-pressed={needsReviewOnly}
              // Only disable once the whole library is loaded and still shows
              // nothing to review — while more pages remain, a flagged import
              // could be on one of them, so keep the chip enabled.
              disabled={!needsReviewOnly && needsReviewCount === 0 && fullyLoaded}
              title={needsReviewOnly
                ? `Click to show all ${cfg.nounPlural}`
                : needsReviewCount > 0
                  ? `${needsReviewCount}${hasNextPage ? '+' : ''} imported ${cfg.noun}${needsReviewCount === 1 && !hasNextPage ? '' : 's'} flagged for review`
                  : hasNextPage
                    ? 'Load more to check the rest of your library for imports needing review'
                    : 'No imports currently need review'}
            >
              <TriangleAlert size={13} aria-hidden="true" />
              Needs review{' '}
              <span className="zt-chip-count">· {needsReviewCount}{hasNextPage ? '+' : ''}</span>
            </button>

            <div className="zt-lib-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search papers…"
                aria-label={`Search ${cfg.nounPlural}`}
              />
            </div>
          </div>

          <div className="zt-paper-list">
            {visible.map(a => (
              <PaperCard
                key={a.id}
                assessment={a}
                onDelete={setPendingDelete}
                onRename={openRename}
                onDuplicate={handleDuplicate}
                onExport={handleExport}
                busy={busyId === a.id}
                routeBase={cfg.routeBase}
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
            <p className="zt-lib-note">Searching the rest of your library…</p>
          )}
          {filterActive && visible.length === 0 && fullyLoaded && (
            <p className="zt-lib-note">
              {searchTerm
                ? `No ${cfg.nounPlural} match “${search.trim()}”.`
                : needsReviewOnly
                  ? `No ${cfg.nounPlural} need review right now. Click the chip again to see all of them.`
                  : `No ${categoryFilter === 'test' ? 'tests' : 'examinations'} yet — try the “All” filter or create one.`}
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete this ${cfg.noun}?`}
        message={<>You&apos;re about to permanently delete <strong className="theme-text">&quot;{pendingDelete ? paperCardTitle(pendingDelete) : `this ${cfg.noun}`}&quot;</strong>. This cannot be undone.</>}
        confirmLabel="Delete"
        variant="danger"
        loading={Boolean(pendingDelete) && busyId === pendingDelete.id}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingRename)}
        title="Rename this paper"
        message={(
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
            Paper name
            <input
              type="text"
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              style={{
                display: 'block', width: '100%', marginTop: 6, padding: '9px 11px',
                borderRadius: 10, border: '1.5px solid var(--zt-line)',
                background: 'var(--zt-card)', color: 'var(--zt-text)',
                fontSize: 14, fontWeight: 500,
              }}
            />
          </label>
        )}
        confirmLabel="Rename"
        variant="primary"
        loading={Boolean(pendingRename) && busyId === pendingRename.id}
        onConfirm={confirmRename}
        onCancel={() => setPendingRename(null)}
      />
    </div>
  )
}
