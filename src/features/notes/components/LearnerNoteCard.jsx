// src/features/notes/components/LearnerNoteCard.jsx
//
// Card in the learner's /notes list. Uses publishedAt for the timestamp,
// shows a "New" badge for notes published in the last 7 days, and renders
// a small file/text indicator so learners know what to expect.

import { ArrowRight, FileType, Sparkles } from '../../../components/ui/icons'
import { NOTE_FORMAT } from '../../../config/curriculum'
import { formatDate } from '../lib/format'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const isNewThisWeek = (publishedAt) => {
  if (!publishedAt) return false
  const d = typeof publishedAt?.toDate === 'function' ? publishedAt.toDate() : new Date(publishedAt)
  return Date.now() - d.getTime() < SEVEN_DAYS_MS
}

export function LearnerNoteCard({ note, onClick }) {
  const isNew = isNewThisWeek(note.publishedAt)
  const isFile = note.noteFormat === NOTE_FORMAT.FILE

  return (
    <button
      onClick={() => onClick?.(note)}
      className="group text-left bg-white rounded-xl border border-neutral-200 p-5 hover:border-neutral-400 transition-all w-full"
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
          Grade {note.grade}
        </span>
        {isFile && (
          <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
            <FileType size={11} /> PDF
          </span>
        )}
        {isNew && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
          >
            <Sparkles size={10} /> New
          </span>
        )}
      </div>

      <h3 className="font-display text-2xl leading-tight mb-2 tracking-tight text-neutral-900 group-hover:text-emerald-700 transition-colors">
        {note.title}
      </h3>

      <p className="text-sm text-neutral-600 line-clamp-2 mb-4 min-h-[2.5em]">
        {note.excerpt || 'Open to read.'}
      </p>

      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>Published {formatDate(note.publishedAt)}</span>
        <span className="inline-flex items-center gap-1 group-hover:gap-2 transition-all" style={{ color: '#047857' }}>
          Read <ArrowRight size={12} />
        </span>
      </div>
    </button>
  )
}
