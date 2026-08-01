/**
 * Wizard Step 2 · School day — period times, assembly/breaks/lunch,
 * day-specific weekly structures and date-specific School Calendar
 * overrides. Presentational: state and handlers stay in
 * ClassTimetableStudio. The SAME component is reused by the workspace's
 * "Day times" drawer, so a teacher can fix the school day without leaving
 * the grid.
 */

import { AlertTriangle } from 'lucide-react'
import {
  SCHOOL_DAY_TEMPLATES,
  getSchoolDayTemplate,
  DAY_TYPES,
  dayTypeLabel,
  templatesForDayType,
  periodsForDay,
  slotCountForDay,
  lastLessonEndTime,
  effectiveDayScheduleForDate,
} from '../../../../utils/classTimetable'
import { clampInt } from '../../../../utils/inputs.js'
import { durationLabelForEvent } from '../../../../utils/durationOptions'
import DurationSelect from '../../../ui/DurationSelect'
import { FieldWrapper } from '../studioFields'

export default function WizardStepSchoolDay({
  timing,
  setT,
  updateBreak,
  dayTemplate,
  applyDayTemplate,
  derivedPeriodMinutes,
  computedEnd,
  knockOffDelta,
  days,
  periods,
  dayStructure,
  daySchedules,
  editingDayStructureFor,
  setEditingDayStructureFor,
  setDayType,
  applyDayTemplateToDay,
  updateDayTiming,
  updateDayBreak,
  clearDaySchedule,
  capacityFit,
  calendarOverrides,
  newOverrideDate,
  setNewOverrideDate,
  newOverrideDayType,
  setNewOverrideDayType,
  newOverrideReason,
  setNewOverrideReason,
  addCalendarOverride,
  removeOverride,
}) {
  return (
    <>
      {/* ── Period times ── */}
      <section className="studio-card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-base font-black">School day &amp; period times</h2>
          <FieldWrapper label="Start from a template">
            <select value={dayTemplate} onChange={(e) => applyDayTemplate(e.target.value)} className="studio-input !py-1.5 text-xs">
              {SCHOOL_DAY_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </FieldWrapper>
        </div>
        <p className="-mt-2 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
          {getSchoolDayTemplate(dayTemplate)?.description}
        </p>

        {/* How the day is timed: fit between report & knock-off, or fixed length */}
        <div className="space-y-1.5">
          <span className="studio-label">How should the day be timed?</span>
          <div className="theme-border inline-flex overflow-hidden rounded-xl border text-xs font-black">
            {[
              { key: true, label: 'Fit to report & knock-off' },
              { key: false, label: 'Fixed period length' },
            ].map((opt) => {
              const on = !!timing.fitToEndTime === opt.key
              return (
                <button key={String(opt.key)} type="button"
                  onClick={() => setT('fitToEndTime', opt.key)}
                  aria-pressed={on}
                  className={`px-3 py-2 transition-all ${on ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted bg-white hover:theme-text'}`}>
                  {opt.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            {timing.fitToEndTime
              ? 'Enter when the school reports and when it knocks off — the studio shares the day evenly across the lessons and drops each break in at the time you set.'
              : 'Set a fixed period length — the studio works out what time the day knocks off.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FieldWrapper label="School reports (start)">
            <input type="time" value={timing.startTime}
              onChange={(e) => setT('startTime', e.target.value)} className="studio-input" />
          </FieldWrapper>
          <FieldWrapper label={timing.fitToEndTime ? 'Knock-off (end)' : 'Knock-off target (optional)'}>
            <input type="time" value={timing.endTime}
              onChange={(e) => setT('endTime', e.target.value)} className="studio-input" />
          </FieldWrapper>
          {timing.fitToEndTime ? (
            <FieldWrapper label="Period length (auto)">
              <div className="studio-input flex items-center font-bold" style={{ background: '#efe9da', color: 'var(--zt-text-muted)' }} aria-live="polite">
                {derivedPeriodMinutes ? `≈ ${derivedPeriodMinutes} min` : '—'}
              </div>
            </FieldWrapper>
          ) : (
            <FieldWrapper label="Period length (minutes)">
              <input type="number" min={5} max={180} value={timing.periodMinutes}
                onChange={(e) => setT('periodMinutes', clampInt(e.target.value, 5, 180))} className="studio-input" />
            </FieldWrapper>
          )}
          <FieldWrapper label="Lesson periods per day">
            <input type="number" min={1} max={14} value={timing.lessonPeriods}
              onChange={(e) => setT('lessonPeriods', clampInt(e.target.value, 1, 14))} className="studio-input" />
          </FieldWrapper>
        </div>

        {/* Knock-off readout / check */}
        {timing.fitToEndTime ? (
          <p className="text-xs font-bold" style={{ color: 'var(--zt-text-muted)' }}>
            The day runs {timing.startTime}–{timing.endTime}.
            {derivedPeriodMinutes ? ` Each of the ${timing.lessonPeriods} lesson periods is about ${derivedPeriodMinutes} minutes.` : ''}
          </p>
        ) : computedEnd ? (
          knockOffDelta !== null && knockOffDelta > 0 ? (
            <p className="flex items-start gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold"
              style={{ borderColor: '#e5b800', background: '#fff8e1', color: '#8a6d00' }}>
              <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                These periods run to {computedEnd} — {knockOffDelta} min past your {timing.endTime} knock-off.
                Shorten a period or a break, or switch to "Fit to report &amp; knock-off".
              </span>
            </p>
          ) : (
            <p className="text-xs font-bold" style={{ color: '#1E8449' }}>
              {knockOffDelta === null || knockOffDelta === 0
                ? `These periods knock off at ${computedEnd}${timing.endTime ? ' — exactly your target.' : '.'}`
                : `These periods knock off at ${computedEnd} — ${-knockOffDelta} min before your ${timing.endTime} target.`}
            </p>
          )
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="studio-label !mb-0">Assembly, breaks, lunch &amp; closing</span>
            <span className="text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
              These never count as curriculum periods. No lunch at your school? Just untick it.
            </span>
          </div>
          {timing.breaks.map((b, idx) => {
            const isBookend = b.event === 'assembly' || b.event === 'closing'
            const timeId = `brk-time-${idx}`
            const afterId = `brk-after-${idx}`
            return (
              <div key={idx} className="theme-border space-y-2 rounded-xl border bg-white px-3 py-2.5">
                <label className="flex items-center gap-2 text-xs font-bold">
                  <input type="checkbox" checked={b.enabled !== false}
                    style={{ minWidth: 18, minHeight: 18 }}
                    onChange={(e) => updateBreak(idx, 'enabled', e.target.checked)} />
                  <input type="text" value={b.name} maxLength={16}
                    aria-label="Block name"
                    onChange={(e) => updateBreak(idx, 'name', e.target.value.toUpperCase())}
                    className="min-w-0 flex-1 bg-transparent font-black outline-none" />
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    {isBookend ? (
                      <>
                        <span className="studio-label">When</span>
                        <div className="studio-input flex w-full items-center text-xs"
                          style={{ minHeight: 44, background: '#f7f4ec', color: 'var(--zt-text-muted)' }}>
                          {b.event === 'assembly' ? 'Before lessons' : 'After last period'}
                        </div>
                      </>
                    ) : timing.fitToEndTime ? (
                      <>
                        <label htmlFor={timeId} className="studio-label">Start time</label>
                        <input id={timeId} type="time" value={b.time || ''}
                          aria-label={`${b.name} start time`}
                          onChange={(e) => updateBreak(idx, 'time', e.target.value)}
                          className="studio-input w-full" style={{ minHeight: 44 }} />
                      </>
                    ) : (
                      <>
                        <label htmlFor={afterId} className="studio-label">After period</label>
                        <input id={afterId} type="number" min={1} max={timing.lessonPeriods} value={b.afterPeriod}
                          aria-label={`${b.name} after period`}
                          onChange={(e) => updateBreak(idx, 'afterPeriod', clampInt(e.target.value, 1, timing.lessonPeriods))}
                          className="studio-input w-full" style={{ minHeight: 44 }} />
                      </>
                    )}
                  </div>
                  <DurationSelect
                    value={b.minutes}
                    onChange={(m) => updateBreak(idx, 'minutes', m)}
                    label={durationLabelForEvent(b.event, b.name)}
                    min={1}
                    max={180}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Day-specific school structure ── */}
      <section className="studio-card space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="m-0 text-base font-black" title="A regular weekly pattern saved with this timetable — e.g. a Friday that always knocks off at 12:30.">
            Day-specific school structure
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            Every teaching day uses the school day above by default. Give a day its own Full day / Half day / Custom
            structure for a <strong>regular</strong> weekly pattern. An <strong>occasional</strong> one-off change belongs
            in the School Calendar below instead.
          </p>
        </div>

        {!capacityFit.fits && (
          <div className="flex items-start gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: '#e5b800', background: '#fff8e1', color: '#8a6d00' }}>
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              This week needs {capacityFit.required} periods but the current day structures only hold {capacityFit.capacity}
              {' '}({capacityFit.shortfall} short) — auto-fill and generation are blocked until you add lesson periods
              or change a day's structure.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {days.map((day) => {
            const override = daySchedules[day] || null
            const dayType = override?.dayType || 'full'
            const dayPeriods = periodsForDay(day, periods, dayStructure)
            const reports = dayPeriods.length ? dayPeriods[0].start : timing.startTime
            const knockOff = lastLessonEndTime(dayPeriods)
            const count = slotCountForDay(day, periods, dayStructure)
            const expanded = editingDayStructureFor === day
            return (
              <div key={day} className="theme-border rounded-xl border bg-white px-3 py-2" style={{ minWidth: 210, flex: '1 1 210px' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black">{day}</span>
                  <span className="text-[10px] font-black uppercase" style={{ color: override ? '#9a7000' : '#8a7f67' }}>
                    {override ? dayTypeLabel(dayType) : 'Same as the week'}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
                  Reports {reports || '—'} · Knocks off {knockOff || '—'} · {count} lesson{count === 1 ? '' : 's'}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button type="button" onClick={() => setEditingDayStructureFor(expanded ? null : day)}
                    className="studio-btn-ghost !py-1 !px-2 text-[11px]">
                    {expanded ? 'Close' : override ? 'Edit' : 'Customise'}
                  </button>
                  {override && (
                    <button type="button" onClick={() => clearDaySchedule(day)}
                      className="studio-btn-ghost !py-1 !px-2 text-[11px]" style={{ color: 'var(--danger-fg)' }}>
                      Reset to the week
                    </button>
                  )}
                </div>

                {expanded && (
                  <div className="theme-border mt-2 space-y-2 border-t pt-2">
                    <div className="theme-border inline-flex overflow-hidden rounded-lg border text-[11px] font-black">
                      {DAY_TYPES.map((t) => {
                        const on = dayType === t.id && !!override
                        return (
                          <button key={t.id} type="button" onClick={() => setDayType(day, t.id)} aria-pressed={on}
                            className={`px-2 py-1 transition-all ${on ? 'theme-accent-fill theme-on-accent' : 'theme-text-muted bg-white hover:theme-text'}`}>
                            {t.label}
                          </button>
                        )
                      })}
                    </div>

                    {override && (
                      <>
                        <FieldWrapper label="Start from a template">
                          <select value={override.templateId || ''} onChange={(e) => applyDayTemplateToDay(day, e.target.value)}
                            className="studio-input !py-1 text-[11px]">
                            {templatesForDayType(dayType).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </FieldWrapper>

                        <div className="grid grid-cols-2 gap-2">
                          <FieldWrapper label="Reports (start)">
                            <input type="time" value={override.timing.startTime}
                              onChange={(e) => updateDayTiming(day, 'startTime', e.target.value)}
                              className="studio-input !py-1 text-[11px]" />
                          </FieldWrapper>
                          <FieldWrapper label="Knock-off (end)">
                            <input type="time" value={override.timing.endTime}
                              onChange={(e) => updateDayTiming(day, 'endTime', e.target.value)}
                              className="studio-input !py-1 text-[11px]" />
                          </FieldWrapper>
                        </div>
                        <FieldWrapper label="Lesson periods">
                          <input type="number" min={1} max={14} value={override.timing.lessonPeriods}
                            onChange={(e) => updateDayTiming(day, 'lessonPeriods', clampInt(e.target.value, 1, 14))}
                            className="studio-input w-20 !py-1 text-[11px]" />
                        </FieldWrapper>

                        <div className="space-y-2">
                          {override.timing.breaks.map((b, idx) => {
                            const isBookend = b.event === 'assembly' || b.event === 'closing'
                            const dayTimeId = `day-${day}-brk-time-${idx}`
                            return (
                              <div key={idx} className="theme-border space-y-1.5 rounded-lg border px-2 py-2">
                                <label className="flex items-center gap-1.5 text-[11px] font-bold">
                                  <input type="checkbox" checked={b.enabled !== false}
                                    style={{ minWidth: 18, minHeight: 18 }}
                                    onChange={(e) => updateDayBreak(day, idx, 'enabled', e.target.checked)} />
                                  {b.name}
                                </label>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div>
                                    {isBookend ? (
                                      <>
                                        <span className="studio-label">When</span>
                                        <div className="studio-input flex w-full items-center text-[11px]"
                                          style={{ minHeight: 44, background: '#f7f4ec', color: 'var(--zt-text-muted)' }}>
                                          {b.event === 'assembly' ? 'Before lessons' : 'After last period'}
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <label htmlFor={dayTimeId} className="studio-label">Start time</label>
                                        <input id={dayTimeId} type="time" value={b.time || ''}
                                          aria-label={`${day} ${b.name} start time`}
                                          onChange={(e) => updateDayBreak(day, idx, 'time', e.target.value)}
                                          className="studio-input w-full" style={{ minHeight: 44 }} />
                                      </>
                                    )}
                                  </div>
                                  <DurationSelect
                                    value={b.minutes}
                                    onChange={(m) => updateDayBreak(day, idx, 'minutes', m)}
                                    label={durationLabelForEvent(b.event, b.name)}
                                    ariaLabel={`${day} ${durationLabelForEvent(b.event, b.name)}`}
                                    min={1}
                                    max={180}
                                  />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── School Calendar overrides (sub-list) ── */}
        <div className="theme-border space-y-3 border-t pt-3">
          <div>
            <h3 className="m-0 text-sm font-black" title="An occasional, date-specific change that never touches the saved weekly timetable.">
              School Calendar — date-specific overrides
            </h3>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
              For an <strong>occasional</strong> change to one calendar date — a single Friday shortened for a staff
              meeting, a sports day — without permanently changing the saved weekly timetable above.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <FieldWrapper label="Date">
              <input type="date" value={newOverrideDate} onChange={(e) => setNewOverrideDate(e.target.value)}
                className="studio-input !py-1.5 text-xs" />
            </FieldWrapper>
            <FieldWrapper label="Day type">
              <select value={newOverrideDayType} onChange={(e) => setNewOverrideDayType(e.target.value)}
                className="studio-input !py-1.5 text-xs">
                {DAY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </FieldWrapper>
            <FieldWrapper label="Reason (optional)">
              <input type="text" value={newOverrideReason} maxLength={80}
                onChange={(e) => setNewOverrideReason(e.target.value)}
                placeholder="e.g. Staff meeting" className="studio-input !py-1.5 text-xs" />
            </FieldWrapper>
            <button type="button" onClick={addCalendarOverride} className="studio-btn-primary !py-1.5 text-xs">
              Add override
            </button>
          </div>

          {calendarOverrides.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>No date-specific overrides recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {calendarOverrides.map((o) => {
                const resolved = effectiveDayScheduleForDate({
                  date: o.date, periods, dayStructure, calendarOverrides,
                })
                return (
                  <div key={o.date} className="theme-border flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2">
                    <div>
                      <span className="text-xs font-black">{o.date}</span>
                      <span className="ml-2 text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
                        {resolved.weekday} · {dayTypeLabel(o.dayType)} · knocks off {lastLessonEndTime(resolved.periods) || '—'}
                        {o.reason ? ` · ${o.reason}` : ''}
                      </span>
                    </div>
                    <button type="button" onClick={() => removeOverride(o.date)}
                      className="studio-btn-ghost !py-1 !px-2 text-[11px]" style={{ color: 'var(--danger-fg)' }}>
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
