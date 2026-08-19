/**
 * A subject tile in the grade-personalised hub: coloured icon tile, score chip,
 * topic and quiz counts, progress bar, and a practise CTA that locks for
 * learners without access.
 *
 * Rendered ~21 times across the three subject grids, which is why it is
 * memoised — it is the biggest render-cost win on this dashboard.
 */
import { memo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Lock, PencilLine, Sparkles } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'
import { getTopics } from '../../../../config/curriculum'
import { SUBJECT_TONES } from './subjectTones'

// Rich subject card used inside the grade-personalised hub. Matches the
// product mockup: large coloured icon tile, name + percentage chip, a
// "X topics · Y quizzes" stats line, and a coloured progress bar fed by
// per-subject performance. Topic count is free (in-memory curriculum);
// quiz count is optional — passes through `quizCount` when known.
const SubjectCardRich = memo(function SubjectCardRich({ subject, grade, perf, quizCount, demoCount = 0, dimmed = false, locked = false, ctaHref, ctaLabel = 'Practise' }) {
  const topicCount = getTopics(subject.id, grade).length
  const tone = SUBJECT_TONES[subject.id] || SUBJECT_TONES.mathematics
  const score = typeof perf === 'number' ? perf : 0
  // The quiz library. This used to open a per-subject course map at
  // /practise/:grade/:subjectId; that page was retired, and /quizzes was
  // already this card's declared fallback for an unresolved subject, so
  // the fallback simply became the destination. `grade` stays a prop —
  // the topic count above is grade-scoped.
  const quizPath = ctaHref || '/quizzes'
  // Quiz-count badges mirror the Quiz Library's subject tiles: a "N quizzes"
  // pill (or "Coming soon" when the subject has none yet) plus a demo pill.
  // quizCount is undefined until the count fetch resolves — keep the row out
  // of the layout entirely so we don't flash "Coming soon" while loading.
  const countsKnown = typeof quizCount === 'number'

  return (
    <div className={`zx-card theme-card rounded-2xl p-4 transition-all hover:shadow-md ${dimmed ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-12 h-12 ${tone.tile} rounded-2xl flex items-center justify-center text-2xl flex-shrink-0`}>
          {subject.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-black theme-text text-sm leading-tight truncate">{subject.shortLabel || subject.label}</p>
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${tone.tile}`}>{score}%</span>
          </div>
          <p className="theme-text-muted text-[11px] font-bold mt-0.5">
            {topicCount} Topic{topicCount === 1 ? '' : 's'}
          </p>
          {countsKnown && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                quizCount === 0
                  ? 'theme-bg-subtle theme-text-muted'
                  : 'bg-slate-900 text-white'
              }`}>
                {quizCount === 0 ? 'Coming soon' : `${quizCount} Quiz${quizCount === 1 ? '' : 'zes'}`}
              </span>
              {demoCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                  <Icon as={Sparkles} size="xs" strokeWidth={2.4} /> {demoCount} Demo
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="theme-bg-subtle h-2 rounded-full overflow-hidden mb-3">
        <div
          className={`h-2 rounded-full ${subject.tailwind.bg} transition-[width] duration-500`}
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
        />
      </div>

      <Link
        to={locked ? '#' : quizPath}
        onClick={locked ? (e) => e.preventDefault() : undefined}
        className={`flex items-center justify-center gap-1 text-xs font-black py-2 rounded-lg transition-opacity ${locked ? 'theme-bg-subtle theme-text-muted cursor-not-allowed' : tone.action}`}
      >
        {locked ? (
          <>
            <Icon as={Lock} size="xs" strokeWidth={2.4} /> Locked
          </>
        ) : (
          <>
            <Icon as={PencilLine} size="xs" strokeWidth={2.1} /> {ctaLabel}
            <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
          </>
        )}
      </Link>
    </div>
  )
})

export default SubjectCardRich
