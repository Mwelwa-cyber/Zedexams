import { useState, useEffect } from 'react'
import { useFirestore } from '../../hooks/useFirestore'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'
import ComingSoon from '../ui/ComingSoon'
import SubjectScroller from '../ui/SubjectScroller'

// ── Design tokens ──────────────────────────────────────────────────────────
const GRADES = ['4', '5', '6', '7']
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
  blue:   { badge: 'bg-blue-100 text-blue-700',    accent: 'border-l-blue-500',   icon: 'bg-blue-100 text-blue-700'   },
  violet: { badge: 'bg-violet-100 text-violet-700',accent: 'border-l-violet-500', icon: 'bg-violet-100 text-violet-700'},
  orange: { badge: 'bg-orange-100 text-orange-700',accent: 'border-l-orange-500', icon: 'bg-orange-100 text-orange-700'},
  teal:   { badge: 'bg-teal-100 text-teal-700',    accent: 'border-l-teal-500',   icon: 'bg-teal-100 text-teal-700'   },
  cyan:   { badge: 'bg-cyan-100 text-cyan-700',    accent: 'border-l-cyan-500',   icon: 'bg-cyan-100 text-cyan-700'   },
  pink:   { badge: 'bg-pink-100 text-pink-700',    accent: 'border-l-pink-500',   icon: 'bg-pink-100 text-pink-700'   },
  rose:   { badge: 'bg-rose-100 text-rose-700',    accent: 'border-l-rose-500',   icon: 'bg-rose-100 text-rose-700'   },
  gray:   { badge: 'bg-gray-100 text-gray-700',    accent: 'border-l-gray-400',   icon: 'bg-gray-100 text-gray-700'   },
}

