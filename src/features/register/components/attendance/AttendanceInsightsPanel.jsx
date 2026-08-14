/**
 * AttendanceInsightsPanel — what this term's attendance shows, in sentences a
 * teacher could check against the grid.
 *
 * Every line comes from attendanceInsights.js, which is pure and tested, and
 * every line is an OBSERVATION. There is no "at risk", no "truant", no
 * suggestion about a family. Attendance data supports statements about which
 * days a child was in class and nothing further, and a platform that prints
 * more than that puts words into a teacher's mouth that a parent will later
 * hold them to (§16).
 *
 * The three actions offered are correspondingly modest: look at the learner,
 * write down what you did, mark it handled.
 */

import { useMemo, useState } from 'react'
import { buildAttendanceInsights } from '../../lib/attendanceInsights'
import { markableDays } from '../../../../utils/attendanceCalendarResolver'
import Button from '../../../../shared/components/Button'
import ResponsiveModal from '../../../../shared/components/ResponsiveModal'
import {
  AlertTriangle, CheckCircle2, Clock, Info,
} from '../../../../shared/icons/classListIcons'

const KIND_META = {
  consecutive_absence: { Icon: AlertTriangle, tone: 'border-red-300 bg-red-50 text-red-900' },
  weekday_pattern: { Icon: Clock, tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  attendance_drop: { Icon: AlertTriangle, tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  below_threshold: { Icon: AlertTriangle, tone: 'border-orange-300 bg-orange-50 text-orange-900' },
  unmarked_days: { Icon: Info, tone: 'border-blue-300 bg-blue-50 text-blue-900' },
  perfect_attendance: { Icon: CheckCircle2, tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
}

export default function AttendanceInsightsPanel({ registerHook, policy, onReviewLearner }) {
  const { roster, daysWithRecords, termInfo } = registerHook
  const [followUp, setFollowUp] = useState(null)   // { insight }
  const [note, setNote] = useState('')
  // Follow-ups are held for this session only. Persisting them is a Firestore
  // collection and an audit trail of its own; until that exists it is more
  // honest to say the note is not saved than to imply it was filed.
  const [handled, setHandled] = useState(() => new Set())

  const insights = useMemo(() => buildAttendanceInsights({
    learners: roster,
    days: markableDays(daysWithRecords),
    policy,
    term: { startDate: termInfo?.startDate, endDate: termInfo?.endDate },
  }), [roster, daysWithRecords, policy, termInfo])

  const open = insights.filter((i) => !handled.has(`${i.kind}:${i.learnerId || 'class'}`))

  if (!insights.length) {
    return (
      <section aria-labelledby="insights-title" className="theme-card border theme-border rounded-radius-md p-4">
        <h3 id="insights-title" className="theme-text font-black text-sm">Attendance insights</h3>
        <p className="theme-text-muted text-sm mt-1">
          Nothing stands out in this term’s attendance so far. Patterns appear here as the
          term fills in.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="insights-title" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="insights-title" className="theme-text font-black text-sm">Attendance insights</h3>
        <p className="theme-text-muted text-xs">
          {open.length} of {insights.length} outstanding
        </p>
      </div>

      <ul className="space-y-2">
        {open.map((insight) => {
          const key = `${insight.kind}:${insight.learnerId || 'class'}`
          const meta = KIND_META[insight.kind] || KIND_META.unmarked_days
          const { Icon } = meta
          return (
            <li key={key} className={`rounded-radius-md border px-3 py-2.5 ${meta.tone}`}>
              <div className="flex items-start gap-2">
                <Icon size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{insight.headline}</p>
                  {insight.detail && <p className="text-xs mt-0.5 opacity-90">{insight.detail}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 pl-6">
                {insight.learnerId && onReviewLearner && (
                  <button type="button" onClick={() => onReviewLearner(insight.learnerId)}
                    className="text-xs font-black underline min-h-[36px]">
                    Review learner
                  </button>
                )}
                <button type="button" onClick={() => { setFollowUp(insight); setNote('') }}
                  className="text-xs font-black underline min-h-[36px]">
                  Add follow-up note
                </button>
                <button type="button"
                  onClick={() => setHandled((prev) => new Set(prev).add(key))}
                  className="text-xs font-black underline min-h-[36px]">
                  Mark as followed up
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {open.length === 0 && (
        <p className="theme-text-muted text-sm theme-card border theme-border rounded-radius-md px-3 py-2.5">
          Every insight has been marked as followed up for this session.
        </p>
      )}

      {followUp && (
        <ResponsiveModal onClose={() => setFollowUp(null)} labelledBy="follow-up-title"
          footer={(
            <div className="flex items-center gap-2">
              <Button type="button" onClick={() => {
                setHandled((prev) => new Set(prev).add(`${followUp.kind}:${followUp.learnerId || 'class'}`))
                setFollowUp(null)
              }}>
                Mark as followed up
              </Button>
              <Button type="button" variant="ghost" onClick={() => setFollowUp(null)}>Close</Button>
            </div>
          )}>
          <h2 id="follow-up-title" className="theme-text font-black text-base">Follow-up note</h2>
          <p className="theme-text-muted text-sm mt-1">{followUp.headline}</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={500}
            placeholder="What did you do? For example: spoke to the guardian on 24 July."
            aria-label="Follow-up note"
            className="w-full mt-3 rounded-radius-sm border theme-border theme-card theme-text px-3 py-2.5 text-sm" />
          <p className="theme-text-muted text-xs mt-2">
            This note stays on your device for this session and is not yet saved to the
            learner’s record.
          </p>
        </ResponsiveModal>
      )}
    </section>
  )
}
