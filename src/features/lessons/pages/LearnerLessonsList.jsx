// src/features/lessons/pages/LearnerLessonsList.jsx
//
// /lessons — interactive slide-based lessons for the learner. Sibling of
// /notes (reading material) and a separate menu item in the navbar. The
// two surfaces share the underlying Firestore collection today but are
// presented as distinct learner experiences.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Lock } from '../../../components/ui/icons'
import { useLearnerProfile } from '../../notes/hooks/useLearnerProfile'
import { useLearnerLessons } from '../hooks/useLearnerLessons'
import { LearnerLessonCard } from '../components/LearnerLessonCard'
import { getSubjectsForGrade } from '../../../config/curriculum'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import '../../notes/styles/notes.css'

export function LearnerLessonsList() {
  const navigate = useNavigate()
  const { user, profile } = useLearnerProfile()
  const grade = profile?.grade

  const [activeSubject, setActiveSubject] = useState('all')
  const [search, setSearch] = useState('')

  const { lessons, allLessons, countsBySubject, loading } =
    useLearnerLessons({ grade, subject: activeSubject, search })

  const subjects = getSubjectsForGrade(grade)
  const firstName = user?.displayName?.split(' ')[0] || 'there'

  const grouped = activeSubject === 'all'
    ? subjects.reduce((acc, s) => {
        const list = lessons.filter(l => l.subject === s)
        if (list.length) acc[s] = list
        return acc
      }, {})
    : { [activeSubject]: lessons }

  return (
    <div className="notes-studio min-h-screen pb-24 md:pb-8" style={{ backgroundColor: '#FAFAF7' }}>
      <SeoHelmet title="Lessons" path="/lessons" noIndex />
      <main className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
        <div className="mb-6">
          <div className="text-xs tracking-[0.2em] uppercase text-neutral-500 mb-2">Interactive lessons</div>
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight mb-2 text-neutral-900">
            Ready to learn, <span className="font-display-italic">{firstName}.</span>
          </h1>
          <p className="text-base text-neutral-600">
            {allLessons.length === 0
              ? `Interactive lessons for Grade ${grade} are on the way.`
              : `${allLessons.length} lesson${allLessons.length === 1 ? '' : 's'} ready for Grade ${grade}.`}
          </p>
        </div>

        {allLessons.length > 0 && (
          <div className="relative mb-4 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white rounded-lg border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 transition"
            />
          </div>
        )}

        {allLessons.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
            <SubjectChip active={activeSubject === 'all'} onClick={() => setActiveSubject('all')}>
              All <span className="opacity-60">· {allLessons.length}</span>
            </SubjectChip>
            {subjects
              .filter(s => countsBySubject[s])
              .map(s => (
                <SubjectChip key={s} active={activeSubject === s} onClick={() => setActiveSubject(s)}>
                  {s} <span className="opacity-60">· {countsBySubject[s]}</span>
                </SubjectChip>
              ))}
          </div>
        )}

        {loading && allLessons.length === 0 && <SkeletonGrid />}

        {!loading && allLessons.length === 0 && (
          <EmptyState grade={grade} />
        )}

        {!loading && Object.keys(grouped).length > 0 && (
          <div className="space-y-10">
            {Object.entries(grouped).map(([subject, list]) => (
              <section key={subject}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="font-display text-2xl tracking-tight text-neutral-900">{subject}</h2>
                  <span className="text-xs text-neutral-400">{list.length} lesson{list.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {list.map(lesson => (
                    <LearnerLessonCard
                      key={lesson.id}
                      lesson={lesson}
                      onClick={() => navigate(`/lessons/${lesson.id}`)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {!loading && allLessons.length > 0 && Object.keys(grouped).length === 0 && (
          <div className="text-center py-16 text-neutral-500 text-sm">
            {search ? `No lessons match "${search}".` : 'No lessons yet for this subject.'}
          </div>
        )}

        <div className="mt-12 p-6 rounded-2xl border-2 border-dashed border-neutral-200 text-center bg-white">
          <Lock size={20} className="mx-auto mb-3 text-neutral-400" />
          <h3 className="font-display text-2xl mb-1 text-neutral-900">Grades 8–12</h3>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            Junior and senior secondary lessons coming soon. We're building Grades 4–7 first.
          </p>
        </div>
      </main>
    </div>
  )
}

function SubjectChip({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 text-sm px-4 py-1.5 rounded-full border transition whitespace-nowrap ${
        active
          ? 'bg-neutral-900 text-white border-neutral-900'
          : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
      }`}
    >
      {children}
    </button>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-neutral-200 p-5 animate-pulse">
          <div className="flex gap-2 mb-3">
            <div className="h-5 w-16 bg-neutral-100 rounded-full" />
            <div className="h-5 w-12 bg-neutral-100 rounded-full" />
          </div>
          <div className="h-7 bg-neutral-100 rounded w-3/4 mb-2" />
          <div className="h-4 bg-neutral-100 rounded w-full mb-1" />
          <div className="h-4 bg-neutral-100 rounded w-2/3" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ grade }) {
  return (
    <div className="text-center py-16">
      <h3 className="font-display text-3xl text-neutral-900 mb-2">Nothing here yet</h3>
      <p className="text-sm text-neutral-500 max-w-sm mx-auto">
        Your teacher hasn't published any Grade {grade} interactive lessons yet.
        Check back soon — they'll appear here as soon as they're ready.
      </p>
    </div>
  )
}
