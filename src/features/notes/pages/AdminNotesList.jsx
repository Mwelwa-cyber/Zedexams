// src/features/notes/pages/AdminNotesList.jsx
//
// /admin/lessons — the admin's home screen for Notes Studio.
// Lists every note (drafts + published) with filters, search, and a "New note" button.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Sparkles } from '../../../components/ui/icons'
import { useAdminNotes } from '../hooks/useAdminNotes'
import { NoteFilters } from '../components/NoteFilters'
import { NoteCard } from '../components/NoteCard'
import { SeedImportPanel } from '../components/SeedImportPanel'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import '../styles/notes.css'

export function AdminNotesList() {
  const navigate = useNavigate()
  const [search,  setSearch]  = useState('')
  const [subject, setSubject] = useState('all')
  const [grade,   setGrade]   = useState('all')
  const [status,  setStatus]  = useState('all')

  const { notes, loading, totalCount } = useAdminNotes({ subject, grade, status, search })

  return (
    <div className="notes-studio min-h-full" style={{ backgroundColor: '#FAFAF7' }}>
      <SeoHelmet title="Admin notes" noIndex />
      <main className="max-w-6xl mx-auto px-5 py-8">
        <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <div className="text-xs tracking-[0.2em] uppercase text-neutral-500 mb-2">Notes Studio</div>
            <h1 className="font-display text-5xl tracking-tight text-neutral-900">
              All notes <span className="font-display-italic text-neutral-400">·</span>{' '}
              <span className="font-display-italic text-neutral-400">{totalCount}</span>
            </h1>
            <p className="text-sm text-neutral-600 mt-2 max-w-md">
              Drafts and published notes across every subject and grade.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SeedImportPanel />
            <button
              onClick={() => navigate('/admin/lessons/visual/new')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-medium transition hover:scale-[1.02] active:scale-[0.98] shadow-sm bg-violet-600"
            >
              <Sparkles size={16} /> Generate visual notes
            </button>
            <button
              onClick={() => navigate('/admin/lessons/new')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-medium transition hover:scale-[1.02] active:scale-[0.98] shadow-sm bg-neutral-900"
            >
              <Plus size={16} /> New note
            </button>
          </div>
        </div>

        <NoteFilters
          search={search}   onSearchChange={setSearch}
          subject={subject} onSubjectChange={setSubject}
          grade={grade}     onGradeChange={setGrade}
          status={status}   onStatusChange={setStatus}
        />

        {loading ? (
          <SkeletonGrid />
        ) : notes.length === 0 ? (
          <EmptyState search={search} totalCount={totalCount} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {notes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                onClick={() => navigate(`/admin/lessons/${note.id}/edit`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-neutral-200 p-5 animate-pulse">
          <div className="flex gap-2 mb-3">
            <div className="h-5 w-24 bg-neutral-100 rounded-full" />
            <div className="h-5 w-16 bg-neutral-100 rounded-full" />
          </div>
          <div className="h-7 bg-neutral-100 rounded w-3/4 mb-2" />
          <div className="h-4 bg-neutral-100 rounded w-full mb-1" />
          <div className="h-4 bg-neutral-100 rounded w-2/3" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ search, totalCount }) {
  if (totalCount === 0) {
    return (
      <div className="text-center py-20">
        <h3 className="font-display text-3xl text-neutral-900 mb-2">No notes yet</h3>
        <p className="text-sm text-neutral-500 max-w-sm mx-auto">
          Create your first note to start publishing to learners.
        </p>
      </div>
    )
  }
  return (
    <div className="text-center py-20 text-neutral-500 text-sm">
      {search ? `No notes match "${search}".` : 'No notes match those filters.'}
    </div>
  )
}
