// src/features/notes/components/LearnerNoteCard.jsx
//
// Card in the learner's /notes list. A large cover sits beside the note's
// "at a glance" panel: Grade/New badges, title, diagram + read-time meta,
// a progress strip, and a primary call-to-action with optional Quick Quiz.
//
// The `progress` prop is optional — when absent the card renders the
// "Not started" state. Real per-learner progress arrives in a later phase;
// the layout already accounts for in-progress / completed states so wiring it
// up is data-only.

import { useNavigate } from 'react-router-dom'
import {
  ArrowRight, Clock, ImageIcon, Play, RotateCcw, PencilLine, CheckCircleIcon, Sparkles,
} from '../../../shared/components/icons'
import { NOTE_FORMAT } from '../../../config/curriculum'
import { formatDate } from '../lib/format'
import { resolveNoteCover } from '../lib/noteCovers'
import { deriveNoteMeta } from '../lib/noteMeta'

const NAVY = '#0F1B2D'
const ORANGE = '#D97757'
const GREEN = '#15803D'

// Normalise whatever the progress hook hands us into a known status.
function readStatus(progress) {
  if (!progress) return 'not-started'
  if (progress.status) return progress.status
  if (progress.completedAt) return 'completed'
  if (typeof progress.percent === 'number' && progress.percent > 0) return 'in-progress'
  return 'not-started'
}

export function LearnerNoteCard({ note, onClick, progress }) {
  const navigate = useNavigate()
  const { readMinutes, diagramCount, quiz, isNew } = deriveNoteMeta(note)
  const isFile = note.noteFormat === NOTE_FORMAT.FILE
  const explicitCover = typeof note.coverImage === 'string' ? note.coverImage.trim() : ''
  const cover = explicitCover || resolveNoteCover(note)

  const status = readStatus(progress)
  const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)))

  const open = () => onClick?.(note)

  return (
    <div className="notes-card group overflow-hidden w-full flex items-stretch text-left">
      {/* Cover — clickable, opens the note */}
      <button
        type="button"
        onClick={open}
        aria-label={`Open ${note.title}`}
        className="shrink-0 w-28 sm:w-40 self-stretch overflow-hidden bg-[#F5EFE1] border-r-2 border-[#0F1B2D]"
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-[#0F1B2D]/30">
            <ImageIcon size={28} />
          </div>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col">
        {/* Badges */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F1B2D] bg-[#F5EFE1] px-2 py-0.5 rounded-full border border-[#0F1B2D]">
            Grade {note.grade}
          </span>
          {isNew && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border border-[#0F1B2D]"
              style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
            >
              <Sparkles size={10} /> New
            </span>
          )}
        </div>

        {/* Title — clickable */}
        <button type="button" onClick={open} className="text-left">
          <h3 className="font-display text-xl sm:text-2xl leading-tight mb-1.5 tracking-tight text-[#0F1B2D] group-hover:text-[#A3422E] transition-colors">
            {note.title}
          </h3>
        </button>

        {/* Meta: diagrams · read time */}
        <div className="flex items-center gap-3 text-[11.5px] text-[#4A5A6E] mb-3">
          {diagramCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <ImageIcon size={12} /> {diagramCount} key diagram{diagramCount === 1 ? '' : 's'}
            </span>
          )}
          {readMinutes != null && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {readMinutes} min read
            </span>
          )}
          {isFile && <span className="text-[#4A5A6E]">PDF</span>}
        </div>

        {/* Progress strip */}
        <ProgressStrip status={status} percent={percent} progress={progress} />

        {/* Actions — wrap so the secondary buttons never get clipped on
            narrow (mobile / two-up) cards. */}
        <div className="mt-auto pt-3 flex flex-wrap items-center gap-2">
          <PrimaryAction status={status} onClick={open} />
          {!isFile && (
            <button
              type="button"
              onClick={() => navigate(`/notes/${note.id}?insights=1`)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border-2 border-[#0F1B2D] text-[#0F1B2D] bg-white hover:-translate-y-px transition shrink-0"
              title="AI summary & key points"
            >
              <Sparkles size={13} /> AI Summary
            </button>
          )}
          {quiz && (
            <button
              type="button"
              onClick={() => navigate(`/quiz/${quiz.quizId}`)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border-2 border-[#0F1B2D] text-[#0F1B2D] bg-white hover:-translate-y-px transition shrink-0"
              title={quiz.quizTitle}
            >
              <PencilLine size={13} />
              {quiz.questionCount ? `${quiz.questionCount} Quick Qs` : 'Quick Quiz'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProgressStrip({ status, percent, progress }) {
  if (status === 'completed') {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: GREEN }}>
          <CheckCircleIcon size={14} /> Completed
        </span>
        {progress?.completedAt && (
          <span className="text-[11px] text-[#4A5A6E]">{formatDate(progress.completedAt)}</span>
        )}
      </div>
    )
  }

  if (status === 'in-progress') {
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-[#0F1B2D]">In progress</span>
          <span className="text-[11px] font-semibold" style={{ color: ORANGE }}>{percent}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#F5EFE1] border border-[#0F1B2D]/15 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: ORANGE }} />
        </div>
      </div>
    )
  }

  return <span className="text-xs text-[#4A5A6E]">Not started</span>
}

function PrimaryAction({ status, onClick }) {
  const base = 'inline-flex items-center justify-center gap-1.5 flex-1 text-sm font-semibold px-4 py-2 rounded-xl border-2 border-[#0F1B2D] transition hover:-translate-y-px'
  if (status === 'completed') {
    return (
      <button type="button" onClick={onClick} className={`${base} text-white`} style={{ backgroundColor: GREEN }}>
        <RotateCcw size={14} /> Revise Again
      </button>
    )
  }
  if (status === 'in-progress') {
    return (
      <button type="button" onClick={onClick} className={`${base} text-white`} style={{ backgroundColor: ORANGE }}>
        Resume <ArrowRight size={14} />
      </button>
    )
  }
  return (
    <button type="button" onClick={onClick} className={`${base} text-white`} style={{ backgroundColor: NAVY }}>
      <Play size={13} /> Start Note
    </button>
  )
}