const GRADE_STYLES = {
  '4': { badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  '5': { badge: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500'    },
  '6': { badge: 'bg-orange-100 text-orange-700',   dot: 'bg-orange-500'  },
  '7': { badge: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500'  },
}

// Year range for filter — built from real paper data so older papers aren't hidden
const DEFAULT_YEARS = ['2024', '2023', '2022', '2021', '2020']

function getSubjectMeta(subjectId) {
  const sub = SUBJECTS.find(s => s.id === subjectId)
  if (!sub) return { icon: '📄', style: SUBJECT_STYLES.gray }
  return { icon: sub.icon, style: SUBJECT_STYLES[sub.color] }
}

/**
 * Normalise a paper title for display. Older imports saved subject names
 * with inconsistent casing (e.g. "2017 Social studies"). Fix them at the
 * display layer so user-facing strings stay consistent regardless of how
 * the underlying record was stored.
 */
function prettifyPaperTitle(title = '') {
  const KNOWN_SUBJECTS = [
    'Mathematics',
    'English',
    'Integrated Science',
    'Social Studies',
    'Technology Studies',
    'Home Economics',
    'Expressive Arts',
  ]
  let out = String(title)
  for (const s of KNOWN_SUBJECTS) {
    // Case-insensitive replace → canonical casing
    out = out.replace(new RegExp(`\\b${s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'ig'), s)
  }
  return out
}

// ── Chip ───────────────────────────────────────────────────────────────────
function Chip({ label, active, onClick, icon }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 whitespace-nowrap ${
        active
          ? 'bg-amber-600 text-white shadow-md shadow-amber-200'
          : 'theme-card border theme-border theme-text-muted hover:theme-bg-subtle hover:theme-text'
      }`}>
      {icon && <span className="text-xs">{icon}</span>}
      {label}
    </button>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function PaperSkeleton() {
  return (
    <div className="theme-card rounded-2xl border theme-border border-l-4 border-l-gray-200 p-4 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="w-12 h-14 theme-bg-subtle rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2.5 pt-0.5">
          <div className="h-4 theme-bg-subtle rounded-lg w-3/4" />
          <div className="flex gap-2">
            <div className="h-5 theme-bg-subtle rounded-full w-24" />
            <div className="h-5 theme-bg-subtle rounded-full w-16" />
          </div>
          <div className="h-3 theme-bg-subtle rounded w-1/3" />
        </div>
        <div className="w-24 h-10 theme-bg-subtle rounded-xl flex-shrink-0" />
      </div>
    </div>
  )
}

// ── Paper card ─────────────────────────────────────────────────────────────
function PaperCard({ paper, index, isPremium, paperLimit, onDownload, onUpgrade }) {
  const locked = !isPremium && index >= paperLimit
  const { icon, style } = getSubjectMeta(paper.subject)
  const gradeStyle = GRADE_STYLES[paper.grade] ?? GRADE_STYLES['6']
  const url = paper.fileURL || paper.fileUrl
  const sizeMB = paper.fileSize ? (paper.fileSize / (1024 * 1024)).toFixed(1) : null

  return (
    <div className={`theme-card rounded-2xl border theme-border border-l-4 ${style.accent} theme-shadow transition-all duration-200 ${
      locked ? 'opacity-70' : 'hover:shadow-md hover:-translate-y-0.5'
    }`}>
      <div className="p-4 flex items-start gap-4">
        {/* PDF icon */}
        <div className={`${style.icon} w-12 h-14 rounded-xl flex flex-col items-center justify-center flex-shrink-0 relative`}>
          <span className="text-xl">{icon}</span>
          <span className="text-xs font-black opacity-70 mt-0.5">PDF</span>
          {locked && (
            <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center shadow">
              🔒
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-black theme-text text-sm leading-snug line-clamp-2">{prettifyPaperTitle(paper.title)}</h3>
          <div className="flex gap-1.5 mt-2 flex-wrap items-center">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>{paper.subject}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${gradeStyle.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${gradeStyle.dot}`} />
              Grade {paper.grade}
            </span>
            {paper.term && (
              <span className="theme-bg-subtle theme-text-muted text-xs font-bold px-2 py-0.5 rounded-full">Term {paper.term}</span>
            )}
            {paper.year && (
              <span className="theme-bg-subtle theme-text-muted text-xs px-2 py-0.5 rounded-full font-bold">{paper.year}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            {paper.downloadCount > 0 && (
              <span className="text-xs theme-text-muted flex items-center gap-1">
                <span>⬇</span> {paper.downloadCount} download{paper.downloadCount !== 1 ? 's' : ''}
              </span>
            )}
            {sizeMB && (
              <span className="text-xs theme-text-muted">{sizeMB} MB</span>
            )}
          </div>
        </div>

        {/* Action */}
        <div className="flex-shrink-0">
          {locked ? (
            <button onClick={onUpgrade}
              className="flex flex-col items-center gap-0.5 bg-amber-50 border border-amber-200 text-amber-700 font-black text-xs px-3 py-2.5 rounded-xl min-h-0 hover:bg-amber-100 transition-colors">
              <span className="text-base">⭐</span>
              <span>Upgrade</span>
            </button>
          ) : url ? (
            <button onClick={() => onDownload(paper, index)}
              className="flex flex-col items-center gap-0.5 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs px-4 py-2.5 rounded-xl min-h-0 transition-all shadow-sm shadow-amber-200 hover:shadow-md hover:-translate-y-0.5">
              <span className="text-base">⬇</span>
              <span>Download</span>
            </button>
          ) : (
            <span className="text-xs theme-text-muted font-bold px-3 py-2.5">Unavailable</span>
          )}
        </div>
      </div>

      {/* Premium lock bar */}
      {locked && (
        <div className="border-t border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 rounded-b-2xl px-4 py-2.5 flex items-center justify-between gap-2">
          <p className="text-amber-700 text-xs font-bold flex items-center gap-1.5">
            <span>⭐</span> Premium required for unlimited papers
          </p>
          <button onClick={onUpgrade}
            className="text-amber-700 text-xs font-black bg-amber-100 hover:bg-amber-200 px-3 py-1 rounded-full min-h-0 transition-colors">
            Upgrade →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function PapersLibrary() {
  const { getPapers, incrementDownload } = useFirestore()
  const { isPremium, paperLimit }        = useSubscription()

  const [papers, setPapers]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [gradeF, setGradeF]     = useState('')
  const [subjectF, setSubjectF] = useState('')
  const [termF, setTermF]       = useState('')
  const [yearF, setYearF]       = useState('')
  const [search, setSearch]     = useState('')
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await getPapers({ grade: gradeF, subject: subjectF, term: termF })
      setPapers(data)
      setLoading(false)
    }
    load()
  }, [gradeF, subjectF, termF])

  const filtered = papers.filter(p =>
    (!yearF  || p.year === yearF) &&
    (!search || p.title?.toLowerCase().includes(search.toLowerCase()))
  )

  // Build the year filter list from real paper data, falling back to recent years
  // so we never hide a paper because its year isn't in a hard-coded list.
  const availableYears = Array.from(
    new Set([
      ...DEFAULT_YEARS,
      ...papers.map(p => String(p.year ?? '').trim()).filter(Boolean),
    ])
  ).sort((a, b) => b.localeCompare(a))

  async function handleDownload(paper, idx) {
    if (!isPremium && idx >= paperLimit) { setShowUpgrade(true); return }
    const url = paper.fileURL || paper.fileUrl
    if (url) {
      await incrementDownload(paper.id)
      window.open(url, '_blank')
    }
  }

  const hasActiveFilter = gradeF || subjectF || termF || yearF || search

  return (
    <div className="min-h-screen theme-bg">
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      {/* ── Hero banner ────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-amber-600 via-orange-600 to-rose-600 px-4 pt-6 pb-8">
        <div className="max-w-2xl md:max-w-3xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-white/20 text-white text-xs font-black px-3 py-1 rounded-full backdrop-blur-sm">
                  📄 Past Papers
                </span>
              </div>
              <h1 className="text-2xl font-black text-white leading-tight mt-2">
                Exam Past Papers
              </h1>
              <p className="text-orange-200 text-sm mt-1">
                Real exam papers for Grades 4–7 — download & practise
              </p>
            </div>
            {!loading && (
              <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 text-center flex-shrink-0">
                <p className="text-2xl font-black text-white">{papers.length}</p>
                <p className="text-orange-200 text-xs font-bold">Papers</p>
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative mt-4">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-300">🔍</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search papers…"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 backdrop-blur-sm text-white placeholder-orange-300 border border-white/20 focus:outline-none focus:bg-white/25 text-sm font-medium"
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl md:max-w-3xl mx-auto px-4 -mt-3">
        {/* Premium banner */}
        {!isPremium && (
          <div className="bg-gradient-to-r from-amber-600 to-orange-600 rounded-2xl p-4 mb-4 flex items-center justify-between gap-3 shadow-md shadow-amber-200">
            <div>
              <p className="font-black text-white text-sm">
                🆓 {paperLimit} paper{paperLimit !== 1 ? 's' : ''} free
              </p>
              <p className="text-amber-200 text-xs mt-0.5">Upgrade for unlimited access to all past papers</p>
            </div>
            <button onClick={() => setShowUpgrade(true)}
              className="bg-white text-amber-700 font-black text-xs px-4 py-2.5 rounded-xl flex-shrink-0 min-h-0 hover:bg-amber-50 transition-colors shadow-sm">
              ⭐ Upgrade
            </button>
          </div>
        )}

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
              variant="amber"
            />
          </div>
          <div>
            <p className="text-xs font-black theme-text-muted uppercase tracking-wider mb-2">Year</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All Years" active={!yearF} onClick={() => setYearF('')} />
              {availableYears.map(y => (
                <Chip key={y} label={y} active={yearF === y}
                  onClick={() => setYearF(y === yearF ? '' : y)} />
              ))}
            </div>
          </div>
          {hasActiveFilter && (
            <button
              onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF(''); setYearF('') }}
              className="text-xs text-red-500 font-bold hover:text-red-700 min-h-0 bg-transparent shadow-none p-0">
              ✕ Clear all filters
            </button>
          )}
        </div>

        {/* Results count */}
        {!loading && filtered.length > 0 && (
          <p className="text-xs theme-text-muted font-bold mb-3 px-1">
            {filtered.length} paper{filtered.length !== 1 ? 's' : ''} found
            {hasActiveFilter && ' (filtered)'}
          </p>
        )}

        {/* ── Papers list ───────────────────────────────────────────────────── */}
        <div className="space-y-3 pb-10">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <PaperSkeleton key={i} />)
          ) : papers.length === 0 ? (
            <ComingSoon
              title="Past Papers Coming Soon"
              message="Exam papers are being prepared and will be uploaded soon. Try a quiz while you wait!"
              icon="📄"
            />
          ) : filtered.length === 0 ? (
            <div className="theme-card rounded-2xl border theme-border py-14 text-center theme-shadow">
              <div className="text-4xl mb-3">🔍</div>
              <p className="font-black theme-text">No papers match your filters</p>
              <p className="theme-text-muted text-sm mt-1">Try a different grade, term, subject, or year</p>
              <button
                onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF(''); setYearF('') }}
                className="mt-4 text-amber-600 font-black text-sm hover:underline min-h-0 bg-transparent shadow-none">
                Clear filters →
              </button>
            </div>
          ) : (
            filtered.map((paper, idx) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                index={idx}
                isPremium={isPremium}
                paperLimit={paperLimit}
                onDownload={handleDownload}
                onUpgrade={() => setShowUpgrade(true)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
