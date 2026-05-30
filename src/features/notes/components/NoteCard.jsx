// src/features/notes/components/NoteCard.jsx
//
// Single admin card in the notes list. Click handler is passed in —
// typically navigates to the editor.

import { FileText, FileType, Check, Clock, Layout } from '../../../components/ui/icons'
import { NOTE_FORMAT, NOTE_STATUS } from '../../../config/curriculum'
import { formatDate } from '../lib/format'

const SUBJECT_STYLES = {
  'Mathematics':         { bg: '#EFF6FF', fg: '#1E40AF', border: '#BFDBFE' },
  'Integrated Science':  { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' },
  'Social Studies':      { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A' },
  'English':             { bg: '#FFF1F2', fg: '#9F1239', border: '#FECDD3' },
  'Technology Studies':  { bg: '#F5F3FF', fg: '#5B21B6', border: '#DDD6FE' },
  'Home Economics':      { bg: '#FDF2F8', fg: '#9D174D', border: '#FBCFE8' },
  'Expressive Art':      { bg: '#FFF7ED', fg: '#9A3412', border: '#FED7AA' },
}

const subjectStyle = (subject) =>
  SUBJECT_STYLES[subject] || { bg: '#F5F5F5', fg: '#404040', border: '#E5E5E5' }

export function NoteCard({ note, onClick }) {
  const s = subjectStyle(note.subject)
  const isLegacySlides = note.noteFormat === NOTE_FORMAT.SLIDES
    || (!note.noteFormat && Array.isArray(note.slides) && note.slides.length > 0)

  return (
    <button
      onClick={() => onClick?.(note)}
      className="group text-left bg-white rounded-xl border border-neutral-200 p-5 hover:border-neutral-400 transition-all hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span
            className="inline-flex items-center text-[11px] font-medium rounded-full border px-2 py-0.5"
            style={{ backgroundColor: s.bg, color: s.fg, borderColor: s.border }}
          >
            {note.subject}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
            Grade {note.grade}
          </span>
        </div>
        {note.status === NOTE_STATUS.PUBLISHED ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#D1FAE5', color: '#047857' }}
          >
            <Check size={11} strokeWidth={2.5} /> Published
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">
            <Clock size={11} strokeWidth={2.5} /> Draft
          </span>
        )}
      </div>

      <h3 className="font-display text-2xl leading-tight mb-2 tracking-tight text-neutral-900">
        {note.title || 'Untitled'}
      </h3>

      <p className="text-sm text-neutral-600 line-clamp-2 mb-4 min-h-[2.5em]">
        {note.excerpt || (
          isLegacySlides
            ? `Slide-built lesson · ${note.slides?.length || 0} slides.`
            : note.noteFormat === NOTE_FORMAT.FILE
              ? 'PDF / Word note.'
              : 'No preview yet — open to edit.'
        )}
      </p>

      <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-3 border-t border-neutral-100">
        <div className="flex items-center gap-1.5">
          {isLegacySlides ? (
            <><Layout size={12} /> Slides · legacy</>
          ) : note.noteFormat === NOTE_FORMAT.FILE ? (
            <><FileType size={12} /> File · {note.fileName || 'attached'}</>
          ) : note.noteFormat === NOTE_FORMAT.STUDY ? (
            <><FileText size={12} /> Study note</>
          ) : (
            <><FileText size={12} /> Rich text</>
          )}
        </div>
        <span>Updated {formatDate(note.updatedAt)}</span>
      </div>
    </button>
  )
}
