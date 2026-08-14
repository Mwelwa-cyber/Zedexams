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
import { Search, Lock, BookOpen } from '../../../shared/components/icons'
import { useLearnerProfile }   from '../hooks/useLearnerProfile'
import { useLearnerNotes }     from '../hooks/useLearnerNotes'
import { useNoteProgressMap }  from '../hooks/useNoteProgressMap'
import { NOTE_PROGRESS_STATUS } from '../lib/progress'
import { LearnerNoteCard }     from '../components/LearnerNoteCard'
import { isStudyTipsNote }     from '../lib/noteMeta'
import { getSubjectsForGrade } from '../../../config/curriculum'
import SeoHelmet               from '../../../shared/components/SeoHelmet'
import Skeleton                from '../../../shared/components/Skeleton'
import ContentLoadError        from '../../../shared/components/ContentLoadError'
import '../styles/notes.css'

export function LearnerNotesList() {
  const navigate = useNavigate()
  const { user, profile } = useLearnerProfile()
  const grade = profile?.grade

  const [activeSubject, setActiveSubject] = useState('all')
  const [search, setSearch] = useState('')

  const { notes, allNotes, countsBySubject, loading, error, reload } =
    useLearnerNotes({ grade, subject: activeSubject, search })

  const { progressById } = useNoteProgressMap()

  const completedCount = useMemo(
    () => allNotes.filter(n => progressById[n.id]?.status === NOTE_PROGRESS_STATUS.COMPLETED).length,
    [allNotes, progressById],
  )

  const subjects = useMemo(() => getSubjectsForGrade(grade), [grade])
  const firstName = user?.displayName?.split(' ')[0] || 'there'

  // "How to Study & Exam Tips" is general study advice, not a syllabus topic —
  // pin it to the top of the list (regardless of the active subject) and keep
  // it out of the per-subject sections so it never reads as "buried".
  const tipsNote = useMemo(() => allNotes.find(isStudyTipsNote) || null, [allNotes])
  const tipsMatchesSearch = useMemo(() => {
    if (!tipsNote) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return tipsNote.title?.toLowerCase().includes(q)
  }, [tipsNote, search])
  const showTips = !!tipsNote && tipsMatchesSearch

  const grouped = useMemo(() => {
    const visible = notes.filter(n => !isStudyTipsNote(n))
    return activeSubject === 'all'
      ? subjects.reduce((acc, s) => {
          const list = visible.filter(n => n.subject === s)
          if (list.length) acc[s] = list
          return acc
        }, {})
      : { [activeSubject]: visible }
  }, [activeSubject, notes, subjects])

  return (
    <div className="notes-studio note-page-cream min-h-screen pb-24 lg:pb-8">
      <SeoHelmet title="Notes" path="/notes" noIndex />
      <main className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
        <div className="mb-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-[10.5px] font-extrabold tracking-[0.16em] uppercase text-[#053541] mb-2 before:content-[''] before:w-[22px] before:h-[3px] before:rounded-sm before:bg-[#D97757]">Your notes</div>
            <h1 className="font-display text-4xl sm:text-5xl tracking-tight mb-2 text-[#0F1B2D]">
              Welcome back, <span className="font-display-italic">{firstName}.</span>
            </h1>
            <p className="text-base text-[#4A5A6E]">
              {error && allNotes.length === 0
                ? 'We hit a snag loading your notes.'
                : allNotes.length === 0
                  ? `Notes for Grade ${grade} are on the way.`
                  : `${allNotes.length} note${allNotes.length === 1 ? '' : 's'} published for Grade ${grade}.`}
            </p>
          </div>
          {allNotes.length > 0 && (
            <NotesProgressPanel total={allNotes.length} completed={completedCount} />
          )}
        </div>

        {allNotes.length > 0 && (
          <div className="relative mb-4 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A5A6E]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title…"
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-white rounded-xl border-2 border-[#0F1B2D] text-[#0F1B2D] placeholder:text-[#4A5A6E] focus:outline-none focus:ring-2 focus:ring-[#D97757]/40 transition"
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

        {/* A read failure must not masquerade as "no notes yet" — show a
            retryable error instead of the empty state. */}
        {error && allNotes.length === 0 ? (
          <ContentLoadError
            title="Couldn’t load your notes"
            message="We couldn’t load your notes right now. Please check your connection and try again."
            onRetry={reload}
          />
        ) : (
          <>
            {loading && allNotes.length === 0 && <SkeletonGrid />}

            {!loading && allNotes.length === 0 && (
              <EmptyState grade={grade} />
            )}
          </>
        )}

        {!loading && showTips && (
          <section className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="font-display text-2xl tracking-tight text-[#0F1B2D]">Start here</h2>
              <span className="text-xs text-[#4A5A6E]">Study smarter</span>
            </div>
            <LearnerNoteCard
              note={tipsNote}
              progress={progressById[tipsNote.id]}
              onClick={() => navigate(`/notes/${tipsNote.id}`)}
            />
          </section>
        )}

        {!loading && Object.keys(grouped).length > 0 && (
          <div className="space-y-10">
            {Object.entries(grouped).map(([subject, list]) => (
              <section key={subject}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="font-display text-2xl tracking-tight text-[#0F1B2D]">{subject}</h2>
                  <span className="text-xs text-[#4A5A6E]">{list.length} note{list.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {list.map(note => (
                    <LearnerNoteCard
                      key={note.id}
                      note={note}
                      progress={progressById[note.id]}
                      onClick={() => navigate(`/notes/${note.id}`)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {!loading && allNotes.length > 0 && Object.keys(grouped).length === 0 && !showTips && (
          <div className="text-center py-16 text-[#4A5A6E] text-sm">
            {search ? `No notes match "${search}".` : 'No notes yet for this subject.'}
          </div>
        )}

        <div className="notes-card mt-12 p-6 text-center">
          <div className="w-11 h-11 rounded-xl mx-auto mb-3 grid place-items-center border-2 border-[#0F1B2D] bg-[#EDE9FE]" style={{ boxShadow: '0 2px 0 #0F1B2D' }}>
            <Lock size={18} className="text-[#6D28D9]" />
          </div>
          <h3 className="font-display text-2xl mb-1 text-[#0F1B2D]">Grades 8–12</h3>
          <p className="text-sm text-[#4A5A6E] max-w-sm mx-auto">
            Junior and senior secondary notes coming soon. We're building Grades 4–7 first.
          </p>
        </div>
      </main>
    </div>
  )
}

function NotesProgressPanel({ total, completed }) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div className="notes-card p-4 w-full lg:w-72 shrink-0">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-9 h-9 rounded-xl grid place-items-center border-2 border-[#0F1B2D] bg-[#F8EADF]" style={{ boxShadow: '0 2px 0 #0F1B2D' }}>
          <BookOpen size={16} className="text-[#A3422E]" />
        </span>
        <div>
          <div className="text-sm font-bold text-[#0F1B2D] leading-tight">Notes progress</div>
          <div className="text-[11px] text-[#4A5A6E]">{percent}% completed</div>
        </div>
      </div>
      <div className="h-2 rounded-full bg-[#F5EFE1] border border-[#0F1B2D]/15 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: '#D97757' }} />
      </div>
      <div className="mt-2 text-[11px] text-[#4A5A6E]">{completed} of {total} notes completed</div>
    </div>
  )
}

function SubjectChip({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`notes-chip shrink-0 text-sm font-semibold px-4 py-1.5 rounded-full whitespace-nowrap ${
        active
          ? 'bg-[#0F1B2D] text-white notes-chip-shadow'
          : 'bg-white text-[#0F1B2D] hover:-translate-y-px hover:notes-chip-shadow'
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
        <div key={i} className="notes-card p-5">
          <div className="flex gap-2 mb-3">
            <Skeleton width={64} height={20} className="!rounded-full" />
            <Skeleton width={48} height={20} className="!rounded-full" />
          </div>
          <Skeleton width="75%" height={28} className="!rounded mb-2" />
          <Skeleton height={16} className="!rounded mb-1" />
          <Skeleton width="66%" height={16} className="!rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ grade }) {
  return (
    <div className="text-center py-16">
      <h3 className="font-display text-3xl text-[#0F1B2D] mb-2">Nothing here yet</h3>
      <p className="text-sm text-[#4A5A6E] max-w-sm mx-auto">
        Your teacher hasn't published any Grade {grade} notes yet. Check back soon — they'll appear here as soon as they're ready.
      </p>
    </div>
  )
}
