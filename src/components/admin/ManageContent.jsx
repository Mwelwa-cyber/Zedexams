import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search, Plus, Download, X, ChevronRight, ChevronDown, Sparkles,
  FileText, BookOpen, ListChecks, Check, FolderOpen,
} from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'
import ConfirmDialog from '../ui/ConfirmDialog'
import { todayString } from '../../utils/examService'
import { EXAM_ONLY_QUESTION_THRESHOLD, isExamOnly } from '../../utils/quizClassification.js'
import { summarizeImportReview } from '../../utils/importReviewSummary.js'
import { SUBJECTS as CURRICULUM_SUBJECTS } from '../../config/curriculum'
import {
  PAPER_STATUSES, listAllPapersForAdmin, updatePaper, deletePaper, splitAssetsByRole,
} from '../../utils/pastPapers'
import { convertPaperToQuizDraft } from '../../utils/paperToQuizConverter'
import ImportReviewBadge from '../quiz/ImportReviewBadge'
import SeoHelmet from '../seo/SeoHelmet'

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

const SUBJECTS = [
  '', 'English', 'Integrated Science', 'Mathematics', 'Social Studies',
  'Expressive Art', 'Technology Studies', 'Cinyanja', 'Home Economics',
  'Special Paper 1',
]

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
function Pill({ children, color }) {
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}>{children}</span>
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
        checked ? 'bg-[#FF7A1A] border-[#0F1B2D]' : 'bg-white border-[#0F1B2D]/30 hover:border-[#FF7A1A]'
      }`}
    >
      {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </button>
  )
}

function MenuItem({ onClick, danger, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-bold transition-colors hover:bg-amber-50 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// ── Set-as-Daily-Exam modal (unchanged behaviour) ──────────────────────────
function DailyExamModal({ quiz, onSave, onClose }) {
  // Local-time date so it matches the student-side todayString() check.
  // toISOString() returns UTC and can be off-by-one near midnight in any
  // non-UTC timezone, which would make the saved dailyExamDate never equal
  // "today" on the /exams page.
  const today = todayString()
  const [date,     setDate]     = useState(quiz.dailyExamDate || today)
  const [duration, setDuration] = useState(quiz.durationMinutes || quiz.duration || 45)
  const [isDemo,   setIsDemo]   = useState(!!quiz.isDemo)
  const [saving,   setSaving]   = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(quiz, { date, duration: Number(duration), isDemo })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-gray-800 text-base">🏆 Set as Daily Exam</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4 font-bold line-clamp-2">{quiz.title}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-black text-gray-600 mb-1">Exam Date</label>
            <input type="date" value={date} min={today}
              onChange={e => setDate(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-black text-gray-600 mb-1">Duration (minutes)</label>
            <input type="number" value={duration} min={5} max={180}
              onChange={e => setDuration(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-500 focus:outline-none" />
            <p className="text-xs text-gray-400 mt-1">Tip: 45–60 min for 50+ question papers</p>
          </div>
          <div className="rounded-xl border-2 theme-border bg-gray-50 px-3 py-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-gray-700">Mark as Demo Exam</p>
                <p className="mt-0.5 text-[11px] font-bold text-gray-500 leading-snug">Visible to learners on free/Demo Access so they can try a sample exam.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isDemo}
                onClick={() => setIsDemo(v => !v)}
                className={`relative h-5 w-10 flex-shrink-0 rounded-full p-0 shadow-none transition-colors ${isDemo ? 'bg-amber-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${isDemo ? 'left-5' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={saving || !date}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl py-2.5 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : '🏆 Confirm Daily Exam'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// Long quizzes (≥ EXAM_ONLY_QUESTION_THRESHOLD questions) are exam-only — they
// never appear in the /quizzes practice library and the daily auto-picker
// skips them. Admins pin them as Daily Exam manually. isExamOnly / the
// threshold live in utils/quizClassification.js so the in-editor publish path
// stays in sync.

// ── compact row ─────────────────────────────────────────────────────────────
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
    editTo = id ? `/admin/quizzes/${id}/edit` : '/admin/content'
    preview = id ? { href: `/quiz/${id}`, label: item.isPublished ? '👁 Preview' : '👁 Test draft' } : null
    meta = `${qCount}Q · ${duration}m`
    badges = (
      <>
        {quizType === 'daily_exam' && <Pill color="bg-amber-100 text-amber-700">🏆 Daily · {item.dailyExamDate}</Pill>}
        {quizType !== 'daily_exam' && examOnly && item.isPublished && <Pill color="bg-amber-100 text-amber-700">🏆 Exam-only</Pill>}
        {quizType === 'practice' && !examOnly && <Pill color="bg-green-100 text-green-700">📝 Practice</Pill>}
        {!quizType && !examOnly && <Pill color="bg-gray-100 text-gray-500">⚠ Unclassified</Pill>}
        {!quizType && examOnly && !item.isPublished && <Pill color="bg-gray-100 text-gray-500">⚠ Unpublished</Pill>}
        {item.isDemo && <Pill color="bg-sky-100 text-sky-700">🎁 Demo</Pill>}
        {item.sourcePastPaperId && <Pill color="bg-violet-100 text-violet-700">📄 From paper</Pill>}
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
    preview = id ? { href: `/papers/${id}`, label: '👁 Preview' } : null
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
  const grade = item.grade ? `G${item.grade}` : null
  const subject = tab === 'pastpapers' ? paperSubjectLabel(item) : item.subject

  return (
    <div
      className={`group flex items-center gap-2.5 px-3 sm:px-4 py-2.5 border-t border-[#0F1B2D]/8 transition-colors ${
        selected ? 'bg-[#FFF4EA] shadow-[inset_3px_0_0_#FF7A1A]' : 'hover:bg-[#FBF7EF]'
      }`}
    >
      <span className={selected ? 'opacity-100' : 'opacity-40 group-hover:opacity-100 transition-opacity'}>
        <Box checked={selected} onClick={e => onSelect(id, e.shiftKey)} label={`Select ${title}`} />
      </span>

      {code && (
        <span className="hidden sm:inline font-mono text-[11px] font-bold text-gray-600 bg-[#F4F0E7] border border-[#0F1B2D]/15 rounded-md px-1.5 py-0.5 flex-shrink-0">
          {code}
        </span>
      )}

      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
        <span className="font-black text-gray-800 text-[13.5px] leading-tight truncate max-w-full sm:max-w-[340px]" title={title}>
          {title}
        </span>
        {subject && <Pill color={SUBJECT_COLORS[subject] ?? 'bg-gray-100 text-gray-700'}>{subject}</Pill>}
        {grade && <Pill color="bg-indigo-100 text-indigo-700">{grade}</Pill>}
        {meta && <span className="text-[11px] font-semibold text-gray-400">{meta}</span>}
        {badges}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Link
          to={editTo}
          aria-disabled={!id}
          className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-[#FFEDD5] text-[#C2410C] hover:brightness-95 transition"
        >
          ✏️<span className="hidden sm:inline">Edit</span>
        </Link>
        {preview && (
          <a
            href={preview.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-50 transition"
          >
            {preview.label}
          </a>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => onMenu(menuOpen ? null : id)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 transition"
          >
            <span className="text-lg leading-none" aria-hidden="true">⋮</span>
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[184px] rounded-xl border-2 border-[#0F1B2D] bg-white p-1.5 shadow-[0_12px_34px_rgba(15,27,45,0.18)]">
              {tab === 'quizzes' && (
                <>
                  {!item.isPublished && (
                    <MenuItem onClick={() => { onMenu(null); actions.publish(item) }}>✅ Publish</MenuItem>
                  )}
                  {item.quizType !== 'daily_exam' && (
                    <MenuItem onClick={() => { onMenu(null); actions.daily(item) }}>🏆 Set as Daily Exam</MenuItem>
                  )}
                  {(item.quizType || item.isPublished) && (
                    <MenuItem onClick={() => { onMenu(null); actions.unassign(item) }}>📌 Unassign</MenuItem>
                  )}
                  <div className="my-1 h-px bg-gray-100" />
                  <MenuItem danger onClick={() => { onMenu(null); actions.remove(item) }}>🗑 Delete</MenuItem>
                </>
              )}
              {tab === 'lessons' && (
                <>
                  <MenuItem onClick={() => { onMenu(null); actions.togglePublish(item) }}>
                    {item.isPublished ? '📦 Unpublish' : '✅ Publish'}
                  </MenuItem>
                  <div className="my-1 h-px bg-gray-100" />
                  <MenuItem danger onClick={() => { onMenu(null); actions.remove(item) }}>🗑 Delete</MenuItem>
                </>
              )}
              {tab === 'pastpapers' && (
                <>
                  {item.pdfPath && (
                    <MenuItem onClick={() => { onMenu(null); actions.convert(item) }} >
                      {busy === item.id ? '… converting' : '✨ Convert to quiz'}
                    </MenuItem>
                  )}
                  <MenuItem onClick={() => { onMenu(null); actions.togglePublish(item) }}>
                    {item.status === 'published' ? '📦 Unpublish' : '✅ Publish'}
                  </MenuItem>
                  <div className="my-1 h-px bg-gray-100" />
                  <MenuItem danger onClick={() => { onMenu(null); actions.remove(item) }}>🗑 Delete</MenuItem>
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
  const [dailyQuiz, setDailyQuiz] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)   // { kind, item }
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false)

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

  async function setAsDailyExam(quiz, { date, duration, isDemo }) {
    const demoPatch = typeof isDemo === 'boolean' ? { isDemo } : {}
    const patch = {
      quizType: 'daily_exam', isDailyExam: true, dailyExamDate: date,
      durationMinutes: duration, isPublished: true, status: 'published', ...demoPatch,
    }
    await updateQuiz(quiz.id, patch)
    setQuizzes(qs => qs.map(q => q.id === quiz.id ? { ...q, ...patch } : q))
    show(`🏆 Set as Daily Exam on ${date}${isDemo ? ' · Demo' : ''}`)
  }

  async function unassignQuiz(quiz) {
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
  const needle = search.toLowerCase().trim()

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
  const stats = useMemo(() => {
    if (tab === 'quizzes') return [
      { label: 'Total',         value: quizzes.length, t: 't-purple' },
      { label: '📝 Practice',   value: quizzes.filter(q => q.quizType === 'practice' && !isExamOnly(q)).length, t: 't-mint' },
      { label: '🏆 Exam-only',  value: quizzes.filter(q => isExamOnly(q) && q.isPublished && q.quizType !== 'daily_exam').length, t: 't-amber' },
      { label: '🏆 Daily',      value: quizzes.filter(q => q.quizType === 'daily_exam').length, t: 't-amber' },
      { label: '⚠ Unpublished', value: quizzes.filter(q => !q.isPublished).length, t: 't-pink' },
    ]
    if (tab === 'lessons') return [
      { label: 'Total',         value: lessons.length, t: 't-purple' },
      { label: '✅ Published',  value: lessons.filter(l => l.isPublished).length, t: 't-mint' },
      { label: '⚠ Unpublished', value: lessons.filter(l => !l.isPublished).length, t: 't-pink' },
    ]
    return [
      { label: 'Total',       value: papers.length, t: 't-purple' },
      { label: '✅ Published', value: papers.filter(p => p.status === 'published').length, t: 't-mint' },
      { label: '📝 Drafts',    value: papers.filter(p => (p.status || 'draft') !== 'published').length, t: 't-amber' },
    ]
  }, [tab, quizzes, lessons, papers])

  const needsReviewCount = useMemo(() => quizzes.reduce((count, q) => {
    if (!summarizeImportReview(q).needsReview) return count
    if (gradeF && q.grade !== gradeF) return count
    if (subjectF && q.subject !== subjectF) return count
    if (needle && !(q.title?.toLowerCase().includes(needle) || q.subject?.toLowerCase().includes(needle))) return count
    return count + 1
  }, 0), [quizzes, gradeF, subjectF, needle])

  const gradeOptions = tab === 'pastpapers' ? ['7', '12'] : ['4', '5', '6', '7']
  const hasFilters = search || gradeF || subjectF || quizTypeF || paperStatusF || needsReviewOnly
  const counts = { quizzes: quizzes.length, lessons: lessons.length, pastpapers: papers.length }

  const rowActions = {
    publish: publishQuiz,
    daily: q => setDailyQuiz(q),
    unassign: unassignQuiz,
    togglePublish: tab === 'lessons' ? toggleLessonPublish : togglePaperPublish,
    convert: convertPaper,
    remove: item => requestDelete(tab === 'quizzes' ? 'quiz' : tab === 'lessons' ? 'lesson' : 'paper', item),
  }

  const selectStyle = 'border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-bold focus:border-amber-500 focus:outline-none bg-white'

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
      {dailyQuiz && (
        <DailyExamModal quiz={dailyQuiz} onSave={setAsDailyExam} onClose={() => setDailyQuiz(null)} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className="admin-game-eyebrow">Library</span>
          <h1 className="admin-game-display text-gray-800 mt-1 flex items-center gap-2" style={{ fontSize: 30 }}>
            <Icon as={FolderOpen} className="text-[#FF7A1A]" /> Content Library
          </h1>
          <p className="text-sm text-gray-500 mt-1 font-semibold">Edit, publish & organise lessons, quizzes and past papers.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button as={Link} to="/admin/quizzes/new?mode=ai" variant="primary" size="md" leadingIcon={<Icon as={Sparkles} size="sm" />}>AI Quiz</Button>
          <Button as={Link} to="/admin/quizzes/new?mode=import" variant="secondary" size="md" leadingIcon={<Icon as={Download} size="sm" />}>Import (Word/PDF)</Button>
          <Button as={Link} to="/admin/quizzes/new" variant="secondary" size="md" leadingIcon={<Icon as={Plus} size="sm" />}>Manual quiz</Button>
          <Button as={Link} to="/admin/papers/new" variant="secondary" size="md" leadingIcon={<Icon as={FileText} size="sm" />}>Past paper</Button>
          <Button as={Link} to="/admin/lessons/new" variant="secondary" size="md" leadingIcon={<Icon as={BookOpen} size="sm" />}>Lesson</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex flex-wrap gap-1.5 rounded-2xl border-2 border-[#0F1B2D] bg-white p-1.5 shadow-[0_2px_0_#0F1B2D]">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition-all ${
                active
                  ? (t.id === 'pastpapers' ? 'bg-[#1E5FA8] text-white' : 'bg-[#10864E] text-white')
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon as={t.icon} size="sm" /> {t.label}
              <span className={`ml-0.5 rounded-full px-1.5 text-[11px] font-black ${active ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-600'}`}>
                {counts[t.id]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Banners (quizzes only) */}
      {tab === 'quizzes' && !loading && !bannersOff.has('picker') && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
          <span aria-hidden="true">🤖</span>
          <p className="text-amber-800 text-xs leading-snug flex-1">
            <b className="text-sm">Daily Exam auto-picker is on.</b> Every morning (Lusaka time) one short quiz per grade is promoted to today's Daily Exam, then sent back to Practice the next day. Quizzes with {EXAM_ONLY_QUESTION_THRESHOLD}+ questions are exam-only — they never auto-rotate, you pin those manually with 🏆 Set as Daily Exam.
          </p>
          <button onClick={() => setBannersOff(s => new Set(s).add('picker'))} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900 flex-shrink-0">
            <Icon as={X} size="sm" />
          </button>
        </div>
      )}
      {tab === 'quizzes' && !loading && legacyQuizzes.length > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border-2 border-orange-300 bg-orange-50 px-4 py-3">
          <div>
            <p className="font-black text-orange-800 text-sm">⚠ {legacyQuizzes.length} quiz{legacyQuizzes.length !== 1 ? 'zes' : ''} need classification</p>
            <p className="text-orange-700 text-xs mt-0.5">Tag as Practice or Exam-only — or select them below and use the bulk bar.</p>
          </div>
          <button onClick={migrateLegacyQuizzes} disabled={migrating}
            className="flex-shrink-0 bg-orange-500 hover:bg-orange-600 text-white font-black text-xs rounded-xl px-4 py-2 disabled:opacity-50 transition-colors whitespace-nowrap">
            {migrating ? 'Classifying…' : '📝 Classify all'}
          </button>
        </div>
      )}

      {/* Stats */}
      {!loading && (
        <div className="stats-row stagger">
          {stats.map(s => (
            <div key={s.label} className={`stat-tile ${s.t} animate-slide-in-soft`}>
              <span className="stat-num">{s.value}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Icon as={Search} size="sm" /></span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, subject, topic…"
            aria-label="Search content"
            className="w-full border-2 border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
        </div>
        <select value={gradeF} onChange={e => setGradeF(e.target.value)} className={selectStyle}>
          <option value="">All Grades</option>
          {gradeOptions.map(g => <option key={g} value={g}>Grade {g}</option>)}
        </select>
        <select value={subjectF} onChange={e => setSubjectF(e.target.value)} className={selectStyle}>
          {SUBJECTS.map(s => <option key={s} value={s}>{s || 'All Subjects'}</option>)}
        </select>
        {tab === 'quizzes' && (
          <select value={quizTypeF} onChange={e => setQuizTypeF(e.target.value)} className={selectStyle}>
            <option value="">All Types</option>
            <option value="practice">📝 Practice</option>
            <option value="exam_only">🏆 Exam only</option>
            <option value="daily_exam">🏆 Daily Exam</option>
            <option value="unclassified">⚠ Unclassified</option>
            <option value="unpublished">⚠ Unpublished</option>
            <option value="from_past_paper">📄 From past paper</option>
          </select>
        )}
        {tab === 'pastpapers' && (
          <select value={paperStatusF} onChange={e => setPaperStatusF(e.target.value)} className={selectStyle}>
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
            className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              needsReviewOnly ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-gray-200 bg-white text-gray-700 hover:border-amber-300'
            }`}
            title={needsReviewOnly ? 'Click to show all imports' : needsReviewCount > 0 ? `${needsReviewCount} imported draft(s) flagged` : 'No imports need review'}
          >
            ⚠️ Needs review
            {needsReviewCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-black text-white min-w-[20px]">{needsReviewCount}</span>
            )}
          </button>
        )}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className={selectStyle} title="Sort within each subject">
          {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
        </select>
        {hasFilters && (
          <Button variant="ghost" size="sm" leadingIcon={<Icon as={X} size="sm" />}
            onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setQuizTypeF(''); setPaperStatusF(''); setNeedsReviewOnly(false) }}>
            Clear
          </Button>
        )}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-[#F4C7A6] bg-[#FCEADF] px-4 py-2.5">
          <span className="font-black text-[#C2410C] text-sm">{selected.size} selected</span>
          <div className="flex-1" />
          {classifyMode && tab === 'quizzes' ? (
            <>
              <span className="text-xs font-bold text-[#C2410C]">Mark as:</span>
              <button onClick={() => bulkClassify('practice')} disabled={bulkBusy} className="rounded-lg border-2 border-green-300 bg-green-50 px-3 py-1.5 text-xs font-black text-green-700 disabled:opacity-50">📝 Practice</button>
              <button onClick={() => bulkClassify('exam')} disabled={bulkBusy} className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700 disabled:opacity-50">🏆 Exam-only</button>
              <button onClick={() => setClassifyMode(false)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500">Cancel</button>
            </>
          ) : (
            <>
              {tab === 'quizzes' && (
                <button onClick={() => setClassifyMode(true)} disabled={bulkBusy} className="rounded-lg border-2 border-[#F4C7A6] bg-white px-3 py-1.5 text-xs font-black text-[#C2410C] disabled:opacity-50">✏️ Classify</button>
              )}
              <button onClick={bulkPublish} disabled={bulkBusy} className="rounded-lg border-2 border-[#F4C7A6] bg-white px-3 py-1.5 text-xs font-black text-green-700 disabled:opacity-50">✅ Publish</button>
              <button onClick={() => setPendingBulkDelete(true)} disabled={bulkBusy} className="rounded-lg border-2 border-[#F4C7A6] bg-white px-3 py-1.5 text-xs font-black text-red-600 disabled:opacity-50">🗑 Delete</button>
              <button onClick={clearSelection} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500">Clear</button>
            </>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={48} className="rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-2xl border-2 border-[#0F1B2D]/15">
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

          <div className="rounded-2xl border-2 border-[#0F1B2D] bg-white overflow-hidden shadow-[0_2px_0_#0F1B2D]">
            {groups.map(([subject, items], gi) => {
              const isCol = collapsed.has(subject)
              const grpSel = items.length > 0 && items.every(i => selected.has(i.id))
              return (
                <div key={subject} className={gi ? 'border-t-2 border-[#0F1B2D]/10' : ''}>
                  <div
                    className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5 bg-[#FAF6EE] cursor-pointer hover:bg-[#F6F1E7] transition-colors"
                    onClick={() => toggleCollapse(subject)}
                  >
                    <span onClick={e => { e.stopPropagation(); toggleGroup(items) }}>
                      <Box checked={grpSel} onClick={() => {}} label={`Select all in ${subject}`} />
                    </span>
                    <Icon as={isCol ? ChevronRight : ChevronDown} size="sm" className="text-gray-500" />
                    <span className="font-black text-gray-800 text-sm">{subject}</span>
                    <span className="text-[11px] font-black text-gray-500 bg-white border border-[#0F1B2D]/15 rounded-full px-2 py-px">{items.length}</span>
                  </div>
                  {!isCol && items.map(item => (
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
