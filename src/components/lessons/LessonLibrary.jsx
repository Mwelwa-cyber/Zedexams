import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, LayoutGrid, Presentation } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import ComingSoon from '../ui/ComingSoon'
import { LESSON_GRADES, LESSON_SUBJECTS } from './lessonConstants'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'

function getReadTime(lesson) {
  const words = String(lesson.content || '').split(/\s+/).filter(Boolean).length
  const slides = lesson.presentation?.slideCount || lesson.slides?.length || 0
  return Math.max(1, Math.round(Math.max(words / 180, slides * 0.8)))
}

function LessonCard({ lesson }) {
  const isPresentation = lesson.mode === 'pptx_viewer' || lesson.creationMode === 'pptx_viewer'
  const slideCount = lesson.presentation?.slideCount || lesson.slides?.length || 0
  const readMins = getReadTime(lesson)
  // Avoid showing the topic as a subtitle when it just repeats the title
  // (case/whitespace-insensitive). Common in imported content.
  const normalize = s => String(s ?? '').trim().toLowerCase()
  const showTopic = lesson.topic && normalize(lesson.topic) !== normalize(lesson.title)

  return (
    <Link
      to={`/lessons/${lesson.id}`}
      className="group block rounded-3xl border theme-border bg-white p-4 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md"
    >
      <div className="flex gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <Icon as={isPresentation ? Presentation : LayoutGrid} size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-black text-sky-700">Grade {lesson.grade}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-700">{lesson.subject}</span>
          </div>
          <h2 className="text-display-md text-gray-900 mt-2 group-hover:text-emerald-700 transition-colors duration-fast">{lesson.title}</h2>
          {showTopic && <p className="mt-1 text-body-sm font-bold text-gray-500">{lesson.topic}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-gray-50 px-2 py-0.5 text-xs font-black text-gray-600">{slideCount || 'Slide'} slides</span>
            {isPresentation && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-black text-sky-700">PowerPoint viewer</span>}
            <span className="rounded-full bg-gray-50 px-2 py-0.5 text-xs font-black text-gray-600">{readMins} min</span>
            {lesson.linkedQuizId && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-700">Quiz linked</span>}
          </div>
        </div>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-400 transition-all duration-fast ease-out group-hover:bg-emerald-600 group-hover:text-white group-hover:shadow-elev-sm">
          <Icon as={ChevronRight} size="md" />
        </div>
      </div>
    </Link>
  )
}

export default function LessonLibrary() {
  const { getLessons } = useFirestore()
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ search: '', grade: '', subject: '', topic: '' })

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await getLessons({ grade: filters.grade, subject: filters.subject })
      setLessons(data)
      setLoading(false)
    }
    load()
  }, [filters.grade, filters.subject])

  const topics = useMemo(() => [...new Set(lessons.map(lesson => lesson.topic).filter(Boolean))].sort(), [lessons])

  const filtered = useMemo(() => {
    const search = filters.search.toLowerCase()
    return lessons.filter(lesson => (
      (!filters.topic || lesson.topic === filters.topic) &&
      (!search || [lesson.title, lesson.subject, lesson.topic].some(value => String(value || '').toLowerCase().includes(search)))
    ))
  }, [filters, lessons])

  function patchFilter(field, value) {
    setFilters(current => ({ ...current, [field]: value }))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-emerald-700 via-sky-700 to-amber-500 px-4 py-8 text-white shadow-elev-lg">
        <div className="mx-auto max-w-5xl">
          <p className="text-eyebrow" style={{ color: 'rgba(255,255,255,0.75)' }}>Lessons</p>
          <h1 className="text-display-xl mt-2">Slide lessons for focused study</h1>
          <p className="text-body mt-2 max-w-2xl text-white/80 font-bold">
            Open a topic, move slide by slide, then take the linked quiz or check activity answers.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="-mt-10 rounded-3xl border border-white/70 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(130px,0.6fr))]">
            <input value={filters.search} onChange={event => patchFilter('search', event.target.value)} placeholder="Search lessons or topics" className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500" />
            <select value={filters.grade} onChange={event => patchFilter('grade', event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500">
              <option value="">All Grades</option>
              {LESSON_GRADES.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
            </select>
            <select value={filters.subject} onChange={event => patchFilter('subject', event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500">
              <option value="">All Subjects</option>
              {LESSON_SUBJECTS.map(subject => <option key={subject} value={subject}>{subject}</option>)}
            </select>
            <select value={filters.topic} onChange={event => patchFilter('topic', event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500">
              <option value="">All Topics</option>
              {topics.map(topic => <option key={topic} value={topic}>{topic}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={128} className="rounded-3xl" />
            ))
          ) : lessons.length === 0 ? (
            <ComingSoon
              title="Lessons Coming Soon"
              message="Teachers are preparing slide lessons for learners. Check back soon or try a quiz."
              icon="▦"
            />
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border theme-border bg-white py-16 text-center shadow-elev-sm">
              <h2 className="text-display-lg text-gray-900">No lessons match those filters</h2>
              <div className="mt-3 inline-flex">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setFilters({ search: '', grade: '', subject: '', topic: '' })}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          ) : (
            filtered.map(lesson => <LessonCard key={lesson.id} lesson={lesson} />)
          )}
        </div>
      </div>
    </div>
  )
}
