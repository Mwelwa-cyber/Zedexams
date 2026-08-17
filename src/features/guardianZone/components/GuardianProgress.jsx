/**
 * The read half of the Guardian Zone: snapshot, subject progress, the topics
 * that need help, and recent activity.
 *
 * All four come from `useLearnerDashboard` — the SAME hook the child's own
 * home page uses. That is the point rather than a convenience: a guardian and
 * a child looking at the same week must see the same numbers, and a second
 * derivation over the same documents would be free to disagree with the first.
 * It also means the zone adds no Firestore reads of its own.
 *
 * Every section states when it has nothing to show. "No quizzes yet this term"
 * is information; an empty box is a bug the parent will report.
 */

import {
  BookOpenCheck, ClipboardCheck, Flame, Gamepad2, NotebookPen, Files, TrendingUp,
} from 'lucide-react'

// The activity feed's icons. The learner's own feed draws these through
// LearnerIcon, which belongs to learnerHome; reaching into another feature for
// six glyphs would buy a cross-feature edge for nothing, so the zone maps the
// same activity kinds to the same lucide fallbacks LearnerIcon itself uses.
const ACTIVITY_ICON = {
  quiz: ClipboardCheck,
  notes: NotebookPen,
  lessons: NotebookPen,
  papers: Files,
  games: Gamepad2,
}

export function ChildSnapshot({ name, subLine, verified, streak, level, weekCount }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return (
    <div className="gz-hero">
      <div className="gz-child">
        <div className="gz-cava" aria-hidden="true">{initial}</div>
        <div>
          <div className="gz-cname">{name || 'Your learner'}</div>
          <div className="gz-csub">
            {subLine}
            {/* Only claimed when a guardian actually approved — an adult
                learner or a migration-era account shows no badge rather than a
                false one. */}
            {verified ? ' · verified' : ''}
          </div>
        </div>
      </div>
      <div className="gz-mini">
        <div className="gz-mtile">
          <b><Flame size={15} aria-hidden="true" /> {streak}</b>
          <span>DAY STREAK</span>
        </div>
        {/* The prototype puts "3h 20m THIS WEEK" here. We do not measure time
            on task — there is no timer running behind a note the child is
            reading — so this counts what we DO know: quizzes finished, games
            played and topics completed in the last seven days. Inventing a
            duration from session boundaries would be a number a parent would
            reasonably act on and we could not defend. */}
        <div className="gz-mtile">
          <b>{weekCount}</b>
          <span>DONE THIS WEEK</span>
        </div>
        <div className="gz-mtile">
          <b>Level {level}</b>
          <span>PROGRESS</span>
        </div>
      </div>
    </div>
  )
}

export function SubjectProgress({ subjects }) {
  const withMaterial = (subjects || []).filter((s) => s.hasMaterial)
  return (
    <>
      <div className="gz-head">Subject progress</div>
      <div className="gz-group">
        {withMaterial.length === 0 ? (
          <div className="lhx-empty">
            <div className="lhx-empty-icon"><BookOpenCheck size={26} aria-hidden="true" /></div>
            Nothing to measure yet. Progress appears here once your learner opens
            their first topic.
          </div>
        ) : withMaterial.map((s) => (
          <div className="gz-subj" key={s.id}>
            <div className="gz-subj-lab">{s.label}</div>
            <div className="gz-bar" role="img" aria-label={`${s.label}: ${s.percent}% complete`}>
              <i style={{ width: `${Math.max(0, Math.min(100, s.percent))}%` }} />
            </div>
            <div className="gz-pct">{s.percent}%</div>
          </div>
        ))}
      </div>
    </>
  )
}

export function WeakTopics({ topics }) {
  const list = (topics || []).slice(0, 8)
  return (
    <>
      <div className="gz-head">Needs a little help</div>
      <div className="gz-group">
        {list.length === 0 ? (
          <div className="lhx-empty">
            <div className="lhx-empty-icon"><TrendingUp size={26} aria-hidden="true" /></div>
            Nothing is standing out yet — this fills in from the questions your
            learner gets wrong in quizzes and past papers.
          </div>
        ) : (
          <div className="gz-weak" style={{ padding: '13px 0' }}>
            {list.map((t, i) => (
              <span className="gz-weak-chip" key={`${t.subject || ''}-${t.topicLabel || t.topic}-${i}`}>
                {t.topicLabel || t.topic}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export function RecentActivity({ items }) {
  const list = items || []
  return (
    <>
      <div className="gz-head">Recent activity</div>
      <div className="gz-group">
        {list.length === 0 ? (
          <div className="lhx-empty">No activity in the last few days.</div>
        ) : (
          <div className="lhx-activity">
            {list.map((a) => (
              <div className="lhx-activity-item" key={`${a.type}-${a.sourceId}-${a.completedAt}`}>
                <div className="lhx-activity-icon" aria-hidden="true">
                  {(() => {
                    const Glyph = ACTIVITY_ICON[a.icon] || ClipboardCheck
                    return <Glyph size={20} strokeWidth={2} />
                  })()}
                </div>
                <div className="lhx-activity-main">
                  <div className="lhx-activity-title">{a.title}</div>
                  <div className="lhx-activity-meta">{a.subjectLabel}</div>
                </div>
                {a.score !== null && a.score !== undefined && (
                  <div className="lhx-activity-score">{a.score}%</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
