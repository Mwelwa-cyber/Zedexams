/**
 * Descriptors for the hand-built teacher studios (Record of Work, Mark Schedule,
 * Class Timetable, Weekly Forecast, SBA Mark Tracker, SBA Year Planner).
 *
 * These studios don't use the { form, curr } + StudioCurriculumSelector shape,
 * so they can't use makeInputDescriptor — each persists a bespoke set of state
 * slices. Every descriptor is a plain object matching the draftCore contract
 * ({ studioId, schemaVersion, ttl?, serialize, hydrate, isNonEmpty }). They live
 * here (pure, no React) so they can be unit-tested under plain node —
 * see handBuilt.test.js. Studio-specific restore transforms (e.g. the weekly
 * forecast's numeric→weekday day migration) run in the studio's onRestore, not
 * hydrate, to keep these descriptors dependency-free.
 *
 * `generationId` is persisted in every descriptor so the "Update in library"
 * button state survives a reload/recovery exactly as it did with the old
 * localStorage drafts.
 */

const DAY = 24 * 60 * 60 * 1000

const identity = (p) => p

export const recordOfWorkDescriptor = {
  studioId: 'record_of_work',
  schemaVersion: 1,
  ttl: 30 * DAY,
  serialize: (s) => ({ header: s.header, weeks: s.weeks, generationId: s.generationId }),
  hydrate: identity,
  // workDone is an array of "work done" lines (never a string), so length —
  // not .trim() — is the real "has work" signal. Calling .trim() on the array
  // threw and crashed the studio on mount.
  isNonEmpty: (p) => (p?.weeks || []).some((w) => w?.topic?.trim() || (w?.workDone || []).length),
}

export const markScheduleDescriptor = {
  studioId: 'mark_schedule',
  schemaVersion: 1,
  ttl: 30 * DAY,
  serialize: (s) => ({ header: s.header, subjects: s.subjects, pupils: s.pupils, mode: s.mode, generationId: s.generationId }),
  hydrate: identity,
  isNonEmpty: (p) => (p?.pupils || []).some((pu) => pu?.name?.trim()),
}

export const classTimetableDescriptor = {
  studioId: 'class_timetable',
  schemaVersion: 1,
  ttl: 60 * DAY,
  // v2 studio state: `blocks` are the schedule's source of truth; the derived
  // `slots` map is still serialized so an old client restoring this draft —
  // or this client restoring an old draft — keeps working.
  serialize: (s) => ({
    header: s.header, days: s.days, timing: s.timing, subjects: s.subjects,
    slots: s.slots, blocks: s.blocks, generationId: s.generationId,
    curriculumId: s.curriculumId, selectedOptions: s.selectedOptions,
    weekMode: s.weekMode, dayCounts: s.dayCounts, activities: s.activities,
    displayPreferences: s.displayPreferences, dayTemplate: s.dayTemplate,
  }),
  hydrate: identity,
  // Mirrors the studio's `filled > 0` save gate: at least one lesson placed.
  isNonEmpty: (p) => (Array.isArray(p?.blocks) && p.blocks.length > 0)
    || Object.values(p?.slots || {}).some((v) => v && (typeof v !== 'object' || Object.keys(v).length)),
}

export const weeklyForecastDescriptor = {
  studioId: 'weekly_forecast',
  schemaVersion: 1,
  ttl: 30 * DAY,
  // Derived grade + subjectLabel are persisted so the curriculum selector can be
  // re-seeded on restore (the studio's onRestore runs migrateDayWeekdays on days).
  serialize: (s) => ({
    header: s.header,
    days: s.days,
    timetableId: s.timetableId,
    generationId: s.generationId,
    grade: s.grade,
    subjectLabel: s.subjectLabel,
  }),
  hydrate: identity,
  isNonEmpty: (p) => (p?.days || []).some((d) => d?.topic?.trim() || (d?.learningActivities || []).length),
}

export const sbaTrackerDescriptor = {
  studioId: 'sba_tracker',
  schemaVersion: 1,
  ttl: 120 * DAY,
  serialize: (s) => ({ header: s.header, pupils: s.pupils, generationId: s.generationId }),
  hydrate: identity,
  isNonEmpty: (p) => (p?.pupils || []).some((pu) => pu?.name?.trim()),
}

export const sbaPlannerDescriptor = {
  studioId: 'sba_planner',
  schemaVersion: 1,
  ttl: 200 * DAY,
  serialize: (s) => ({ header: s.header, statuses: s.statuses, generationId: s.generationId }),
  hydrate: identity,
  isNonEmpty: (p) => Object.keys(p?.statuses || {}).length > 0,
}
