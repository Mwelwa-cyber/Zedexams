/**
 * Automatic-mode body: pick a grade/subject/school rule, surface the
 * matching class count, and reuse <AssignmentOptions> for the timer
 * + scheduling toggles.
 */

import { useMemo } from 'react'
import { GRADES, SUBJECTS } from '../../../config/curriculum'
import { resolveAutomaticTargets } from '../../../utils/quizAssignments'
import AssignmentOptions from './AssignmentOptions'

export default function AutomaticPanel({
  rule,
  onRuleChange,
  options,
  onOptionChange,
  allClasses = [],
  existingClassIds = [],
}) {
  const matches = useMemo(() => resolveAutomaticTargets(allClasses, rule), [allClasses, rule])
  const matchCount = matches.length
  const alreadyAssignedCount = matches.filter((c) => existingClassIds.includes(c.id)).length
  const newAssignmentCount = matchCount - alreadyAssignedCount

  const schools = useMemo(() => {
    const set = new Set()
    for (const c of allClasses) {
      if (c.school && typeof c.school === 'string') set.add(c.school.trim())
    }
    return Array.from(set).filter(Boolean).sort()
  }, [allClasses])

  function setRuleField(name, value) {
    onRuleChange?.({ ...rule, [name]: value })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="surface space-y-4 p-4 sm:p-5">
        <header className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg">⚡</span>
          <h3 className="theme-text text-base font-black">Automatic rule</h3>
        </header>
        <p className="theme-text-muted text-xs leading-relaxed">
          Match all of your classes that meet these rules. The assignment
          fans out — one row per class — and skips any class that already
          has this quiz.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-black uppercase tracking-widest theme-text-muted">
              Grade
            </span>
            <select
              value={rule.grade || ''}
              onChange={(event) => setRuleField('grade', event.target.value || null)}
              className="rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
            >
              <option value="">Any grade</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>Grade {g}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-black uppercase tracking-widest theme-text-muted">
              Subject
            </span>
            <select
              value={rule.subject || ''}
              onChange={(event) => setRuleField('subject', event.target.value || null)}
              className="rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
            >
              <option value="">Any subject</option>
              {SUBJECTS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-black uppercase tracking-widest theme-text-muted">
              School
            </span>
            {schools.length > 1 ? (
              <select
                value={rule.school || ''}
                onChange={(event) => setRuleField('school', event.target.value || null)}
                className="rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
              >
                <option value="">Any school</option>
                {schools.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={rule.school || ''}
                onChange={(event) => setRuleField('school', event.target.value || null)}
                placeholder={schools[0] || 'Any school'}
                className="rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
              />
            )}
          </label>
        </div>

        <div
          role="status"
          aria-live="polite"
          className={[
            'rounded-2xl border-2 p-3 text-sm font-bold',
            matchCount === 0
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900',
          ].join(' ')}
        >
          {matchCount === 0 ? (
            <>
              No classes match this rule yet. Create a class first or
              loosen the filters.
            </>
          ) : (
            <>
              {newAssignmentCount} class{newAssignmentCount === 1 ? '' : 'es'}
              {' '}will receive this quiz
              {alreadyAssignedCount > 0
                ? ` (${alreadyAssignedCount} already assigned, skipped)`
                : ''}.
            </>
          )}
        </div>
      </section>

      <section className="surface space-y-3 p-4 sm:p-5">
        <header className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg">⚙️</span>
          <h3 className="theme-text text-base font-black">Automatic settings</h3>
        </header>
        <AssignmentOptions
          values={options}
          onChange={onOptionChange}
          showSchedule
          showDailyChallenge
        />
      </section>
    </div>
  )
}
