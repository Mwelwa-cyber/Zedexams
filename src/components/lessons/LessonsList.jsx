import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import ComingSoon from '../ui/ComingSoon'

const SUBJECTS = ['Mathematics', 'English', 'Science', 'Social Studies']
const GRADES   = ['5', '6', '7']
const TERMS    = ['1', '2', '3']

const subjectStyle = {
  Mathematics:      { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',   icon: '🔢' },
  English:          { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700', icon: '📖' },
  Science:          { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', icon: '🔬' },
  'Social Studies': { bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   badge: 'bg-teal-100 text-teal-700',   icon: '🌍' },
}

function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 whitespace-nowrap ${
        active ? 'bg-green-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-green-400 hover:text-green-700'
      }`}>
      {label}
    </button>
  )
}

function LessonSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 bg-gray-200 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 bg-gray-200 rounded-lg w-3/4" />
          <div className="h-3 bg-gray-200 rounded-lg w-1/2" />
          <div className="flex gap-2 mt-2">
            <div className="h-5 bg-gray-200 rounded-full w-20" />
            <div className="h-5 bg-gray-200 rounded-full w-14" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LessonsList() {
  const { getLessons } = useFirestore()

  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [gradeF, setGradeF]   = useState('')
  const [subjectF, setSubjectF] = useState('')
  const [termF, setTermF]     = useState('')

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
    (!termF || l.term === termF) &&
    (!search || l.title.toLowerCase().includes(search.toLowerCase()) ||
                (l.topic || '').toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-black text-gray-800">📚 Lessons</h1>
        <p className="text-gray-500 text-sm mt-0.5">Study lesson notes for all subjects and grades</p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search lessons or topics…"
          className="w-full pl-9 pr-4 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-green-500 focus:outline-none" />
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-5">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Chip label="All Grades" active={!gradeF} onClick={() => setGradeF('')} />
          {GRADES.map(g => (
            <Chip key={g} label={`Grade ${g}`} active={gradeF === g} onClick={() => setGradeF(g === gradeF ? '' : g)} />
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Chip label="All Subjects" active={!subjectF} onClick={() => setSubjectF('')} />
          {SUBJECTS.map(s => (
            <Chip key={s} label={s} active={subjectF === s} onClick={() => setSubjectF(s === subjectF ? '' : s)} />
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Chip label="All Terms" active={!termF} onClick={() => setTermF('')} />
          {TERMS.map(t => (
            <Chip key={t} label={`Term ${t}`} active={termF === t} onClick={() => setTermF(t === termF ? '' : t)} />
          ))}
        </div>
      </div>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-gray-400 font-bold mb-3">{filtered.length} lesson{filtered.length !== 1 ? 's' : ''} found</p>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <LessonSkeleton key={i} />)}
        </div>
      ) : lessons.length === 0 ? (
        // No lessons in Firestore at all
        <ComingSoon
          title="Lessons Coming Soon"
          message="Study notes haven't been published yet. Your teacher is busy preparing them — check back soon!"
          icon="📚"
        />
      ) : filtered.length === 0 ? (
        // Lessons exist but none match the current filters
        <ComingSoon
          onClearFilters={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(lesson => {
            const s = subjectStyle[lesson.subject] ?? { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', badge: 'bg-gray-100 text-gray-700', icon: '📄' }
            const wordCount = lesson.content ? lesson.content.split(/\s+/).length : 0
            const readMins  = Math.max(1, Math.round(wordCount / 200))

            return (
              <Link key={lesson.id} to={`/lessons/${lesson.id}`}
                className="block bg-white rounded-2xl border border-gray-100 p-4 hover:shadow-md hover:border-green-200 transition-all group">
                <div className="flex items-start gap-3">
                  {/* Subject icon */}
                  <div className={`${s.bg} ${s.border} border w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-105 transition-transform`}>
                    {s.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-800 text-sm leading-snug group-hover:text-green-700 transition-colors">{lesson.title}</p>
                    {lesson.topic && <p className="text-gray-500 text-xs mt-0.5">{lesson.topic}</p>}
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.badge}`}>{lesson.subject}</span>
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">Grade {lesson.grade}</span>
                      <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">Term {lesson.term}</span>
                      <span className="text-gray-400 text-xs px-1 flex items-center gap-0.5">⏱ {readMins} min read</span>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex-shrink-0 text-gray-300 group-hover:text-green-500 group-hover:translate-x-1 transition-all text-lg">→</div>
                </div>

                {/* Objectives preview */}
                {lesson.objectives?.length > 0 && (
                  <div className="mt-3 ml-15 pl-15">
                    <div className={`${s.bg} rounded-xl px-3 py-2 ml-[60px]`}>
                      <p className="text-xs font-bold text-gray-500 mb-1">Learning objectives:</p>
                      <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">
                        {Array.isArray(lesson.objectives)
                          ? lesson.objectives.slice(0, 2).join(' · ')
                          : lesson.objectives}
                      </p>
                    </div>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
