// src/features/notes/pages/LearnerNoteRead.jsx
//
// /notes/:id — the reader view.
//
// Two render modes based on the note's noteFormat:
//   • 'rich_text' (default for new notes) → renders HTML content in a prose container
//   • 'file'                              → shows a download card (no inline PDF preview)
//   • legacy slide-built lessons (no noteFormat, has slides[]) → friendly fallback
//     pointing learners back to the existing /lessons/:id viewer

import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, Download, FileType, Loader2, Layout } from '../../../components/ui/icons'

import { useNote }            from '../hooks/useNote'
import { NOTE_FORMAT }        from '../../../config/curriculum'
import { formatDate }         from '../lib/format'
import '../styles/notes.css'

const SUBJECT_STYLES = {
  'Mathematics':         { bg: '#EFF6FF', fg: '#1E40AF', border: '#BFDBFE' },
  'Integrated Science':  { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' },
  'Social Studies':      { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A' },
  'English':             { bg: '#FFF1F2', fg: '#9F1239', border: '#FECDD3' },
  'Technology Studies':  { bg: '#F5F3FF', fg: '#5B21B6', border: '#DDD6FE' },
  'Home Economics':      { bg: '#FDF2F8', fg: '#9D174D', border: '#FBCFE8' },
  'Expressive Arts':     { bg: '#FFF7ED', fg: '#9A3412', border: '#FED7AA' },
}

const subjectStyle = (subject) =>
  SUBJECT_STYLES[subject] || { bg: '#F5F5F5', fg: '#404040', border: '#E5E5E5' }

export function LearnerNoteRead() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { note, loading, error } = useNote(id)

  if (loading) {
    return (
      <div className="notes-studio min-h-screen pb-24 md:pb-8" style={{ backgroundColor: '#FAFAF7' }}>
        <div className="min-h-[50vh] flex items-center justify-center text-neutral-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="notes-studio min-h-screen pb-24 md:pb-8" style={{ backgroundColor: '#FAFAF7' }}>
        <div className="max-w-xl mx-auto px-5 py-16 text-center">
          <h1 className="font-display text-3xl mb-2 text-neutral-900">Note not found</h1>
          <p className="text-sm text-neutral-500 mb-6">
            This note may have been unpublished or removed.
          </p>
          <button
            onClick={() => navigate('/notes')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-900 text-white text-sm hover:opacity-90 transition"
          >
            <ArrowLeft size={14} /> Back to all notes
          </button>
        </div>
      </div>
    )
  }

  const s = subjectStyle(note.subject)
  const isLegacySlides = !note.noteFormat && Array.isArray(note.slides) && note.slides.length > 0

  return (
    <div className="notes-studio min-h-screen pb-24 md:pb-8" style={{ backgroundColor: '#FAFAF7' }}>
      <main className="max-w-2xl mx-auto px-5 py-8">
        <button
          onClick={() => navigate('/notes')}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900 transition mb-8"
        >
          <ArrowLeft size={15} /> All notes
        </button>

        <article>
          <div className="flex flex-wrap gap-2 items-center mb-5">
            <span
              className="inline-flex items-center text-xs font-medium rounded-full border px-2.5 py-1"
              style={{ backgroundColor: s.bg, color: s.fg, borderColor: s.border }}
            >
              {note.subject}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
              Grade {note.grade}
            </span>
            <span className="text-xs text-neutral-500 inline-flex items-center gap-1">
              <Calendar size={11} /> Published {formatDate(note.publishedAt)}
            </span>
          </div>

          <h1 className="font-display text-5xl md:text-6xl tracking-tight leading-[1.05] mb-6 text-neutral-900">
            {note.title}
          </h1>

          {note.excerpt && (
            <p className="text-lg text-neutral-600 mb-8 font-display-italic leading-relaxed">
              {note.excerpt}
            </p>
          )}

          <hr className="my-8 border-neutral-100" />

          {isLegacySlides ? (
            <LegacySlidesPointer noteId={note.id} />
          ) : note.noteFormat === NOTE_FORMAT.FILE ? (
            <FileDownload note={note} />
          ) : (
            <div
              className="prose-note"
              dangerouslySetInnerHTML={{ __html: note.content || '<p>This note has no content yet.</p>' }}
            />
          )}

          <hr className="my-10 border-neutral-100" />

          <div className="flex items-center justify-between text-sm text-neutral-500">
            <span>Last updated {formatDate(note.updatedAt)}</span>
            {note.noteFormat === NOTE_FORMAT.FILE && note.fileUrl && (
              <a
                href={note.fileUrl}
                download={note.fileName}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition text-neutral-900"
              >
                <Download size={14} /> Save offline
              </a>
            )}
          </div>
        </article>
      </main>
    </div>
  )
}

function FileDownload({ note }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center my-6">
      <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-red-100">
        <FileType size={28} className="text-red-600" />
      </div>
      <h3 className="font-display text-2xl mb-1 text-neutral-900">{note.fileName || 'Download'}</h3>
      <p className="text-sm text-neutral-500 mb-5">
        Tap below to open or save this note as a PDF.
      </p>
      <a
        href={note.fileUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-medium hover:opacity-90 transition"
        style={{ backgroundColor: '#059669' }}
      >
        <Download size={15} /> Download PDF
      </a>
    </div>
  )
}

function LegacySlidesPointer({ noteId }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center my-6">
      <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-amber-100">
        <Layout size={28} className="text-amber-700" />
      </div>
      <h3 className="font-display text-2xl mb-1 text-neutral-900">Slide-built lesson</h3>
      <p className="text-sm text-neutral-500 mb-5 max-w-sm mx-auto">
        This note uses our older slide format. Open it in the lesson player for the full experience.
      </p>
      <a
        href={`/lessons/${noteId}`}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-medium hover:opacity-90 transition"
        style={{ backgroundColor: '#059669' }}
      >
        Open in lesson player
      </a>
    </div>
  )
}
