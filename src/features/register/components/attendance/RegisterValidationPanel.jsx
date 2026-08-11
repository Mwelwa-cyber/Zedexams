/**
 * RegisterValidationPanel — the checks a term register passes before it can be
 * finalised, and the Finalise button itself.
 *
 * Reads its verdict from registerValidationCore, which is pure and tested. The
 * split that matters is enforced there, not here: only genuine record-INTEGRITY
 * errors block. A register with four unmarked learners on one day is
 * incomplete, and a teacher may still file it; a register showing attendance
 * on a public holiday says something untrue, and may not (§19).
 *
 * The panel always shows WHAT WAS CHECKED, even when everything passes — an
 * empty panel is indistinguishable from a check that never ran.
 */

import { useMemo } from 'react'
import { validateTermRegister } from '../../lib/registerValidationCore'
import { markableDays } from '../../../../utils/attendanceCalendarResolver'
import Button from '../../../../components/ui/Button'
import {
  AlertTriangle, CheckCircle2, Info,
} from '../../../../shared/icons/classListIcons'

const SEVERITY_META = {
  error: {
    title: 'Must be fixed before this register can be finalised',
    tone: 'border-red-300 bg-red-50 text-red-900',
    Icon: AlertTriangle,
  },
  warning: {
    title: 'Worth finishing — these do not block finalisation',
    tone: 'border-amber-300 bg-amber-50 text-amber-900',
    Icon: AlertTriangle,
  },
  information: {
    title: 'For your information',
    tone: 'border-blue-300 bg-blue-50 text-blue-900',
    Icon: Info,
  },
}

function IssueGroup({ severity, issues }) {
  if (!issues.length) return null
  const meta = SEVERITY_META[severity]
  const { Icon } = meta
  return (
    <div className={`rounded-radius-md border px-3 py-2.5 ${meta.tone}`}>
      <p className="text-xs font-black uppercase tracking-wide flex items-center gap-1.5">
        <Icon size={14} aria-hidden="true" />
        {meta.title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${issue.date || issue.learnerId || i}`} className="text-sm">
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function RegisterValidationPanel({
  registerHook, stage, canFinalise: allowedToFinalise, onFinalise, finalising,
}) {
  const { roster, daysWithRecords, termInfo, todayIso, pendingCount, syncIssues } = registerHook

  const result = useMemo(() => validateTermRegister({
    learners: roster,
    days: markableDays(daysWithRecords),
    term: { startDate: termInfo?.startDate, endDate: termInfo?.endDate },
    todayIso,
    sync: {
      pendingCount,
      conflictCount: (syncIssues || []).filter((i) => i.kind === 'conflict').length,
      rejectedCount: (syncIssues || []).filter((i) => i.kind !== 'conflict').length,
    },
  }), [roster, daysWithRecords, termInfo, todayIso, pendingCount, syncIssues])

  const { checks } = result
  const blocked = !result.canFinalise

  return (
    <section aria-labelledby="validation-title" className="theme-card border theme-border rounded-radius-md p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="validation-title" className="theme-text font-black text-sm">Register validation</h3>
        <p className="theme-text-muted text-xs">
          {result.errors.length === 0 && result.warnings.length === 0
            ? 'Nothing needs attention.'
            : `${result.errors.length} to fix · ${result.warnings.length} to finish`}
        </p>
      </div>

      {/* What was checked — stated whether or not anything was found. */}
      <ul className="space-y-1">
        {[
          `${checks.teachingDaysChecked} teaching day${checks.teachingDaysChecked === 1 ? '' : 's'} checked`,
          `${checks.learnersChecked} learner${checks.learnersChecked === 1 ? '' : 's'} checked`,
          'Class List synchronised',
        ].map((line) => (
          <li key={line} className="flex items-center gap-1.5 text-sm text-emerald-800">
            <CheckCircle2 size={14} className="shrink-0" aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>

      <IssueGroup severity="error" issues={result.errors} />
      <IssueGroup severity="warning" issues={result.warnings} />
      <IssueGroup severity="information" issues={result.information} />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          onClick={onFinalise}
          loading={finalising}
          disabled={blocked || !allowedToFinalise || finalising}
          className="min-h-[48px]"
        >
          Finalise term register
        </Button>
        <p className="theme-text-muted text-xs">
          {!allowedToFinalise
            ? 'Only the class teacher can finalise this register.'
            : blocked
              ? 'Fix the items above first — the register currently records something that is not true.'
              : stage === 'submitted'
                ? 'Submitted. A headteacher can approve it or return it for correction.'
                : 'Finalising submits the register for review. You can still be sent it back for correction.'}
        </p>
      </div>
    </section>
  )
}
