// src/features/notes/pages/AdminNoteImport.jsx
//
// /admin/lessons/import — pick a document or paste text, run the import, then
// create a draft study note and hand off to the editor for review.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { ImportNotePanel } from '../components/ImportNotePanel'
import { importNoteDocument } from '../lib/noteImport'
import { createNote } from '../lib/firestore'
import { buildStudyExcerpt } from '../lib/studyBlocks'
import { ArrowLeft } from '../../../components/ui/icons'

export function AdminNoteImport() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [error, setError] = useState('')

  const onImport = async ({ kind, file, text }) => {
    setImporting(true); setError(''); setWarnings([]); setProgress(null)
    try {
      const { blocks, warnings: w } = await importNoteDocument({
        kind, file, text, uid: currentUser.uid, onProgress: setProgress,
      })
      if (!blocks.length) throw new Error('No note content could be built from this document.')
      const title = (file?.name || 'Imported note').replace(/\.[^.]+$/, '')
      const id = await createNote({
        title, subject: 'Integrated Science', grade: '7',
        noteFormat: 'study', blocks, excerpt: buildStudyExcerpt(blocks),
        createdBy: currentUser.uid,
      })
      setWarnings(w || [])
      navigate(`/admin/lessons/${id}/edit`)
    } catch (e) {
      setError(e.message || 'Import failed.')
    } finally {
      setImporting(false); setProgress(null)
    }
  }

  return (
    <div className="notes-studio min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/admin/lessons')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F1B2D] mb-6">
          <ArrowLeft size={15} /> All notes
        </button>
        <h1 className="font-display text-3xl text-[#0F1B2D] mb-1">Import a note</h1>
        <p className="text-sm text-[#4A5A6E] mb-6">Subject + grade default to Integrated Science · Grade 7 — change them in the editor after import.</p>
        {error && <div className="notes-card p-3 mb-4 text-sm text-[#9F1239]">{error}</div>}
        <ImportNotePanel importing={importing} progress={progress} warnings={warnings} onImport={onImport} />
      </main>
    </div>
  )
}

export default AdminNoteImport
