// src/features/notes/components/LearnerNoteCard.jsx
//
// Card in the learner's /notes list. Uses publishedAt for the timestamp,
// shows a "New" badge for notes published in the last 7 days, and renders
// a small file/text indicator so learners know what to expect.

import { ArrowRight, FileType, Sparkles } from '../../../components/ui/icons'
import { NOTE_FORMAT } from '../../../config/curriculum'
import { formatDate } from '../lib/format'
import { resolveNoteCover } from '../lib/noteCovers'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const isNewThisWeek = (publishedAt) => {
  if (!publishedAt) return false
  const d = typeof publishedAt?.toDate === 'function' ? publishedAt.toDate() : new Date(publishedAt)
  return Date.now() - d.getTime() < SEVEN_DAYS_MS
}

export function LearnerNoteCard({ note, onClick }) {
  const isNew = isNewThisWeek(note.publishedAt)
  const isFile = note.noteFormat === NOTE_FORMAT.FILE
  const explicitCover = typeof note.coverImage === 'string' ? note.coverImage.trim() : ''
  const cover = explicitCover || resolveNoteCover(note)

  return (
    <button
      onClick={() => onClick?.(note)}
      className="notes-card is-pressable group text-left overflow-hidden w-full flex items-stretch"
    >
      {cover && (
        <div className="shrink-0 w-24 sm:w-28 self-stretch overflow-hidden bg-neutral-50 border-r-2 border-[#0F1B2D]">
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      )}
      <div className="flex-1 min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F1B2D] bg-[#F5EFE1] px-2 py-0.5 rounded-full border border-[#0F1B2D]">
          Grade {note.grade}
        </span>
        {isFile && (
          <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
            <FileType size={11} /> PDF
          </span>
        )}
        {isNew && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border border-[#0F1B2D]"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
          >
            <Sparkles size={10} /> New
          </span>
        )}
      </div>

      <h3 className="font-display text-xl sm:text-2xl leading-tight mb-2 tracking-tight text-[#0F1B2D] group-hover:text-[#C2410C] transition-colors">
        {note.title}
      </h3>

      <p className="text-sm text-neutral-600 line-clamp-2 mb-4 min-h-[2.5em]">
        {note.excerpt || 'Open to read.'}
      </p>

      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>Published {formatDate(note.publishedAt)}</span>
        <span className="inline-flex items-center gap-1 group-hover:gap-2 transition-all font-semibold" style={{ color: '#C2410C' }}>
          Read <ArrowRight size={12} />
        </span>
      </div>
      </div>
    </button>
  )
}
