import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, LayoutGrid, Presentation, Search } from '../ui/icons'
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

  return (
    <Link to={`/lessons/${lesson.id}`} className="lesson group">
      <div className="lesson-icon">
        <Icon as={isPresentation ? Presentation : LayoutGrid} size={18} />
      </div>
      <div className="lesson-body">
        <div className="lesson-tags">
          <span className="lesson-tag">Grade {lesson.grade}</span>
          <span className="lesson-tag">{lesson.subject}</span>
        </div>
        <div className="lesson-title">{lesson.title}</div>
        <div className="lesson-meta">
          <span>{slideCount || '—'} slides</span>
          <span>{readMins} min</span>
          {isPresentation && <span>PowerPoint</span>}
          {lesson.linkedQuizId && <span>Quiz linked</span>}
        </div>
      </div>
      <div className="lesson-chev">
        <Icon as={ChevronRight} size={16} />
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
    <div className="theme-bg theme-text min-h-screen">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        <section className="hero">
          <div className="hero-eyebrow">Lessons</div>
          <h1 className="hero-title">Slide lessons for focused study</h1>
          <p className="hero-sub">Open a topic, move slide by slide, then take the linked quiz.</p>
        </section>

        <label className="search-row">
          <Icon as={Search} size={14} />
          <input
            value={filters.search}
            onChange={event => patchFilter('search', event.target.value)}
            placeholder="Search lessons or topics"
            className="flex-1 bg-transparent text-[12px] font-medium outline-none theme-text placeholder:text-[var(--muted-2)]"
          />
        </label>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <select
            value={filters.grade}
            onChange={event => patchFilter('grade', event.target.value)}
            className="rounded-[var(--r-md)] border border-[var(--line-medium)] bg-[var(--surface)] px-2.5 py-2 text-xs font-semibold theme-text outline-none focus:border-[var(--accent)]"
          >
            <option value="">All Grades</option>
            {LESSON_GRADES.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
          </select>
          <select
            value={filters.subject}
            onChange={event => patchFilter('subject', event.target.value)}
            className="rounded-[var(--r-md)] border border-[var(--line-medium)] bg-[var(--surface)] px-2.5 py-2 text-xs font-semibold theme-text outline-none focus:border-[var(--accent)]"
          >
            <option value="">All Subjects</option>
            {LESSON_SUBJECTS.map(subject => <option key={subject} value={subject}>{subject}</option>)}
          </select>
          <select
            value={filters.topic}
            onChange={event => patchFilter('topic', event.target.value)}
            className="rounded-[var(--r-md)] border border-[var(--line-medium)] bg-[var(--surface)] px-2.5 py-2 text-xs font-semibold theme-text outline-none focus:border-[var(--accent)]"
          >
            <option value="">All Topics</option>
            {topics.map(topic => <option key={topic} value={topic}>{topic}</option>)}
          </select>
        </div>

        <div className="lesson-list">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} height={88} className="rounded-[var(--r-xl)]" />
            ))
          ) : lessons.length === 0 ? (
            <ComingSoon
              title="Lessons Coming Soon"
              message="Teachers are preparing slide lessons for learners. Check back soon or try a quiz."
              icon="▦"
            />
          ) : filtered.length === 0 ? (
            <div className="theme-card theme-border rounded-[var(--r-xl)] border py-12 text-center shadow-[var(--shadow-tight)]">
              <p className="text-display-md theme-text">No lessons match those filters</p>
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
