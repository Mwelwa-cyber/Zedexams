/**
 * Right-rail panels (also stacked below the viewer on mobile): the quiz
 * launcher, the paper-information card, and the learner's practice
 * progress. All data comes from existing reads — no new writes.
 *
 * `InfoRow` is imported rather than co-located: the details panel is not its
 * only plausible consumer, and it is nine lines of pure markup.
 */
import { Link } from 'react-router-dom'
import { Check, Clock, Info, PencilLine, TrophyIcon } from '../../../../shared/components/icons'
import { QUIZ_PENDING_COPY } from '../../../../utils/pastPaperQuizStatus'
import { resolveExamSpec } from '../../../../utils/paperExamSpec'
import InfoRow from './InfoRow'
import { formatDuration, formatUpdated } from './paperFormat'

/**
 * Right-rail panels (also stacked below the viewer on mobile): the quiz
 * launcher, the paper-information card, and the learner's practice
 * progress. All data comes from existing reads — no new writes.
 */
function PaperPanels({
  paper, paperId, quizAvailable, quizMeta, subjectLabel, totalPages,
  timedExamAvailable, attemptCount, bestTime, avgTime, quizTaken,
}) {
  const questionCount = quizMeta?.questionCount || null
  // The same resolution the quiz cover and the exam clock run. This panel used
  // to guess a minute a question on its own, so a paper could advertise "50m"
  // here, offer a 90-minute exam one tap away, and print "60 MINUTES" on its
  // own first page.
  const examSpec = resolveExamSpec({ paper, questionCount })
  const estMinutes = (questionCount || examSpec.exact) ? examSpec.durationMinutes : null
  return (
    <>
      {/* Quiz panel */}
      <div className="theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4">
        {quizAvailable ? (
          <>
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--success-bg)] text-[var(--success-fg)]">
                <Check size={16} strokeWidth={3} />
              </span>
              <h2 className="theme-text font-black text-base">Quiz Available</h2>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase tracking-wide">Questions</dt>
                <dd className="theme-text font-black text-lg">{questionCount ?? '—'}</dd>
              </div>
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase tracking-wide">
                  {examSpec.exact ? 'Time allowed' : 'Est. time'}
                </dt>
                <dd className="theme-text font-black text-lg">{estMinutes ? `${estMinutes}m` : '—'}</dd>
              </div>
            </dl>
            <Link
              to={`/papers/${paperId}/quiz`}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full theme-accent-fill theme-on-accent text-sm font-black py-3 active:scale-[0.98] transition"
            >
              <PencilLine size={16} strokeWidth={2.4} /> Start Quiz
            </Link>
          </>
        ) : (
          /* Informational only — nothing here is clickable, because there is
             no quiz to click into. The paper itself stays fully readable and
             downloadable; only the quiz launcher is withheld. */
          <div className="text-center py-2">
            <span className="mx-auto grid place-items-center w-10 h-10 rounded-full theme-bg-subtle theme-text-muted mb-2">
              <Clock size={20} strokeWidth={2.2} />
            </span>
            <h2 className="theme-text font-black text-base">📝 {QUIZ_PENDING_COPY.learnerHeading}</h2>
            <p className="theme-text-muted text-sm mt-1">
              {QUIZ_PENDING_COPY.learnerBody.charAt(0).toUpperCase()}
              {QUIZ_PENDING_COPY.learnerBody.slice(1)}
            </p>
          </div>
        )}
      </div>

      {/* Paper information */}
      <div className="theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} strokeWidth={2.4} className="theme-accent-text" />
          <h2 className="theme-text font-black text-sm uppercase tracking-wide">Paper Information</h2>
        </div>
        <dl className="space-y-2 text-sm">
          <InfoRow label="Year" value={paper.year} />
          <InfoRow label="Subject" value={subjectLabel} />
          <InfoRow label="Grade" value={paper.grade} />
          <InfoRow label="Paper Type" value={paper.paperNumber ? `Paper ${paper.paperNumber}` : 'National Examination'} />
          <InfoRow label="Language" value="English" />
          {totalPages ? <InfoRow label="Total Pages" value={totalPages} /> : null}
          {examSpec.exact ? <InfoRow label="Time Allowed" value={`${examSpec.durationMinutes} minutes`} /> : null}
          {examSpec.declaredQuestionCount ? <InfoRow label="Questions" value={examSpec.declaredQuestionCount} /> : null}
          <InfoRow label="Exam Board" value={paper.examBoard || 'ECZ'} />
          <InfoRow label="Last Updated" value={formatUpdated(paper.updatedAt)} />
        </dl>
      </div>

      {/* Progress (from timed-practice attempts) */}
      <div className="theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrophyIcon size={16} strokeWidth={2.4} className="theme-accent-text" />
          <h2 className="theme-text font-black text-sm uppercase tracking-wide">Your Progress</h2>
        </div>
        {attemptCount > 0 || quizTaken ? (
          <>
            {quizTaken && (
              <p className="inline-flex items-center gap-1.5 text-sm font-black text-[var(--success-fg)] mb-3">
                <Check size={15} strokeWidth={3} /> Quiz completed
              </p>
            )}
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase">Attempts</dt>
                <dd className="theme-text font-black text-lg">{attemptCount}</dd>
              </div>
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase">Best</dt>
                <dd className="theme-text font-black text-lg">{formatDuration(bestTime)}</dd>
              </div>
              <div className="rounded-xl theme-bg-subtle py-2">
                <dt className="text-[10px] font-bold theme-text-muted uppercase">Avg</dt>
                <dd className="theme-text font-black text-lg">{formatDuration(avgTime)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="theme-text-muted text-sm">
            Practise this paper as a timed exam to start tracking your progress.
          </p>
        )}
        {timedExamAvailable ? (
          <Link
            to={`/papers/${paperId}/practice`}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full theme-card border theme-border text-sm font-black py-2.5 hover:theme-bg-subtle transition"
          >
            {attemptCount > 0 ? 'Continue Practice' : 'Start timed practice'}
          </Link>
        ) : (
          <Link
            to={`/login?next=/papers/${paperId}`}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full theme-card border theme-border text-sm font-black py-2.5 hover:theme-bg-subtle transition"
          >
            Sign in to practise
          </Link>
        )}
      </div>
    </>
  )
}

export default PaperPanels
