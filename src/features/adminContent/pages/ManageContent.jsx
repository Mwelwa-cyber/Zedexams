import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search, Plus, Download, X, ChevronRight, ChevronDown, Sparkles,
  FileText, BookOpen, ListChecks, Check, FolderOpen,
  Eye, PencilLine, Clock, AlertTriangle, Bot,
  EyeOff, Layers, Calendar, Trash2,
  CheckCircleIcon as CheckCircle, TrophyIcon as Trophy,
} from '../../../shared/components/icons'
import { useFirestore } from '../../../hooks/useFirestore'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import Skeleton from '../../../shared/components/Skeleton'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import { EXAM_ONLY_QUESTION_THRESHOLD, isExamOnly } from '../../../utils/quizClassification.js'
import { summarizeImportReview } from '../../../utils/importReviewSummary.js'
import { describeQuizPaperLink, unassignWarning } from '../lib/quizPaperLink.js'
import { SUBJECTS as CURRICULUM_SUBJECTS } from '../../../config/curriculum'
import {
  PAPER_STATUSES, listAllPapersForAdmin, updatePaper, deletePaper, splitAssetsByRole,
} from '../../../utils/pastPapers'
import { convertPaperToQuizDraft } from '../../../utils/paperToQuizConverter'
import ImportReviewBadge from '../components/ImportReviewBadge'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { PAPER_SUBJECTS } from '../../../config/curriculum'
import { gradesForFeature, gradeNumberOf } from '../../../config/canonicalEducation'

// Three first-class content types share one admin home. Past papers are folded
// in as their own tab (their admin "home") but stay out of the Daily-Exam
// auto-picker and the Practice/Exam-only classification — those rules are for
// our own practice content, not the official ECZ archive.
const TABS = [
  { id: 'quizzes',    label: 'Quizzes',     icon: ListChecks },
  { id: 'lessons',    label: 'Lessons',     icon: BookOpen },
  { id: 'pastpapers', label: 'Past Papers', icon: FileText },
]

const SUBJECT_COLORS = {
  English:             'bg-purple-100 text-purple-700',
  'Integrated Science':'bg-orange-100 text-orange-700',
  Mathematics:         'bg-blue-100   text-blue-700',
  'Social Studies':    'bg-teal-100   text-teal-700',
  'Expressive Art':    'bg-rose-100   text-rose-700',
  'Technology Studies':'bg-cyan-100   text-cyan-700',
  Cinyanja:            'bg-pink-100   text-pink-700',
  // legacy
  Science:             'bg-orange-100 text-orange-700',
  'Expressive Arts':   'bg-rose-100   text-rose-700',
  'Home Economics':    'bg-pink-100   text-pink-700',
}

const STATUS_CFG = {
  published: { label: 'Published', dot: 'bg-green-500',  pill: 'bg-green-100 text-green-700'   },
  pending:   { label: 'Pending',   dot: 'bg-yellow-400', pill: 'bg-yellow-100 text-yellow-700' },
  draft:     { label: 'Draft',     dot: 'bg-gray-400',   pill: 'bg-gray-100 text-gray-600'     },
  archived:  { label: 'Archived',  dot: 'bg-slate-400',  pill: 'bg-slate-200 text-slate-700'   },
  rejected:  { label: 'Rejected',  dot: 'bg-red-500',    pill: 'bg-red-100 text-red-600'       },
}

// Leading '' is the "all subjects" filter option; the rest is the
// learner catalogue, not a second copy of it.
const SUBJECTS = ['', ...PAPER_SUBJECTS.map((s) => s.label)]

const SORTS = [
  { id: 'code',   label: 'Topic code' },
  { id: 'recent', label: 'Recently edited' },
  { id: 'title',  label: 'Title A–Z' },
]

const LS = {
  tab:     'zed:cl:tab',
  sort:    'zed:cl:sort',
  collapsed: 'zed:cl:collapsed',
  banners: 'zed:cl:banners',
}

// Shared surface + control styling. Softer than the old "sticker" look: white
// cards, hairline navy border, a whisper of shadow — orange is reserved for the
// one primary action so it reads as the call-to-action, not decoration.
const SOFT_CARD  = 'rounded-2xl border border-[#0F1B2D]/[0.08] bg-white shadow-[0_1px_2px_rgba(15,27,45,0.05)]'
const SELECT_CLS = 'w-full sm:w-auto rounded-xl border border-[#0F1B2D]/15 bg-white px-3 py-2 text-sm font-bold text-[#0F1B2D] focus:border-[#D97757] focus:outline-none focus:ring-2 focus:ring-[#D97757]/20 transition'

// Tinted icon chips for the stat cards. The "warning" tone is also applied to
// the whole card so "Needs Review" stands out without shouting.
const STAT_TONES = {
  slate:   { chip: 'bg-[#0F1B2D]/[0.07] text-[#0F1B2D]' },
  green:   { chip: 'bg-emerald-100 text-emerald-700' },
  amber:   { chip: 'bg-amber-100 text-amber-700' },
  blue:    { chip: 'bg-blue-100 text-blue-700' },
  pink:    { chip: 'bg-pink-100 text-pink-700' },
  warning: { chip: 'bg-amber-200 text-amber-800', card: 'border-amber-300 bg-amber-50 shadow-[0_1px_2px_rgba(180,83,9,0.08)]' },
}

// ── helpers ────────────────────────────────────────────────────────────────
// Topics are often numbered in CBC style ("6.1 Building Africa Together").
// Parse the leading dotted code so a subject section reads top-to-bottom in
// curriculum order. Items without a code sort to the end of their group.
function parseTopicCode(item) {
  const src = item?.topic || item?.title || ''
  const m = String(src).match(/^\s*(\d+(?:\.\d+)+|\d+)(?=[\s.)–-]|$)/)
  return m ? m[1] : ''
}
function codeSortKey(code) {
  if (!code) return Number.POSITIVE_INFINITY
  return code.split('.').reduce((acc, n, i) => acc + (Number(n) || 0) / Math.pow(1000, i), 0)
}
function editedAt(item) {
  const ts = item?.updatedAt ?? item?.createdAt
  const d = ts?.toDate?.() ?? (ts ? new Date(ts) : null)
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0
}
// Short "x ago" label for the card's last-updated line.
function relativeTime(item) {
  const t = editedAt(item)
  if (!t) return null
  const min = Math.floor((Date.now() - t) / 60000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30)   return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12)  return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
