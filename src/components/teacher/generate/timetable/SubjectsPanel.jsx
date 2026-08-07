/**
 * SubjectsPanel — the ONE Subjects view merging the old "Curriculum
 * requirements" and "Subjects & weekly periods" sections: the requirements
 * summary line, the option-group choice (compact segmented control), the
 * per-subject cards with live placed counts, and the spare-slot policy
 * (exact week vs school activities).
 *
 * Used twice: as wizard Step 3, and inside the workspace's Subjects drawer
 * (`showAutoFill` adds the re-run auto-fill / clear-grid actions there).
 * Presentational: state and handlers stay in ClassTimetableStudio.
 */

import { AlertTriangle } from 'lucide-react'
import { FRAMEWORK_SOURCE } from '../../../../utils/curriculumFramework'
import { SCHOOL_ACTIVITIES } from '../../../../utils/timetableBlocks'
import { clampInt } from '../../../../utils/inputs.js'

export default function SubjectsPanel({
  curriculum,
  curriculumId,
  grade,
  expectsAllocation,
  allocationBlocked,
  readiness,
  recoveredReview,
  onResetSubjects,
  onOptionSwitch,          // (groupId, optionId)
  weekMode,
  onWeekModeChange,        // (modeId)
  dayCounts,
  setDayCounts,
  days,
  timing,
  activities,
  setActivities,
  subjects,
  validation,
  capacity,
  allocated,
  overAllocated,
  spareSlots,
  onUpdateSubject,         // (id, field, value)
  onAddSubject,
  onRemoveSubject,         // (id)
  showAutoFill = false,
  onAutoFill,
  onRequestClear,
}) {
  return (
    <section className="studio-card space-y-3 p-4 sm:p-5">
      <div className="min-w-0">
        <h2 className="m-0 text-base font-black">Subjects &amp; weekly periods</h2>
        {curriculum ? (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            {curriculum.curriculumName} · {curriculum.levelLabel} ·{' '}
            <strong>{curriculum.totalPeriods} periods/week</strong> · {curriculum.periodMinutes}-minute periods ·
            Source: {FRAMEWORK_SOURCE}.
            {curriculum.level === 'adapted' && ' Official adapted baseline — authorised adjustments for learner level are allowed.'}
          </p>
        ) : !grade ? (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            Pick a grade on the Class step to load its official subjects and weekly allocation.
          </p>
        ) : expectsAllocation ? (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            No official allocation is prescribed for this curriculum and grade
            {/^G7$/i.test(grade) ? ' (Grade 7 does not use the Grades 4–6 CBC table)' : ''} —
            see the diagnostic below.
          </p>
        ) : (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            This curriculum has no catalogued allocation table — the subjects below
            start from the standard list for this grade; set the weekly periods yourself.
          </p>
        )}
      </div>

      {/* Recovered-draft reconciliation — a restored curriculum/grade or
          subject set that no longer matches the catalog is flagged for
          review, never silently generated from. */}
      {recoveredReview && (
        <div className="space-y-1.5 rounded-xl border p-3 text-xs"
          style={{ borderColor: 'rgba(212,160,23,0.45)', background: 'rgba(212,160,23,0.08)' }}>
          <div className="flex items-center gap-1.5 font-black uppercase tracking-wide" style={{ color: 'var(--warning-fg)' }}>
            <AlertTriangle size={13} aria-hidden="true" />
            Recovered draft — needs review
          </div>
          <p style={{ color: 'var(--zt-text-muted)' }}>
            This unfinished timetable was recovered from another device. Its saved
            {' '}curriculum/grade{!recoveredReview.gradeValid ? ' is not offered in the current catalog' : ' allocation is incomplete'}.
            {recoveredReview.missing?.length
              ? ` Missing: ${recoveredReview.missing.map((m) => m.label).join(', ')}.`
              : ''}
            {' '}The original values are kept so you can review them — nothing was generated. Reset the
            subjects from the curriculum, or pick a valid grade, before generating.
          </p>
          <button type="button" onClick={onResetSubjects}
            className="studio-btn-ghost text-xs">Reset subjects from curriculum</button>
        </div>
      )}

      {/* Generation guard diagnostic — an incomplete/unavailable official
          allocation blocks generation and shows the exact coordinates. */}
      {allocationBlocked && grade && (
        <div className="space-y-1.5 rounded-xl border p-3 text-xs"
          style={{ borderColor: 'rgba(190,49,68,0.4)', background: 'rgba(190,49,68,0.06)' }}>
          <div className="font-black uppercase tracking-wide" style={{ color: 'var(--danger-fg)' }}>
            Curriculum timetable data unavailable
          </div>
          <p style={{ color: 'var(--zt-text-muted)' }}>
            {readiness.missing?.length
              ? `No complete curriculum allocation was found for this grade — ${readiness.missing.map((m) => m.label).join(', ')} ${readiness.missing.length === 1 ? 'is' : 'are'} missing. Generation has been disabled.`
              : 'No timetable allocation was found for this curriculum and grade. Generation has been disabled.'}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] sm:grid-cols-3" style={{ color: 'var(--zt-text-muted)' }}>
            <span>Curriculum ID: {curriculumId}</span>
            <span>Grade ID: {grade || '—'}</span>
            <span>Stage ID: {curriculum?.stageId || '—'}</span>
            <span>Resolved subjects: {readiness.resolvedSubjects}</span>
            <span>Required subjects: {readiness.requiredSubjects}</span>
            <span>Resolved periods: {readiness.resolvedPeriods}</span>
            <span>Required periods: {readiness.requiredPeriods}</span>
          </div>
          {curriculum && (
            <button type="button" onClick={onResetSubjects}
              className="studio-btn-ghost text-xs">Reset subjects from curriculum</button>
          )}
        </div>
      )}

      {/* One-of option groups (Expressive Arts OR Home Economics, language
          provision) as compact segmented controls. */}
      {curriculum?.optionGroups?.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black" title={`${g.hint} The unselected option gets 0 periods and never appears in auto-fill.`}>
            {g.label}
          </span>
          <div className="theme-border inline-flex overflow-hidden rounded-xl border text-xs font-bold"
            role="group" aria-label={g.label}
            title={`${g.hint} The unselected option gets 0 periods and never appears in auto-fill.`}>
            {g.options.map((o) => {
              const on = g.selectedOptionId === o.id
              return (
                <button key={o.id} type="button"
                  onClick={() => onOptionSwitch(g.id, o.id)}
                  aria-pressed={on}
                  className={`px-3 py-1.5 transition-all ${
                    on ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted bg-white hover:theme-text'
                  }`}>
                  {o.label} · {o.weeklyPeriods}/wk
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* Per-subject cards with live placed counts. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {subjects.map((s) => {
          const report = validation.bySubject.find((r) => r.label === s.label)
          const unselected = s.selected === false
          return (
            <div key={s.id}
              className={`theme-border rounded-xl border bg-white px-2.5 py-1.5 ${unselected ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-1.5">
                <input type="text" value={s.label} maxLength={60}
                  aria-label="Subject name"
                  onChange={(e) => onUpdateSubject(s.id, 'label', e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" />
                <input type="number" min={0} max={capacity || 40} value={s.periodsPerWeek}
                  aria-label={`${s.label} periods per week`}
                  onChange={(e) => onUpdateSubject(s.id, 'periodsPerWeek', clampInt(e.target.value, 0, capacity || 40))}
                  className="w-12 rounded-md bg-slate-50 py-1 text-center text-xs font-bold outline-none" />
                <span className="theme-text-secondary text-[10px]">/wk</span>
                <button type="button" onClick={() => onRemoveSubject(s.id)}
                  disabled={subjects.length <= 1}
                  aria-label={`Remove ${s.label}`}
                  className="px-1 text-sm font-black text-rose-500 hover:text-rose-700 disabled:opacity-30">×</button>
              </div>
              <div className="theme-text-secondary mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                {unselected ? (
                  <span className="font-bold" style={{ color: 'var(--warning-fg)' }}>Not selected — 0 periods</span>
                ) : (
                  <>
                    {report && (
                      <span className={`font-black ${report.status === 'ok' ? '' : 'text-rose-600'}`}
                        style={report.status === 'ok' ? { color: 'var(--success-fg)' } : undefined}>
                        {report.placed} of {report.target} placed
                      </span>
                    )}
                    {s.timeAllocation && <span>{s.timeAllocation}/wk</span>}
                    {s.compulsory && <span className="font-bold uppercase">Compulsory</span>}
                    {(s.blockPreference?.preferredBlocks || []).some((b) => b >= 2) && (
                      <span>{(s.blockPreference.preferredBlocks.filter((b) => b >= 2).length)}× double preferred</span>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
        <button type="button" onClick={onAddSubject}
          className="theme-border theme-text-secondary rounded-xl border border-dashed bg-white/60 px-2.5 py-1.5 text-xs font-bold hover:theme-text">
          + Add subject
        </button>
      </div>

      <div className={`text-xs font-bold ${overAllocated ? 'text-rose-700' : ''}`} style={overAllocated ? undefined : { color: 'var(--zt-text-muted)' }}>
        {allocated} periods allocated · {capacity} slots available
        {overAllocated && ' — over capacity: not everything will fit. Add lesson periods or reduce allocations.'}
        {!overAllocated && spareSlots > 0 && curriculum && (
          weekMode === 'activities'
            ? ` · ${spareSlots} spare slot${spareSlots === 1 ? '' : 's'} will become school activities.`
            : ` · ${spareSlots} spare slot${spareSlots === 1 ? '' : 's'} — switch to the exact curriculum week or they stay empty at the end of the day.`
        )}
      </div>

      {/* Spare-slot policy: exact week vs school activities. */}
      {curriculum && (
        <div className="theme-border space-y-1.5 rounded-xl border bg-white px-3 py-2.5">
          <div className="text-xs font-black">How should the spare timetable slots be used?</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {[
              { id: 'activities', label: 'Curriculum + school activities', hint: `Keep every slot — spare slots become labelled activities (${activities.slice(0, 3).join(', ')}…)` },
              { id: 'exact', label: 'Exact curriculum week', hint: 'Different lesson counts per day so the week is exactly the curriculum total' },
            ].map((m) => {
              const on = weekMode === m.id
              return (
                <button key={m.id} type="button" onClick={() => onWeekModeChange(m.id)}
                  aria-pressed={on}
                  title={m.hint}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left transition-all ${on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border bg-white'}`}>
                  <div className="text-xs font-black">{m.label}</div>
                  <div className={`mt-0.5 text-[10px] ${on ? 'opacity-80' : 'theme-text-secondary'}`}>{m.hint}</div>
                </button>
              )
            })}
          </div>

          {weekMode === 'exact' && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] font-bold" style={{ color: 'var(--zt-text-muted)' }}>Lesson periods per day:</span>
              {days.map((d) => (
                <label key={d} className="flex items-center gap-1 text-[11px] font-bold">
                  {d.slice(0, 3)}
                  <input type="number" min={0} max={timing.lessonPeriods}
                    value={dayCounts[d] ?? timing.lessonPeriods}
                    onChange={(e) => setDayCounts((c) => ({ ...c, [d]: clampInt(e.target.value, 0, timing.lessonPeriods) }))}
                    className="studio-input w-12 !py-1 text-center text-xs font-bold" />
                </label>
              ))}
              <span className="text-[11px]" style={{ color: days.reduce((n, d) => n + (dayCounts[d] ?? timing.lessonPeriods), 0) === curriculum.totalPeriods ? '#1E8449' : '#9a7000' }}>
                = {days.reduce((n, d) => n + (dayCounts[d] ?? timing.lessonPeriods), 0)} slots (curriculum needs {curriculum.totalPeriods})
              </span>
            </div>
          )}

          {weekMode === 'activities' && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SCHOOL_ACTIVITIES.map((a) => {
                const on = activities.includes(a)
                return (
                  <button key={a} type="button"
                    onClick={() => setActivities((list) => on ? list.filter((x) => x !== a) : [...list, a])}
                    aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all ${
                      on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border theme-text-muted bg-white hover:theme-text'
                    }`}>
                    {a}
                  </button>
                )
              })}
              <span className="self-center text-[10px]" style={{ color: 'var(--zt-text-muted)' }}>
                School activities never count as curriculum contact time.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {showAutoFill && (
          <button type="button" onClick={onAutoFill} className="studio-btn-primary text-sm">
            Auto-fill timetable
          </button>
        )}
        <button type="button" onClick={onResetSubjects} className="studio-btn-ghost text-xs">
          Reset from curriculum
        </button>
        {showAutoFill && (
          <>
            <span className="self-center text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
              Locked cells are kept exactly where they are.
            </span>
            <button type="button" onClick={onRequestClear} className="studio-btn-ghost text-xs text-rose-700">
              Clear grid
            </button>
          </>
        )}
      </div>
    </section>
  )
}
