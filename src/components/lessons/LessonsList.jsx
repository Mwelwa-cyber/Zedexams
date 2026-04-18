import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import ComingSoon from '../ui/ComingSoon'
import SubjectScroller from '../ui/SubjectScroller'

// ── Design tokens ──────────────────────────────────────────────────────────
const GRADES = ['4', '5', '6']
const TERMS  = ['1', '2', '3']

const SUBJECTS = [
  { id: 'Mathematics',        label: 'Mathematics',        icon: '➗', color: 'blue'   },
  { id: 'English',            label: 'English',            icon: '📝', color: 'violet' },
  { id: 'Integrated Science', label: 'Integrated Science', icon: '🔬', color: 'orange' },
  { id: 'Social Studies',     label: 'Social Studies',     icon: '🌍', color: 'teal'   },
  { id: 'Technology Studies', label: 'Technology Studies', icon: '⚙️', color: 'cyan'   },
  { id: 'Home Economics',     label: 'Home Economics',     icon: '🏠', color: 'pink'   },
  { id: 'Expressive Arts',    label: 'Expressive Arts',    icon: '🎨', color: 'rose'   },
]

const SUBJECT_STYLES = {
  blue:   { bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',    accent: 'border-l-blue-500',   icon: 'bg-blue-100 text-blue-700',   obj: 'bg-blue-50'   },
  violet: { bg: 'bg-violet-50', badge: 'bg-violet-100 text-violet-700',accent: 'border-l-violet-500', icon: 'bg-violet-100 text-violet-700',obj: 'bg-violet-50' },
  orange: { bg: 'bg-orange-50', badge: 'bg-orange-100 text-orange-700',accent: 'border-l-orange-500', icon: 'bg-orange-100 text-orange-700',obj: 'bg-orange-50' },
  teal:   { bg: 'bg-teal-50',   badge: 'bg-teal-100 text-teal-700',    accent: 'border-l-teal-500',   icon: 'bg-teal-100 text-teal-700',   obj: 'bg-teal-50'   },
  cyan:   { bg: 'bg-cyan-50',   badge: 'bg-cyan-100 text-cyan-700',    accent: 'border-l-cyan-500',   icon: 'bg-cyan-100 text-cyan-700',   obj: 'bg-cyan-50'   },
  pink:   { bg: 'bg-pink-50',   badge: 'bg-pink-100 text-pink-700',    accent: 'border-l-pink-500',   icon: 'bg-pink-100 text-pink-700',   obj: 'bg-pink-50'   },
  rose:   { bg: 'bg-rose-50',   badge: 'bg-rose-100 text-rose-700',    accent: 'border-l-rose-500',   icon: 'bg-rose-100 text-rose-700',   obj: 'bg-rose-50'   },
  gray:   { bg: 'bg-gray-50',   badge: 'bg-gray-100 text-gray-700',    accent: 'border-l-gray-400',   icon: 'bg-gray-100 text-gray-700',   obj: 'bg-gray-50'   },
}

const GRADE_STYLES = {
  '4': { badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  '5': { badge: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500'    },
  '6': { badge: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500'  },
}

function getSubjectMeta(subjectId) {
  const sub = SUBJECTS.find(s => s.id === subjectId)
  if (!sub) return { icon: '📄', style: SUBJECT_STYLES.gray, label: subjectId ?? 'Unknown' }
  return { icon: sub.icon, style: SUBJECT_STYLES[sub.color], label: sub.label }
}

// ── Filter chip ────────────────────────────────────────────────────────────
function Chip({ label, active, onClick, icon }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 whitespace-nowrap ${
        active
          ? 'bg-purple-600 text-white shadow-md shadow-purple-200'
          : 'theme-card border theme-border theme-text-muted hover:theme-bg-subtle hover:theme-text'
      }`}>
      {icon && <span className="text-xs">{icon}</span>}
      {label}
    </button>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function LessonSkeleton() {
  return (
    <div className="theme-card rounded-2xl border theme-border border-l-4 border-l-gray-200 p-4 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 theme-bg-subtle rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2.5 pt-0.5">
          <div className="h-4 theme-bg-subtle rounded-lg w-3/4" />
          <div className="h-3 theme-bg-subtle rounded-lg w-2/5" />
          <div className="flex gap-2">
            <div className="h-5 theme-bg-subtle rounded-full w-24" />
            <div className="h-5 theme-bg-subtle rounded-full w-16" />
          </div>
        </div>
        <div className="w-6 h-6 theme-bg-subtle rounded-full flex-shrink-0 mt-1" />
      </div>
    </div>
  )
}

// ── Lesson card ────────────────────────────────────────────────────────────
function LessonCard({ lesson }) {
  const { icon, style } = getSubjectMeta(lesson.subject)
  const gradeStyle = GRADE_STYLES[lesson.grade] ?? GRADE_STYLES['6']
  const wordCount  = lesson.content ? lesson.content.split(/\s+/).length : 0
  const slideCount = lesson.presentation?.slideCount || lesson.slides?.length || 0
  const readMins   = Math.max(1, Math.round(Math.max(wordCount / 200, slideCount * 0.8)))
  const isPresentation = lesson.mode === 'pptx_viewer' || lesson.creationMode === 'pptx_viewer'

  return (
    <Link to={`/lessons/${lesson.id}`}
      className={`block theme-card rounded-2xl border theme-border border-l-4 ${style.accent} theme-shadow hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group`}>
      <div className="p-4 flex items-start gap-4">
        {/* Subject icon */}
        <div className={`${style.icon} w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-105 transition-transform`}>
          {isPresentation ? '▣' : icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-black theme-text text-sm leading-snug group-hover:theme-accent-text transition-colors line-clamp-2">
            {lesson.title}
          </h3>
          {lesson.topic && (
            <p className="theme-text-muted text-xs mt-0.5 truncate">{lesson.topic}</p>
          )}
          <div className="flex gap-1.5 mt-2 flex-wrap items-center">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>{lesson.subject}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${gradeStyle.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${gradeStyle.dot}`} />
              Grade {lesson.grade}
            </span>
            {lesson.term && (
              <span className="theme-bg-subtle theme-text-muted text-xs font-bold px-2 py-0.5 rounded-full">Term {lesson.term}</span>
            )}
            <span className="theme-text-muted text-xs flex items-center gap-1">
              <span>⏱</span> {readMins} min read
            </span>
            {isPresentation && (
              <span className="theme-bg-subtle theme-text-muted text-xs font-bold px-2 py-0.5 rounded-full">PowerPoint viewer</span>
            )}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full theme-bg-subtle group-hover:theme-accent-bg flex items-center justify-center theme-text-muted group-hover:theme-accent-text group-hover:translate-x-0.5 transition-all">
          →
        </div>
      </div>

      {/* Objectives preview */}
      {lesson.objectives?.length > 0 && (
        <div className={`mx-4 mb-4 ${style.obj} rounded-xl px-3 py-2`}>
          <p className="text-xs font-black theme-text-muted mb-0.5">Learning objectives</p>
          <p className="text-xs theme-text-muted leading-relaxed line-clamp-2">
            {Array.isArray(lesson.objectives)
              ? lesson.objectives.slice(0, 2).join(' · ')
              : lesson.objectives}
          </p>
        </div>
      )}
    </Link>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function LessonsList() {
  const { getLessons } = useFirestore()

  const [lessons, setLessons]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [gradeF, setGradeF]     = useState('')
  const [subjectF, setSubjectF] = useState('')
  const [termF, setTermF]       = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await getLessons({ grade: gradeF, subject: subjectF })
      setLessons(data)
      setLoading(false)
    }
    load()
  }, [gradeF, subjectF])

  const filtered = lessons.filter(l =>
    (!termF   || l.term === termF) &&
    (!search  || l.title.toLowerCase().includes(search.toLowerCase()) ||
                 (l.topic ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  const hasActiveFilter = gradeF || subjectF || termF || search

  return (
    <div className="min-h-screen theme-bg">
      {/* ── Hero banner ────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-purple-700 via-purple-600 to-fuchsia-600 px-4 pt-6 pb-8">
        <div className="max-w-2xl md:max-w-3xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-white/20 text-white text-xs font-black px-3 py-1 rounded-full backdrop-blur-sm">
                  📚 Lessons
                </span>
              </div>
              <h1 className="text-2xl font-black text-white leading-tight mt-2">
                Study Notes & Lessons
              </h1>
              <p className="text-purple-200 text-sm mt-1">
                Full study notes for Grades 4–7 — CBC aligned
              </p>
            </div>
            {!loading && (
              <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 text-center flex-shrink-0">
                <p className="text-2xl font-black text-white">{lessons.length}</p>
                <p className="text-purple-200 text-xs font-bold">Lessons</p>
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative mt-4">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-300">🔍</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search lessons or topics…"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 backdrop-blur-sm text-white placeholder-purple-300 border border-white/20 focus:outline-none focus:bg-white/25 text-sm font-medium"
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl md:max-w-3xl mx-auto px-4 -mt-3">
        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="theme-card rounded-2xl border theme-border theme-shadow p-4 mb-5 space-y-3">
          <div>
            <p className="text-xs font-black theme-text-muted uppercase tracking-wider mb-2">Grade</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All" active={!gradeF} onClick={() => setGradeF('')} />
              {GRADES.map(g => (
                <Chip key={g} label={`Grade ${g}`} active={gradeF === g}
                  onClick={() => setGradeF(g === gradeF ? '' : g)} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-black theme-text-muted uppercase tracking-wider mb-2">Term</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All Terms" active={!termF} onClick={() => setTermF('')} />
              {TERMS.map(t => (
                <Chip key={t} label={`Term ${t}`} active={termF === t}
                  onClick={() => setTermF(t === termF ? '' : t)} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-black theme-text-muted uppercase tracking-wider mb-2">Subject</p>
            <SubjectScroller
              subjects={SUBJECTS}
              value={subjectF}
              onChange={setSubjectF}
              variant="purple"
            />
          </div>
          {hasActiveFilter && (
            <button
              onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
              className="text-xs text-red-500 font-bold hover:text-red-700 min-h-0 bg-transparent shadow-none p-0">
              ✕ Clear all filters
            </button>
          )}
        </div>

        {/* Results count */}
        {!loading && filtered.length > 0 && (
          <p className="text-xs theme-text-muted font-bold mb-3 px-1">
            {filtered.length} lesson{filtered.length !== 1 ? 's' : ''} found
            {hasActiveFilter && ' (filtered)'}
          </p>
        )}

        {/* ── List ─────────────────────────────────────────────────────────── */}
        <div className="space-y-3 pb-10">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <LessonSkeleton key={i} />)
          ) : lessons.length === 0 ? (
            <ComingSoon
              title="Lessons Coming Soon"
              message="Study notes are being prepared and will be published soon. Try a quiz in the meantime!"
              icon="📚"
            />
          ) : filtered.length === 0 ? (
            <div className="theme-card rounded-2xl border theme-border py-14 text-center theme-shadow">
              <div className="text-4xl mb-3">🔍</div>
              <p className="font-black theme-text">No lessons match your filters</p>
              <p className="theme-text-muted text-sm mt-1">Try adjusting grade, subject, or term</p>
              <button
                onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
                className="mt-4 text-purple-600 font-black text-sm hover:underline min-h-0 bg-transparent shadow-none">
                Clear filters →
              </button>
            </div>
          ) : (
            filtered.map(lesson => <LessonCard key={lesson.id} lesson={lesson} />)
          )}
        </div>
      </div>
    </div>
  )
}
