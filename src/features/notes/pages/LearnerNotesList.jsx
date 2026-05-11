// src/features/notes/pages/LearnerNotesList.jsx
//
// /notes — the learner's reading library.
// Auto-filtered to their grade (from their profile). Subject chips at the top
// let them narrow further; search box for title lookup. Sibling of /lessons
// (interactive slide-based lessons) — the two surfaces share the underlying
// Firestore collection but are presented as distinct menu items.
//
// Mounted under the standard <Navbar /> in App.jsx so learners can navigate
// back to /dashboard, /quizzes, /lessons, etc. without browser back.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Lock } from '../../../components/ui/icons'
import { useLearnerProfile }   from '../hooks/useLearnerProfile'
import { useLearnerNotes }     from '../hooks/useLearnerNotes'
import { LearnerNoteCard }     from '../components/LearnerNoteCard'
import { getSubjectsForGrade } from '../../../config/curriculum'
import SeoHelmet               from '../../../components/seo/SeoHelmet'
import '../styles/notes.css'

export function LearnerNotesList() {
  const navigate = useNavigate()
  const { user, profile } = useLearnerProfile()
  const grade = profile?.grade

  const [activeSubject, setActiveSubject] = useState('all')
  const [search, setSearch] = useState('')

  const { notes, allNotes, countsBySubject, loading } =
    useLearnerNotes({ grade, subject: activeSubject, search })

  const subjects = useMemo(() => getSubjectsForGrade(grade), [grade])
  const firstName = user?.displayName?.split(' ')[0] || 'there'

  const grouped = useMemo(() => (
    activeSubject === 'all'
      ? subjects.reduce((acc, s) => {
          const list = notes.filter(n => n.subject === s)
          if (list.length) acc[s] = list
          return acc
        }, {})
      : { [activeSubject]: notes }
  ), [activeSubject, notes, subjects])

  return (
    <div className="notes-studio min-h-screen pb-24 md:pb-8" style={{ backgroundColor: '#FAFAF7' }}>
      <SeoHelmet title="Notes" path="/notes" noIndex />
      <main className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
        <div className="mb-6">
          <div className="text-xs tracking-[0.2em] uppercase text-neutral-500 mb-2">Your notes</div>
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight mb-2 text-neutral-900">
            Welcome back, <span className="font-display-italic">{firstName}.</span>
          </h1>
          <p className="text-base text-neutral-600">
            {allNotes.length === 0
              ? `Notes for Grade ${grade} are on the way.`
              : `${allNotes.length} note${allNotes.length === 1 ? '' : 's'} published for Grade ${grade}.`}
          </p>
        </div>

        {allNotes.length > 0 && (
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

        {allNotes.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
            <SubjectChip active={activeSubject === 'all'} onClick={() => setActiveSubject('all')}>
              All <span className="opacity-60">· {allNotes.length}</span>
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

        {loading && allNotes.length === 0 && <SkeletonGrid />}

        {!loading && allNotes.length === 0 && (
          <EmptyState grade={grade} />
        )}

        {!loading && Object.keys(grouped).length > 0 && (
          <div className="space-y-10">
            {Object.entries(grouped).map(([subject, list]) => (
              <section key={subject}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="font-display text-2xl tracking-tight text-neutral-900">{subject}</h2>
                  <span className="text-xs text-neutral-400">{list.length} note{list.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {list.map(note => (
                    <LearnerNoteCard
                      key={note.id}
                      note={note}
                      onClick={() => navigate(`/notes/${note.id}`)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {!loading && allNotes.length > 0 && Object.keys(grouped).length === 0 && (
          <div className="text-center py-16 text-neutral-500 text-sm">
            {search ? `No notes match "${search}".` : 'No notes yet for this subject.'}
          </div>
        )}

        <div className="mt-12 p-6 rounded-2xl border-2 border-dashed border-neutral-200 text-center bg-white">
          <Lock size={20} className="mx-auto mb-3 text-neutral-400" />
          <h3 className="font-display text-2xl mb-1 text-neutral-900">Grades 8–12</h3>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            Junior and senior secondary notes coming soon. We're building Grades 4–7 first.
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
        Your teacher hasn't published any Grade {grade} notes yet. Check back soon — they'll appear here as soon as they're ready.
      </p>
    </div>
  )
}