function paperSubjectLabel(p) {
  return CURRICULUM_SUBJECTS.find(s => s.id === p?.subject)?.label || p?.subject || 'Other'
}
function paperStoragePaths(p) {
  return [p.pdfPath, p.markSchemePath, ...((p.assets || []).map(a => a?.path))].filter(Boolean)
}
function sortItems(items, sortBy, tab) {
  const arr = [...items]
  if (sortBy === 'title') {
    arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  } else if (sortBy === 'recent') {
    arr.sort((a, b) => editedAt(b) - editedAt(a))
  } else if (tab === 'pastpapers') {
    // Past papers have no topic code — newest year first reads naturally.
    arr.sort((a, b) => (b.year || 0) - (a.year || 0) || (a.title || '').localeCompare(b.title || ''))
  } else {
    arr.sort((a, b) => {
      const ka = codeSortKey(parseTopicCode(a))
      const kb = codeSortKey(parseTopicCode(b))
      if (ka !== kb) return ka - kb
      return (a.title || '').localeCompare(b.title || '')
    })
  }
  return arr
}

// ── primitives ─────────────────────────────────────────────────────────────
function Pill({ children, color, title }) {
  return <span title={title} className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}>{children}</span>
}

function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft
  return (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 ${cfg.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function Box({ checked, onClick, label }) {
  return (
    <button
      type="button"
      aria-label={label || 'Select'}
      aria-pressed={checked}
      onClick={onClick}
      className={`h-[18px] w-[18px] flex-shrink-0 grid place-items-center rounded-[5px] border-2 transition-colors ${
        checked ? 'bg-[#D97757] border-[#D97757]' : 'bg-white border-[#0F1B2D]/25 hover:border-[#D97757]'
      }`}
    >
      {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </button>
  )
}

// Three-dot glyph for the "More" trigger — no lucide MoreVertical in our set.
function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
    </svg>
  )
}

function MenuItem({ onClick, danger, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-bold transition-colors ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-[#FBF7EF]'
      }`}
    >
      {icon && <Icon as={icon} size="sm" className={danger ? 'text-red-500' : 'text-[#4A5A6E]'} />}
      <span className="flex-1">{children}</span>
    </button>
  )
}

// ── compact status banner ───────────────────────────────────────────────────
// Soft, low-profile alert: a tinted icon chip, a one-line title + short
// explanation, and a single action button on the right.
const BANNER_TONES = {
  info:    { wrap: 'border-sky-200 bg-sky-50',     chip: 'bg-sky-100 text-sky-700',     title: 'text-sky-900',   text: 'text-sky-700' },
  warning: { wrap: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-700', title: 'text-amber-900', text: 'text-amber-700' },
}
function StatusBanner({ tone = 'info', icon, title, desc, action }) {
  const t = BANNER_TONES[tone] ?? BANNER_TONES.info
  return (
    <div className={`flex items-center gap-3 rounded-xl border ${t.wrap} px-3 py-2.5`}>
      <span className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg ${t.chip}`}>
        <Icon as={icon} size="sm" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-black leading-tight ${t.title}`}>{title}</p>
        {desc && <p className={`mt-0.5 text-[11.5px] font-semibold leading-snug ${t.text}`}>{desc}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// Long quizzes (≥ EXAM_ONLY_QUESTION_THRESHOLD questions) are exam-only — they
// never appear in the /quizzes practice library and the daily auto-picker
// skips them. Admins pin them as Daily Exam manually. isExamOnly / the
// threshold live in utils/quizClassification.js so the in-editor publish path
// stays in sync.

// ── compact item card ─────────────────────────────────────────────────────
function Row({ tab, item, selected, onSelect, menuOpen, onMenu, actions, busy }) {
  const id = item.id || item._id || ''
  const code = tab === 'pastpapers' ? '' : parseTopicCode(item)

  // type / status badges per tab
  let badges = null
  let meta = null
  let editTo = '/admin/content'
  let preview = null

  if (tab === 'quizzes') {
    const quizType = item.quizType
    const examOnly = isExamOnly(item)
    const qCount = item.questionCount ?? '?'
    const duration = item.durationMinutes || item.duration || '?'
    // The card reads the denormalised questionCount off the quiz doc, which can
    // drift to 0 while the questions subcollection (and passages) still hold
    // real content — a paper then looks empty and deletable when it isn't. When
    // the count is 0 but other signals say there IS content (a nonzero review
    // count, or embedded passages), flag it as "out of sync" instead of showing
    // a bare "0 Q", and point the admin at the repair script. See
    // scripts/repair-quiz-passages-and-counts.mjs.
    const reviewSignal = Number(item.reviewCount) || 0
    const passageSignal = Number(item.passageCount) || 0
    const countOutOfSync =
      (Number(item.questionCount) || 0) === 0 && (reviewSignal > 0 || passageSignal > 0)
    editTo = id ? `/admin/quizzes/${id}/edit` : '/admin/content'
    preview = id ? { href: `/quiz/${id}`, label: item.isPublished ? 'Preview' : 'Test draft' } : null
    meta = countOutOfSync
      ? `⚠ Count out of sync · ${duration}m`
      : `${qCount} Q · ${duration}m`
    badges = (
      <>
        {countOutOfSync && (
          <Pill color="bg-red-100 text-red-700" title="questionCount is 0 but this paper still has questions/passages saved. Run scripts/repair-quiz-passages-and-counts.mjs to fix the counts and restore passages — it never deletes anything.">
            Needs repair
          </Pill>
        )}
        {quizType === 'daily_exam' && <Pill color="bg-amber-100 text-amber-700">🏆 Daily · {item.dailyExamDate}</Pill>}
        {quizType !== 'daily_exam' && examOnly && item.isPublished && <Pill color="bg-amber-100 text-amber-700">Exam-only</Pill>}
        {quizType === 'practice' && !examOnly && <Pill color="bg-green-100 text-green-700">Practice</Pill>}
        {!quizType && !examOnly && <Pill color="bg-gray-100 text-gray-500">Unclassified</Pill>}
        {!quizType && examOnly && !item.isPublished && <Pill color="bg-gray-100 text-gray-500">Unpublished</Pill>}
        {item.isDemo && <Pill color="bg-sky-100 text-sky-700">Demo</Pill>}
        {item.sourcePastPaperId && <Pill color="bg-violet-100 text-violet-700">From paper</Pill>}
        <ImportReviewBadge record={item} />
      </>
    )
  } else if (tab === 'lessons') {
    const status = item.status ?? (item.isPublished ? 'published' : 'draft')
    editTo = id ? `/admin/lessons/${id}/edit` : '/admin/content'
    meta = item.topic && !code ? item.topic : null
    badges = <StatusPill status={status} />
  } else {
    // pastpapers
    const status = item.status || PAPER_STATUSES.DRAFT
    const ms = splitAssetsByRole(item.assets).markScheme.length > 0 || item.markSchemePath
    editTo = id ? `/admin/papers/${id}/edit` : '/admin/content'
    preview = id ? { href: `/papers/${id}`, label: 'Preview' } : null
    meta = `${item.views || 0} views · ${item.downloads || 0} dl`
    badges = (
      <>
        {item.year && <Pill color="bg-blue-100 text-blue-700">{item.year}</Pill>}
        {item.paperNumber && <Pill color="bg-gray-100 text-gray-600">Paper {item.paperNumber}</Pill>}
        <StatusPill status={status} />
        <Pill color={ms ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}>
          {ms ? '✓ Mark scheme' : 'No scheme'}
        </Pill>
      </>
    )
  }

  const title = item.title || (tab === 'pastpapers' ? `${paperSubjectLabel(item)} ${item.year || ''}`.trim() : 'Untitled')
  const grade = item.grade ? `Grade ${item.grade}` : null
  const subject = tab === 'pastpapers' ? paperSubjectLabel(item) : item.subject
  const updated = relativeTime(item)

  // small visible action buttons — Preview, Edit, More (everything else lives
  // in the More menu so the card stays uncluttered)
  const btnBase = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition'

  return (
    <div
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
        selected
          ? 'bg-[#FFF4EA] ring-2 ring-[#D97757]/60'
          : 'bg-white ring-1 ring-[#0F1B2D]/[0.06] hover:ring-[#0F1B2D]/15'
      }`}
    >
      <span className={selected ? 'opacity-100' : 'opacity-40 group-hover:opacity-100 transition-opacity'}>
        <Box checked={selected} onClick={e => onSelect(id, e.shiftKey)} label={`Select ${title}`} />
      </span>

      <div className="flex-1 min-w-0">
        {/* line 1 — code + title + status badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {code && (
            <span className="font-mono text-[10.5px] font-bold text-gray-500 bg-[#F4F0E7] border border-[#0F1B2D]/10 rounded-md px-1.5 py-px flex-shrink-0">
              {code}
            </span>
          )}
          <span className="font-extrabold text-[#0F1B2D] text-[13.5px] leading-tight truncate max-w-full sm:max-w-[300px]" title={title}>
            {title}
          </span>
          {badges}
        </div>
        {/* line 2 — subject · grade · questions · updated */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {subject && <Pill color={SUBJECT_COLORS[subject] ?? 'bg-gray-100 text-gray-700'}>{subject}</Pill>}
          {grade && <Pill color="bg-indigo-100 text-indigo-700">{grade}</Pill>}
          {meta && <span className="text-[11px] font-semibold text-gray-400">{meta}</span>}
          {updated && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400">
              <Icon as={Clock} size="xs" /> {updated}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {preview && (
          <a
            href={preview.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btnBase} border border-[#0F1B2D]/12 bg-white text-[#4A5A6E] hover:bg-[#FBF7EF]`}
            title={preview.label}
          >
            <Icon as={Eye} size="sm" /><span className="hidden sm:inline">{preview.label}</span>
          </a>
        )}
        <Link
          to={editTo}
          aria-disabled={!id}
          className={`${btnBase} bg-[#F8EADF] text-[#A3422E] hover:brightness-95`}
        >
          <Icon as={PencilLine} size="sm" /><span className="hidden sm:inline">Edit</span>
        </Link>
        <div className="relative">
          <button
            type="button"
            onClick={() => onMenu(menuOpen ? null : id)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 transition"
          >
            <DotsIcon />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[200px] rounded-xl border border-[#0F1B2D]/10 bg-white p-1.5 shadow-[0_12px_34px_rgba(15,27,45,0.16)]">
              {tab === 'quizzes' && (
                <>
                  {!item.isPublished && (
                    <MenuItem icon={CheckCircle} onClick={() => { onMenu(null); actions.publish(item) }}>Publish</MenuItem>
                  )}
                  {(item.quizType || item.isPublished) && (
                    <MenuItem icon={EyeOff} onClick={() => { onMenu(null); actions.unassign(item) }}>Unassign</MenuItem>
                  )}
                  <MenuItem icon={Layers} onClick={() => { onMenu(null); actions.classify(item) }}>Classify</MenuItem>
                  <div className="my-1 h-px bg-gray-100" />
                  <MenuItem icon={Trash2} danger onClick={() => { onMenu(null); actions.remove(item) }}>Delete</MenuItem>
                </>
              )}
              {tab === 'lessons' && (
                <>
                  <MenuItem icon={item.isPublished ? EyeOff : CheckCircle} onClick={() => { onMenu(null); actions.togglePublish(item) }}>
                    {item.isPublished ? 'Unpublish' : 'Publish'}
                  </MenuItem>
                  <div className="my-1 h-px bg-gray-100" />
                  <MenuItem icon={Trash2} danger onClick={() => { onMenu(null); actions.remove(item) }}>Delete</MenuItem>
                </>
              )}
              {tab === 'pastpapers' && (
                <>
                  {item.pdfPath && (
                    <MenuItem icon={Sparkles} onClick={() => { onMenu(null); actions.convert(item) }}>
                      {busy === item.id ? 'Converting…' : 'Convert to quiz'}
                    </MenuItem>
                  )}
                  <MenuItem icon={item.status === 'published' ? EyeOff : CheckCircle} onClick={() => { onMenu(null); actions.togglePublish(item) }}>
                    {item.status === 'published' ? 'Unpublish' : 'Publish'}
                  </MenuItem>
                  <div className="my-1 h-px bg-gray-100" />
                  <MenuItem icon={Trash2} danger onClick={() => { onMenu(null); actions.remove(item) }}>Delete</MenuItem>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function ManageContent() {
  const {
    getAllLessons, updateLesson, deleteLesson,
    getAllQuizzes, updateQuiz, deleteQuiz,
    createQuiz, saveQuestions,
  } = useFirestore()
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem(LS.tab) || 'quizzes' } catch { return 'quizzes' }
  })
  const [lessons, setLessons] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [papers,  setPapers]  = useState([])
  const [loading, setLoading] = useState(true)
  const [toast,   setToast]   = useState(null)

  // Filters
  const [search,    setSearch]    = useState('')
  const [gradeF,    setGradeF]    = useState('')
  const [subjectF,  setSubjectF]  = useState('')
  const [quizTypeF, setQuizTypeF] = useState('')
  const [paperStatusF, setPaperStatusF] = useState('')
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false)
  const [sortBy, setSortBy] = useState(() => {
    try { return localStorage.getItem(LS.sort) || 'code' } catch { return 'code' }
  })

  // UI state
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS.collapsed) || '[]')) } catch { return new Set() }
  })
  const [selected, setSelected] = useState(() => new Set())
  const [openMenu, setOpenMenu] = useState(null)
  const [classifyMode, setClassifyMode] = useState(false)
  const [bannersOff, setBannersOff] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS.banners) || '[]')) } catch { return new Set() }
  })
  const lastIndexRef = useRef(null)

  // Action state
  const [deleting, setDeleting]   = useState(null)
  const [migrating, setMigrating] = useState(false)
  const [converting, setConverting] = useState(null)
  const [bulkBusy, setBulkBusy]   = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)   // { kind, item }
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false)
  // { quiz, link } — set when Unassign would break a past paper's quiz.
  const [pendingUnassign, setPendingUnassign] = useState(null)

  function show(msg, isErr = false) {
    setToast({ msg, isErr }); setTimeout(() => setToast(null), 3000)
  }

  // persistence
  useEffect(() => { try { localStorage.setItem(LS.tab, tab) } catch {} }, [tab])
  useEffect(() => { try { localStorage.setItem(LS.sort, sortBy) } catch {} }, [sortBy])
  useEffect(() => { try { localStorage.setItem(LS.collapsed, JSON.stringify([...collapsed])) } catch {} }, [collapsed])
  useEffect(() => { try { localStorage.setItem(LS.banners, JSON.stringify([...bannersOff])) } catch {} }, [bannersOff])

  // reset transient state on tab change
  useEffect(() => { setSelected(new Set()); setClassifyMode(false); lastIndexRef.current = null }, [tab])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [l, q, p] = await Promise.all([
        getAllLessons(),
        getAllQuizzes(),
        listAllPapersForAdmin({ limit: 500 }).catch(err => { console.warn('[ManageContent] papers list failed', err); return [] }),
      ])
      if (cancelled) return
      setLessons(l); setQuizzes(q); setPapers(p); setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [getAllLessons, getAllQuizzes])

  // ── Legacy migration (the "needs classification" banner) ────────────────
  const legacyQuizzes = quizzes.filter(q => q.isPublished && (!q.quizType || typeof q.examOnly !== 'boolean'))

  async function migrateLegacyQuizzes() {
    if (!legacyQuizzes.length) return
    setMigrating(true)
    try {
      await Promise.all(
        legacyQuizzes.map(q => {
          const long = isExamOnly(q)
          const patch = { examOnly: long }
          if (!q.quizType) patch.quizType = long ? null : 'practice'
          return updateQuiz(q.id, patch)
        })
      )
      setQuizzes(qs => qs.map(q => {
        if (!q.isPublished || (q.quizType && typeof q.examOnly === 'boolean')) return q
        const long = isExamOnly(q)
        return { ...q, examOnly: long, quizType: q.quizType || (long ? null : 'practice') }
      }))
      show(`✅ Classified ${legacyQuizzes.length} quiz${legacyQuizzes.length === 1 ? '' : 'zes'}`)
    } catch (e) {
      show('❌ Classification failed: ' + e.message, true)
    } finally {
      setMigrating(false)
    }
  }

  // ── Quiz actions ────────────────────────────────────────────────────────
  // Publishing classifies automatically: short quizzes join the practice
  // library, long ones (≥ 50 Q) become exam-only and wait for a manual Daily
  // Exam pin (the auto-picker skips them).
  function quizPublishPatch(quiz) {
    const long = isExamOnly(quiz)
    return {
      isPublished: true, status: 'published', examOnly: long,
      quizType: long ? null : 'practice', isDailyExam: false, dailyExamDate: null,
    }
  }

  async function publishQuiz(quiz) {
    const patch = quizPublishPatch(quiz)
    await updateQuiz(quiz.id, patch)
    setQuizzes(qs => qs.map(q => q.id === quiz.id ? { ...q, ...patch } : q))
    show(patch.examOnly
      ? '🏆 Published as Exam-only — pin it as Daily Exam when you want to use it.'
      : '📝 Published — students can practice it now.')
  }

  // Unassigning writes `isPublished: false`, and BOTH read clauses on
  // `quizzes/{id}` require it — so a quiz a past paper links to stops being
  // readable by every learner, paid included, while the paper goes on
  // advertising it. Ask first in that case; an ordinary practice quiz is
  // unaffected and still unassigns in one click.
  function requestUnassign(quiz) {
    const link = describeQuizPaperLink(quiz, papers)
    if (link.linked) { setPendingUnassign({ quiz, link }); return }
    unassignQuiz(quiz)
  }

  async function unassignQuiz(quiz) {
    setPendingUnassign(null)
    const patch = { quizType: null, isPublished: false, status: 'draft', isDailyExam: false, dailyExamDate: null }
    await updateQuiz(quiz.id, patch)
    setQuizzes(qs => qs.map(q => q.id === quiz.id ? { ...q, ...patch } : q))
    show('⚠ Quiz unassigned — students can no longer access it.')
  }

  // ── Lesson actions ──────────────────────────────────────────────────────
  async function toggleLessonPublish(lesson) {
    const next = !lesson.isPublished
    await updateLesson(lesson.id, { isPublished: next, status: next ? 'published' : 'draft' })
    setLessons(ls => ls.map(l => l.id === lesson.id ? { ...l, isPublished: next, status: next ? 'published' : 'draft' } : l))
    show(next ? '✅ Lesson published!' : '📦 Lesson unpublished.')
  }

  // ── Past paper actions ──────────────────────────────────────────────────
  //
  // NOTE — publishing is NOT gated on the paper having a source. #2193 added
  // such a guard, because at the time an unlabelled paper was invisible to
  // learners and "publish" was therefore a silent no-op. That visibility gate
  // has since been reverted (it emptied the archive), so an unlabelled paper
  // publishes and shows normally, carrying an "Unlabelled" badge. Keeping the
  // guard would now block publishing for a reason that no longer exists.
  async function togglePaperPublish(paper) {
    const next = paper.status === 'published' ? PAPER_STATUSES.DRAFT : PAPER_STATUSES.PUBLISHED
    await updatePaper(paper.id, { status: next })
    setPapers(ps => ps.map(p => p.id === paper.id ? { ...p, status: next } : p))
    show(next === PAPER_STATUSES.PUBLISHED ? '✅ Paper published.' : '📦 Paper unpublished.')
  }

  async function convertPaper(paper) {
    if (converting) return
    setConverting(paper.id)
    try {
      const result = await convertPaperToQuizDraft({
        paper, uid: currentUser?.uid, createQuiz, saveQuestions,
        onProgress: ({ step }) => show(step),
      })
      show(`✓ Converted to a ${result.questionCount}-question draft. Opening editor…`)
      setTimeout(() => navigate(`/admin/quizzes/${result.quizId}/edit`), 800)
    } catch (err) {
      show('❌ ' + (err?.message || 'Conversion failed.'), true)
    } finally {
      setConverting(null)
    }
  }

  // ── Delete (single) ─────────────────────────────────────────────────────
  function requestDelete(kind, item) {
    if (deleting) return
    setPendingDelete({ kind, item })
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const { kind, item } = pendingDelete
    setDeleting(item.id)
    try {
      if (kind === 'quiz')   { await deleteQuiz(item.id);   setQuizzes(qs => qs.filter(q => q.id !== item.id)) }
      if (kind === 'lesson') { await deleteLesson(item.id); setLessons(ls => ls.filter(l => l.id !== item.id)) }
      if (kind === 'paper')  { await deletePaper(item.id, paperStoragePaths(item)); setPapers(ps => ps.filter(p => p.id !== item.id)) }
      show('🗑 Deleted.')
    } catch (err) {
      show('❌ ' + (err?.message || 'Failed to delete.'), true)
    } finally {
      setDeleting(null)
      setPendingDelete(null)
    }
  }

  // ── Bulk actions ────────────────────────────────────────────────────────
  function clearSelection() { setSelected(new Set()); setClassifyMode(false); lastIndexRef.current = null }

  // Per-item "Classify": select just this quiz and open the classify chooser
  // in the bulk bar so the admin can tag it Practice or Exam-only.
  function classifyItem(item) {
    setSelected(new Set([item.id]))
    setClassifyMode(true)
  }

  async function bulkClassify(type) {
    const ids = [...selected]
    if (!ids.length) return
    const patch = type === 'practice'
      ? { quizType: 'practice', examOnly: false }
      : { quizType: null, examOnly: true }
    setBulkBusy(true)
    try {
      await Promise.all(ids.map(id => updateQuiz(id, patch)))
      setQuizzes(qs => qs.map(q => selected.has(q.id) ? { ...q, ...patch } : q))
      show(`✅ Classified ${ids.length} as ${type === 'practice' ? 'Practice' : 'Exam-only'}`)
      clearSelection()
    } catch (e) {
      show('❌ ' + (e?.message || 'Classify failed'), true)
    } finally { setBulkBusy(false) }
  }

  async function bulkPublish() {
    setBulkBusy(true)
    try {
      if (tab === 'quizzes') {
        const targets = quizzes.filter(q => selected.has(q.id) && !q.isPublished)
        await Promise.all(targets.map(q => updateQuiz(q.id, quizPublishPatch(q))))
        setQuizzes(qs => qs.map(q => selected.has(q.id) && !q.isPublished ? { ...q, ...quizPublishPatch(q) } : q))
      } else if (tab === 'lessons') {
        const targets = lessons.filter(l => selected.has(l.id) && !l.isPublished)
        await Promise.all(targets.map(l => updateLesson(l.id, { isPublished: true, status: 'published' })))
        setLessons(ls => ls.map(l => selected.has(l.id) ? { ...l, isPublished: true, status: 'published' } : l))
      } else {
        const targets = papers.filter(p => selected.has(p.id) && p.status !== 'published')
        await Promise.all(targets.map(p => updatePaper(p.id, { status: PAPER_STATUSES.PUBLISHED })))
        setPapers(ps => ps.map(p => selected.has(p.id) ? { ...p, status: PAPER_STATUSES.PUBLISHED } : p))
      }
      show(`✅ Published ${selected.size} item${selected.size === 1 ? '' : 's'}`)
      clearSelection()
    } catch (e) {
      show('❌ ' + (e?.message || 'Publish failed'), true)
    } finally { setBulkBusy(false) }
  }

  async function confirmBulkDelete() {
    const ids = [...selected]
    setBulkBusy(true)
    try {
      if (tab === 'quizzes') { await Promise.all(ids.map(id => deleteQuiz(id))); setQuizzes(qs => qs.filter(q => !selected.has(q.id))) }
      else if (tab === 'lessons') { await Promise.all(ids.map(id => deleteLesson(id))); setLessons(ls => ls.filter(l => !selected.has(l.id))) }
      else { await Promise.all(papers.filter(p => selected.has(p.id)).map(p => deletePaper(p.id, paperStoragePaths(p)))); setPapers(ps => ps.filter(p => !selected.has(p.id))) }
      show(`🗑 Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`)
      clearSelection()
    } catch (e) {
      show('❌ ' + (e?.message || 'Delete failed'), true)
    } finally { setBulkBusy(false); setPendingBulkDelete(false) }
  }

  // ── Filtering ───────────────────────────────────────────────────────────
  const debouncedSearch = useDebouncedValue(search, 200)
  const needle = debouncedSearch.toLowerCase().trim()

  const filteredQuizzes = useMemo(() => quizzes.filter(q => {
    const qt = q.quizType ?? ''
    const matchesType = (() => {
      if (!quizTypeF) return true
      if (quizTypeF === 'unpublished')   return !q.isPublished
      if (quizTypeF === 'unclassified')  return q.isPublished && (!q.quizType || typeof q.examOnly !== 'boolean')
      if (quizTypeF === 'exam_only')     return isExamOnly(q) && q.isPublished && qt !== 'daily_exam'
      if (quizTypeF === 'practice')      return qt === 'practice' && !isExamOnly(q)
      if (quizTypeF === 'from_past_paper') return Boolean(q.sourcePastPaperId)
      return qt === quizTypeF
    })()
    const matchesNeedsReview = !needsReviewOnly || summarizeImportReview(q).needsReview
    return (
      (!gradeF   || q.grade === gradeF) &&
      (!subjectF || q.subject === subjectF) &&
      matchesType && matchesNeedsReview &&
      (!needle   || q.title?.toLowerCase().includes(needle) || q.subject?.toLowerCase().includes(needle) || q.topic?.toLowerCase().includes(needle))
    )
  }), [quizzes, quizTypeF, needsReviewOnly, gradeF, subjectF, needle])

  const filteredLessons = useMemo(() => lessons.filter(l => (
    (!gradeF   || l.grade === gradeF) &&
    (!subjectF || l.subject === subjectF) &&
    (!needle   || l.title?.toLowerCase().includes(needle) || l.subject?.toLowerCase().includes(needle) || l.topic?.toLowerCase().includes(needle))
  )), [lessons, gradeF, subjectF, needle])

  const filteredPapers = useMemo(() => papers.filter(p => {
    const label = paperSubjectLabel(p)
    return (
      (!gradeF   || String(p.grade) === gradeF) &&
      (!subjectF || label === subjectF) &&
      (!paperStatusF || (p.status || PAPER_STATUSES.DRAFT) === paperStatusF) &&
      (!needle   || p.title?.toLowerCase().includes(needle) || label.toLowerCase().includes(needle) || String(p.year || '').includes(needle))
    )
  }), [papers, gradeF, subjectF, paperStatusF, needle])

  const filtered = tab === 'quizzes' ? filteredQuizzes : tab === 'lessons' ? filteredLessons : filteredPapers

  // group by subject (sorted within group)
  const groups = useMemo(() => {
    const subjectOf = (it) => tab === 'pastpapers' ? paperSubjectLabel(it) : (it.subject || 'Other')
    const map = new Map()
    for (const it of filtered) {
      const s = subjectOf(it) || 'Other'
      if (!map.has(s)) map.set(s, [])
      map.get(s).push(it)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([s, arr]) => [s, sortItems(arr, sortBy, tab)])
  }, [filtered, sortBy, tab])

  // flat display order for shift-range selection + select-all
  const orderedIds = useMemo(() => groups.flatMap(([, arr]) => arr.map(i => i.id)), [groups])
  const idIndex = useMemo(() => new Map(orderedIds.map((id, i) => [id, i])), [orderedIds])

  // ── Selection ───────────────────────────────────────────────────────────
  const onSelect = useCallback((id, shiftKey) => {
    setSelected(prev => {
      const next = new Set(prev)
      const idx = idIndex.get(id)
      if (shiftKey && lastIndexRef.current != null && idx != null) {
        const [lo, hi] = lastIndexRef.current < idx ? [lastIndexRef.current, idx] : [idx, lastIndexRef.current]
        for (let i = lo; i <= hi; i++) next.add(orderedIds[i])
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
      }
      lastIndexRef.current = idx
      return next
    })
  }, [idIndex, orderedIds])

  const allSelected = orderedIds.length > 0 && orderedIds.every(id => selected.has(id))
  function toggleSelectAll() {
    setSelected(prev => {
      if (allSelected) return new Set([...prev].filter(id => !idIndex.has(id)))
      return new Set([...prev, ...orderedIds])
    })
  }
  function toggleGroup(items) {
    setSelected(prev => {
      const next = new Set(prev)
      const all = items.every(i => next.has(i.id))
      items.forEach(i => all ? next.delete(i.id) : next.add(i.id))
      return next
    })
  }
  function toggleCollapse(subject) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(subject) ? next.delete(subject) : next.add(subject)
      return next
    })
  }

  // ── Stats ───────────────────────────────────────────────────────────────
  const totalNeedsReview = useMemo(
    () => quizzes.filter(q => summarizeImportReview(q).needsReview).length,
    [quizzes],
  )

  const stats = useMemo(() => {
    if (tab === 'quizzes') return [
      { label: 'Total',       value: quizzes.length, icon: Layers,        tone: 'slate' },
      { label: 'Practice',    value: quizzes.filter(q => q.quizType === 'practice' && !isExamOnly(q)).length, icon: PencilLine, tone: 'green' },
      { label: 'Exam-only',   value: quizzes.filter(q => isExamOnly(q) && q.isPublished && q.quizType !== 'daily_exam').length, icon: Trophy, tone: 'amber' },
      { label: 'Daily',       value: quizzes.filter(q => q.quizType === 'daily_exam').length, icon: Calendar, tone: 'blue' },
      { label: 'Needs Review', value: totalNeedsReview, icon: AlertTriangle, tone: 'warning' },
    ]
    if (tab === 'lessons') return [
      { label: 'Total',       value: lessons.length, icon: Layers, tone: 'slate' },
      { label: 'Published',   value: lessons.filter(l => l.isPublished).length, icon: CheckCircle, tone: 'green' },
      { label: 'Unpublished', value: lessons.filter(l => !l.isPublished).length, icon: EyeOff, tone: 'pink' },
    ]
    return [
      { label: 'Total',     value: papers.length, icon: Layers, tone: 'slate' },
      { label: 'Published', value: papers.filter(p => p.status === 'published').length, icon: CheckCircle, tone: 'green' },
      { label: 'Drafts',    value: papers.filter(p => (p.status || 'draft') !== 'published').length, icon: PencilLine, tone: 'amber' },
    ]
  }, [tab, quizzes, lessons, papers, totalNeedsReview])

  const needsReviewCount = useMemo(() => quizzes.reduce((count, q) => {
    if (!summarizeImportReview(q).needsReview) return count
    if (gradeF && q.grade !== gradeF) return count
    if (subjectF && q.subject !== subjectF) return count
    if (needle && !(q.title?.toLowerCase().includes(needle) || q.subject?.toLowerCase().includes(needle))) return count
    return count + 1
  }, 0), [quizzes, gradeF, subjectF, needle])

  // Both are declared filters on the canonical ladder, with their product
  // reasons recorded in FEATURE_GRADE_RESTRICTIONS.
  const gradeOptions = (tab === 'pastpapers'
    ? gradesForFeature('past-papers')
    : gradesForFeature('learner-catalogue')
  ).map((g) => gradeNumberOf(g.code))
  const hasFilters = search || gradeF || subjectF || quizTypeF || paperStatusF || needsReviewOnly
  const counts = { quizzes: quizzes.length, lessons: lessons.length, pastpapers: papers.length }

  // Resolved even when the dialog is closed — `unassignWarning` is total, and
  // reading the copy from one place keeps the three props in step.
  const unassignCopy = unassignWarning(pendingUnassign?.link)

  const rowActions = {
    publish: publishQuiz,
    unassign: requestUnassign,
    classify: classifyItem,
    togglePublish: tab === 'lessons' ? toggleLessonPublish : togglePaperPublish,
    convert: convertPaper,
    remove: item => requestDelete(tab === 'quizzes' ? 'quiz' : tab === 'lessons' ? 'lesson' : 'paper', item),
  }

  return (
    <div className="space-y-5">
      <SeoHelmet title="Content Library" noIndex />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[70] font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs ${
          toast.isErr ? 'bg-red-600 text-white' : 'bg-green-700 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Single-delete confirm */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.kind === 'quiz' ? 'Delete this quiz?'
            : pendingDelete?.kind === 'lesson' ? 'Delete this lesson?'
              : 'Delete this past paper?'
        }
        message={
          pendingDelete?.kind === 'quiz'
            ? <>You're about to delete <strong className="theme-text">"{pendingDelete?.item?.title}"</strong>. All questions linked to it will be removed too. This cannot be undone.</>
            : <>You're about to delete <strong className="theme-text">"{pendingDelete?.item?.title}"</strong>. This cannot be undone.</>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={Boolean(deleting) && pendingDelete?.item?.id === deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Unassign-a-paper's-quiz confirm. Not `danger` — the write is
          reversible by publishing again; what it needs is to be READ, because
          the damage it does is invisible from this screen. */}
      <ConfirmDialog
        open={Boolean(pendingUnassign)}
        title={unassignCopy.title}
        message={unassignCopy.message}
        confirmLabel={unassignCopy.confirmLabel}
        variant="primary"
        onConfirm={() => pendingUnassign && unassignQuiz(pendingUnassign.quiz)}
        onCancel={() => setPendingUnassign(null)}
      />

      {/* Bulk-delete confirm */}
      <ConfirmDialog
        open={pendingBulkDelete}
        title={`Delete ${selected.size} item${selected.size === 1 ? '' : 's'}?`}
        message={<>This permanently removes the selected {tab === 'pastpapers' ? 'past papers' : tab}. This cannot be undone.</>}
        confirmLabel={`Delete ${selected.size}`}
        variant="danger"
        loading={bulkBusy}
        onConfirm={confirmBulkDelete}
        onCancel={() => setPendingBulkDelete(false)}
      />

      {/* Daily exam modal */}
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="admin-game-eyebrow">Library</span>
          <h1 className="admin-game-display text-[#0F1B2D] mt-1 flex items-center gap-2.5" style={{ fontSize: 30 }}>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#F8EADF] text-[#A3422E]">
              <Icon as={FolderOpen} size="md" />
            </span>
            Content Library
          </h1>
          <p className="text-sm text-[#4A5A6E] mt-1.5 font-semibold">Manage quizzes, lessons, past papers, and published learning content.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button as={Link} to="/admin/quizzes/new?mode=ai" variant="primary" size="md" className="w-full sm:w-auto" leadingIcon={<Icon as={Sparkles} size="sm" />}>AI Quiz</Button>
          <Button as={Link} to="/admin/quizzes/new?mode=import" variant="secondary" size="md" className="w-full sm:w-auto" leadingIcon={<Icon as={Download} size="sm" />}>Import Word/PDF</Button>
          <Button as={Link} to="/admin/quizzes/new" variant="secondary" size="md" className="w-full sm:w-auto" leadingIcon={<Icon as={Plus} size="sm" />}>Manual Quiz</Button>
          <Button as={Link} to="/admin/lessons/new" variant="secondary" size="md" className="w-full sm:w-auto" leadingIcon={<Icon as={BookOpen} size="sm" />}>Lesson</Button>
          <Button as={Link} to="/admin/papers/new" variant="secondary" size="md" className="w-full sm:w-auto" leadingIcon={<Icon as={FileText} size="sm" />}>Past Paper</Button>
        </div>
      </div>

      {/* Tabs — segmented control. Active = white pill on a soft track, not a
          bright fill, so it reads professional. */}
      <div className="inline-flex flex-wrap gap-1 rounded-2xl bg-[#0F1B2D]/[0.05] p-1">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold transition-all ${
                active
                  ? 'bg-white text-[#0F1B2D] shadow-[0_1px_3px_rgba(15,27,45,0.12)]'
                  : 'text-[#4A5A6E] hover:text-[#0F1B2D]'
              }`}
            >
              <Icon as={t.icon} size="sm" className={active ? 'text-[#D97757]' : ''} /> {t.label}
              <span className={`ml-0.5 rounded-full px-1.5 text-[11px] font-black ${active ? 'bg-[#F8EADF] text-[#A3422E]' : 'bg-[#0F1B2D]/8 text-[#4A5A6E]'}`}>
                {counts[t.id]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Status banners (quizzes only) */}
      {tab === 'quizzes' && !loading && !bannersOff.has('picker') && (
        <StatusBanner
          tone="info"
          icon={Bot}
          title="Daily Exam rotation · retired"
          desc={`The daily quiz is now five questions built from the approved question bank — see /admin/daily-quiz. Nothing here is promoted to a Daily Exam any more; quizzes with ${EXAM_ONLY_QUESTION_THRESHOLD}+ questions stay exam-only and are practised from the library.`}
          action={
            <button
              onClick={() => setBannersOff(s => new Set(s).add('picker'))}
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 transition-colors"
            >
              Dismiss
            </button>
          }
        />
      )}
      {tab === 'quizzes' && !loading && legacyQuizzes.length > 0 && (
        <StatusBanner
          tone="warning"
          icon={AlertTriangle}
          title={`${legacyQuizzes.length} quiz${legacyQuizzes.length !== 1 ? 'zes' : ''} need classification`}
          desc="Tag each as Practice or Exam-only — or select them below and use the bulk bar."
          action={
            <button
              onClick={migrateLegacyQuizzes}
              disabled={migrating}
              className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {migrating ? 'Classifying…' : 'Classify all'}
            </button>
          }
        />
      )}

      {/* Stats — compact dashboard cards */}
      {!loading && (
        <div className={`grid grid-cols-2 gap-3 ${stats.length === 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-3'}`}>
          {stats.map(s => {
            const tone = STAT_TONES[s.tone] ?? STAT_TONES.slate
            return (
              <div key={s.label} className={`flex items-center gap-3 rounded-2xl border p-3 ${tone.card || 'border-[#0F1B2D]/[0.08] bg-white shadow-[0_1px_2px_rgba(15,27,45,0.05)]'}`}>
                <span className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl ${tone.chip}`}>
                  <Icon as={s.icon} size="sm" />
                </span>
                <div className="min-w-0">
                  <p className="text-xl font-extrabold leading-none text-[#0F1B2D]">{s.value}</p>
                  <p className="mt-1 text-[10.5px] font-bold uppercase tracking-wide text-[#4A5A6E] truncate">{s.label}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filters — one search bar + dropdowns; stacks on mobile */}
      <div className={`${SOFT_CARD} p-3`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Icon as={Search} size="sm" /></span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search title, subject, topic…"
              aria-label="Search content"
              className="w-full rounded-xl border border-[#0F1B2D]/15 bg-white pl-9 pr-3 py-2 text-sm focus:border-[#D97757] focus:outline-none focus:ring-2 focus:ring-[#D97757]/20 transition"
            />
          </div>
          <select value={gradeF} onChange={e => setGradeF(e.target.value)} className={SELECT_CLS} aria-label="Filter by grade">
            <option value="">All Grades</option>
            {gradeOptions.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select value={subjectF} onChange={e => setSubjectF(e.target.value)} className={SELECT_CLS} aria-label="Filter by subject">
            {SUBJECTS.map(s => <option key={s} value={s}>{s || 'All Subjects'}</option>)}
          </select>
          {tab === 'quizzes' && (
            <select value={quizTypeF} onChange={e => setQuizTypeF(e.target.value)} className={SELECT_CLS} aria-label="Filter by type">
              <option value="">All Types</option>
              <option value="practice">Practice</option>
              <option value="exam_only">Exam only</option>
              <option value="daily_exam">Daily Exam</option>
              <option value="unclassified">Unclassified</option>
              <option value="unpublished">Unpublished</option>
              <option value="from_past_paper">From past paper</option>
            </select>
          )}
          {tab === 'pastpapers' && (
            <select value={paperStatusF} onChange={e => setPaperStatusF(e.target.value)} className={SELECT_CLS} aria-label="Filter by status">
              <option value="">All Statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          )}
          {tab === 'quizzes' && (
            <button
              type="button"
              onClick={() => setNeedsReviewOnly(v => !v)}
              aria-pressed={needsReviewOnly}
              disabled={!needsReviewOnly && needsReviewCount === 0}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto ${
                needsReviewOnly ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-[#0F1B2D]/15 bg-white text-[#4A5A6E] hover:border-amber-300'
              }`}
              title={needsReviewOnly ? 'Click to show all imports' : needsReviewCount > 0 ? `${needsReviewCount} imported draft(s) flagged` : 'No imports need review'}
            >
              <Icon as={AlertTriangle} size="sm" /> Needs review
              {needsReviewCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-black text-white min-w-[20px]">{needsReviewCount}</span>
              )}
            </button>
          )}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className={SELECT_CLS} title="Sort within each subject" aria-label="Sort">
            {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
          </select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="w-full sm:w-auto" leadingIcon={<Icon as={X} size="sm" />}
              onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setQuizTypeF(''); setPaperStatusF(''); setNeedsReviewOnly(false) }}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#E6C5B7] bg-[#F7EBE7] px-4 py-2.5">
          <span className="font-black text-[#A3422E] text-sm">{selected.size} selected</span>
          <div className="flex-1" />
          {classifyMode && tab === 'quizzes' ? (
            <>
              <span className="text-xs font-bold text-[#A3422E]">Mark as:</span>
              <button onClick={() => bulkClassify('practice')} disabled={bulkBusy} className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-black text-green-700 disabled:opacity-50">Practice</button>
              <button onClick={() => bulkClassify('exam')} disabled={bulkBusy} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700 disabled:opacity-50">Exam-only</button>
              <button onClick={() => setClassifyMode(false)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500">Cancel</button>
            </>
          ) : (
            <>
              {tab === 'quizzes' && (
                <button onClick={() => setClassifyMode(true)} disabled={bulkBusy} className="rounded-lg border border-[#E6C5B7] bg-white px-3 py-1.5 text-xs font-black text-[#A3422E] disabled:opacity-50">Classify</button>
              )}
              <button onClick={bulkPublish} disabled={bulkBusy} className="rounded-lg border border-[#E6C5B7] bg-white px-3 py-1.5 text-xs font-black text-green-700 disabled:opacity-50">Publish</button>
              <button onClick={() => setPendingBulkDelete(true)} disabled={bulkBusy} className="rounded-lg border border-[#E6C5B7] bg-white px-3 py-1.5 text-xs font-black text-red-600 disabled:opacity-50">Delete</button>
              <button onClick={clearSelection} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500">Clear</button>
            </>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={56} className="rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className={`text-center py-14 ${SOFT_CARD}`}>
          <div className="text-4xl mb-2" aria-hidden="true">📭</div>
          <p className="font-black text-gray-700 text-base">
            {filtered.length === 0 && !hasFilters ? `No ${tab === 'pastpapers' ? 'past papers' : tab} yet` : 'Nothing matches these filters'}
          </p>
          {tab === 'quizzes' && quizzes.length === 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button as={Link} to="/admin/quizzes/new?mode=ai" variant="primary" size="sm" leadingIcon={<Icon as={Sparkles} size="sm" />}>AI Quiz</Button>
              <Button as={Link} to="/admin/quizzes/new?mode=import" variant="secondary" size="sm" leadingIcon={<Icon as={Download} size="sm" />}>Import</Button>
              <Button as={Link} to="/admin/quizzes/new" variant="secondary" size="sm" leadingIcon={<Icon as={Plus} size="sm" />}>Manual</Button>
            </div>
          )}
          {tab === 'pastpapers' && papers.length === 0 && (
            <div className="mt-3 inline-flex"><Button as={Link} to="/admin/papers/new" variant="primary" size="sm" leadingIcon={<Icon as={Plus} size="sm" />}>Upload a paper</Button></div>
          )}
          {tab === 'lessons' && lessons.length === 0 && (
            <div className="mt-3 inline-flex"><Button as={Link} to="/admin/lessons/new" variant="primary" size="sm" trailingIcon={<Icon as={ChevronRight} size="sm" />}>Create a lesson</Button></div>
          )}
        </div>
      ) : (
        <>
          {/* select-all-visible */}
          <div className="flex items-center gap-2.5 px-1 text-xs font-bold text-gray-500">
            <Box checked={allSelected} onClick={toggleSelectAll} label="Select all visible" />
            <span>Select all · {filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
            <span className="text-gray-300">·</span>
            <button
              className="font-bold text-gray-500 hover:text-gray-700"
              onClick={() => setCollapsed(prev => prev.size >= groups.length ? new Set() : new Set(groups.map(([s]) => s)))}
            >
              {collapsed.size >= groups.length ? 'Expand all' : 'Collapse all'}
            </button>
          </div>

          <div className="space-y-4">
            {groups.map(([subject, items]) => {
              const isCol = collapsed.has(subject)
              const grpSel = items.length > 0 && items.every(i => selected.has(i.id))
              return (
                <div key={subject}>
                  {/* lightweight subject header */}
                  <div
                    className="flex items-center gap-2.5 px-1 py-1.5 cursor-pointer select-none"
                    onClick={() => toggleCollapse(subject)}
                  >
                    <span onClick={e => { e.stopPropagation(); toggleGroup(items) }}>
                      <Box checked={grpSel} onClick={() => {}} label={`Select all in ${subject}`} />
                    </span>
                    <Icon as={isCol ? ChevronRight : ChevronDown} size="sm" className="text-gray-400" />
                    <span className="font-black text-[#0F1B2D] text-sm">{subject}</span>
                    <span className="text-[11px] font-black text-[#4A5A6E] bg-[#0F1B2D]/[0.06] rounded-full px-2 py-px">{items.length}</span>
                  </div>
                  {!isCol && (
                    <div className="space-y-2">
                      {items.map(item => (
                        <Row
                          key={item.id}
                          tab={tab}
                          item={item}
                          selected={selected.has(item.id)}
                          onSelect={onSelect}
                          menuOpen={openMenu === item.id}
                          onMenu={setOpenMenu}
                          actions={rowActions}
                          busy={converting}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* click-away for the row menu */}
      {openMenu && <div onClick={() => setOpenMenu(null)} className="fixed inset-0 z-40" />}
    </div>
  )
}
