/**
 * useClassRegister — state engine for the Class Register Studio.
 *
 * Owns, for one class + resolved term:
 *   - realtime subscriptions: roster, term settings doc, every saved
 *     attendance day in the term, and the currently selected day;
 *   - optimistic marking with a per-date pending queue, debounced auto-save
 *     (through attendanceService's merging transaction), retry, and undo;
 *   - save-state reporting ('idle'|'dirty'|'saving'|'saved'|'error'|'offline');
 *   - audit logging for every change batch (diffed in attendanceDayCore);
 *   - guards: nothing saves before the initial snapshots hydrate, and no
 *     effect depends on an unstable object it also writes (queues live in
 *     refs; renders are triggered by a monotonic counter).
 *
 * The hook never does attendance mathematics — views call
 * attendanceCalculator with the day list this hook exposes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeRoster } from '../utils/classRoster'
import {
  saveAttendanceDay,
  subscribeAttendanceDay,
  subscribeAttendanceTerm,
  subscribeTermAttendance,
  logAttendanceAudit,
} from '../utils/attendanceService'
import { plainRecords, diffRecords, buildMarkAllPresent, sanitizeNote } from '../utils/attendanceDayCore'
import {
  buildTermDays,
  customTermInfo,
  defaultRegisterDate,
  localTodayIso,
  resolveTermInfo,
  termNumberFromLabel,
} from '../utils/attendanceCalendarResolver'

const AUTOSAVE_DELAY_MS = 900

export default function useClassRegister({ register, termSelection, uid, onConflict }) {
  const classId = register?.id
  const termLabel = termSelection?.term || ''
  const termYear = Number(termSelection?.year) || null
  // Stable id regardless of whether dates come from the MoE calendar or the
  // teacher's custom dates — '2026-T2' style, matching MoE term ids.
  const termId = termLabel && termYear
    ? `${termYear}-T${termNumberFromLabel(termLabel) ?? 'X'}`
    : null

  // ── realtime data ──────────────────────────────────────────────
  const [roster, setRoster] = useState(null) // null until first snapshot
  const [termDoc, setTermDoc] = useState(undefined) // undefined = loading, null = none yet
  const [termDayDocs, setTermDayDocs] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedDayDoc, setSelectedDayDoc] = useState(undefined)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    if (!classId) return undefined
    const unsub = subscribeRoster(classId, setRoster, (err) => setLoadError(err))
    return unsub
  }, [classId])

  useEffect(() => {
    if (!classId || !termId) return undefined
    setTermDoc(undefined)
    const unsub = subscribeAttendanceTerm(classId, termId, setTermDoc, (err) => setLoadError(err))
    return unsub
  }, [classId, termId])

  useEffect(() => {
    if (!classId || !termId) return undefined
    setTermDayDocs(null)
    const unsub = subscribeTermAttendance(classId, termId, setTermDayDocs, (err) => setLoadError(err))
    return unsub
  }, [classId, termId])

  // ── term resolution + the calendar day list ────────────────────
  // The school calendar (MoE data) is the source of truth; when it has no
  // data for this year/term the attendanceTerms doc can carry teacher-entered
  // custom dates. Neither → termInfo null and the studio shows its
  // calendar-not-configured empty state.
  const termInfo = useMemo(() => {
    if (!termLabel || !termYear) return null
    const moe = resolveTermInfo({ term: termLabel, year: termYear })
    if (moe) return moe
    const docLoaded = termDoc !== undefined ? termDoc : null
    if (docLoaded?.customStartDate && docLoaded?.customEndDate) {
      return customTermInfo({
        term: termLabel,
        year: termYear,
        startDate: docLoaded.customStartDate,
        endDate: docLoaded.customEndDate,
      })
    }
    return null
  }, [termLabel, termYear, termDoc])

  const todayIso = useMemo(() => localTodayIso(), [])
  const days = useMemo(() => {
    if (!termInfo) return []
    return buildTermDays({
      termInfo,
      dayOverrides: (termDoc !== undefined && termDoc?.dayOverrides) || {},
      todayIso,
    })
  }, [termInfo, termDoc, todayIso])

  // Default the selected date once the day list exists (today, or the most
  // recent markable day). Guarded so a user's choice is never overridden.
  useEffect(() => {
    if (!days.length) return
    setSelectedDate((current) => {
      if (current && days.some((d) => d.date === current)) return current
      return defaultRegisterDate(days, todayIso)
    })
  }, [days, todayIso])

  // ── selected-day subscription ──────────────────────────────────
  useEffect(() => {
    if (!classId || !selectedDate) return undefined
    setSelectedDayDoc(undefined)
    const unsub = subscribeAttendanceDay(classId, selectedDate, setSelectedDayDoc, (err) => setLoadError(err))
    return unsub
  }, [classId, selectedDate])

  // ── pending-change queue (refs — never effect dependencies) ────
  // pending: Map<date, { base: plainRecords-at-edit-time, changes: {learnerId: {status,note}} }>
  const pendingRef = useRef(new Map())
  const undoRef = useRef([])
  const timerRef = useRef(null)
  const savingRef = useRef(false)
  const [mutation, setMutation] = useState(0) // monotonic render trigger
  const [saveState, setSaveState] = useState('idle')
  const [remoteEditNotice, setRemoteEditNotice] = useState(null)

  // Server records for any date, from the live term subscription (the selected
  // day also has its own doc subscription, which is fresher during typing).
  const serverRecordsFor = useCallback((date) => {
    if (date === selectedDate && selectedDayDoc !== undefined) {
      return plainRecords(selectedDayDoc?.records)
    }
    const dayDoc = (termDayDocs || []).find((d) => d.date === date)
    return plainRecords(dayDoc?.records)
  }, [selectedDate, selectedDayDoc, termDayDocs])

  const dayMetaFor = useCallback((date) => {
    const day = days.find((d) => d.date === date)
    return {
      term: termInfo?.termLabel ?? '',
      year: termInfo?.year ?? null,
      termId: termInfo?.termId ?? '',
      classification: day?.classification || 'teaching_day',
    }
  }, [days, termInfo])

  // Flag when another editor changes the selected day underneath local edits.
  const lastSeenVersionRef = useRef(null)
  useEffect(() => {
    if (selectedDayDoc === undefined) return
    const version = selectedDayDoc?.version ?? 0
    const prev = lastSeenVersionRef.current
    lastSeenVersionRef.current = version
    if (prev == null || version <= prev) return
    const editedByOther = selectedDayDoc?.updatedBy && selectedDayDoc.updatedBy !== uid
    if (editedByOther) setRemoteEditNotice({ date: selectedDate, by: selectedDayDoc.updatedBy })
  }, [selectedDayDoc, selectedDate, uid])
  useEffect(() => { lastSeenVersionRef.current = null; setRemoteEditNotice(null) }, [selectedDate])

  // ── save pipeline ──────────────────────────────────────────────
  const flush = useCallback(async ({ reason = '' } = {}) => {
    if (savingRef.current) return
    if (!pendingRef.current.size) return
    if (!classId || !uid) return
    savingRef.current = true
    setSaveState('saving')

    // Capture and detach the batch; edits made while saving start a new one.
    const batch = pendingRef.current
    pendingRef.current = new Map()
    let failed = false

    for (const [date, entry] of batch) {
      try {
        const result = await saveAttendanceDay({
          classId,
          teacherUid: register?.teacherUid || uid,
          date,
          termMeta: dayMetaFor(date),
          baseRecords: entry.base,
          localChanges: entry.changes,
        })
        if (result.conflicts.length && typeof onConflict === 'function') {
          onConflict({ date, learnerIds: result.conflicts })
        }
        // Audit: what this batch actually changed relative to its base.
        const before = {}
        const after = {}
        for (const learnerId of Object.keys(entry.changes)) {
          if (entry.base[learnerId]) before[learnerId] = entry.base[learnerId]
          after[learnerId] = entry.changes[learnerId]
        }
        const entries = diffRecords(before, after)
        const isCorrection = date < todayIso
        await logAttendanceAudit(classId, uid, entries, {
          teacherUid: register?.teacherUid || uid,
          termId: termId || '',
          date,
          action: isCorrection ? 'correction' : 'mark',
          reason: isCorrection ? sanitizeNote(reason) : '',
        })
      } catch (err) {
        failed = true
        // Re-queue this date's changes (newest edits win over the failed batch).
        const current = pendingRef.current.get(date)
        pendingRef.current.set(date, {
          base: entry.base,
          changes: { ...entry.changes, ...(current?.changes || {}) },
        })
        console.warn('[useClassRegister] save failed', date, err)
      }
    }

    savingRef.current = false
    if (failed) {
      setSaveState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error')
    } else if (pendingRef.current.size) {
      setSaveState('dirty')
    } else {
      setSaveState('saved')
    }
    setMutation((m) => m + 1)
  }, [classId, uid, register, dayMetaFor, termId, todayIso, onConflict])

  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])

  const scheduleSave = useCallback((opts) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flushRef.current(opts)
    }, AUTOSAVE_DELAY_MS)
  }, [])

  // Never lose the queue on unmount / tab close.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (pendingRef.current.size || savingRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (pendingRef.current.size) flushRef.current({})
    }
  }, [])

  // ── mutations ──────────────────────────────────────────────────
  const hydrated = roster !== null && selectedDayDoc !== undefined && termDoc !== undefined

  // Latest displayed records for the selected day (server + pending overlay),
  // kept in a ref so mutation callbacks read fresh state without re-creating.
  const displayedRecordsRef = useRef({})

  const mutate = useCallback((date, learnerId, record, { correctionReason = '' } = {}) => {
    if (!hydrated) return // never mutate before stored data has loaded
    const queue = pendingRef.current
    if (!queue.has(date)) {
      queue.set(date, { base: serverRecordsFor(date), changes: {} })
    }
    const entry = queue.get(date)
    const prev = entry.changes[learnerId] || entry.base[learnerId] || null
    undoRef.current.push({ date, learnerId, prev })
    if (undoRef.current.length > 100) undoRef.current.shift()
    entry.changes[learnerId] = { status: record.status, note: sanitizeNote(record.note ?? prev?.note ?? '') }
    setSaveState('dirty')
    setMutation((m) => m + 1)
    scheduleSave({ reason: correctionReason })
  }, [hydrated, serverRecordsFor, scheduleSave])

  const setStatus = useCallback((learnerId, status, opts = {}) => {
    if (!selectedDate) return
    const current = displayedRecordsRef.current[learnerId]
    mutate(selectedDate, learnerId, { status, note: opts.note ?? current?.note ?? '' }, opts)
  }, [selectedDate, mutate])

  const setNote = useCallback((learnerId, note, opts = {}) => {
    if (!selectedDate) return
    const current = displayedRecordsRef.current[learnerId]
    if (!current?.status) return // a note needs a mark to attach to
    mutate(selectedDate, learnerId, { status: current.status, note }, opts)
  }, [selectedDate, mutate])

  /** Mark a cell on ANY date (term grid view). */
  const setStatusOn = useCallback((date, learnerId, status, opts = {}) => {
    const base = pendingRef.current.get(date)
    const current = base?.changes[learnerId] || serverRecordsFor(date)[learnerId]
    mutate(date, learnerId, { status, note: current?.note ?? '' }, opts)
  }, [mutate, serverRecordsFor])

  const markAllPresent = useCallback((opts = {}) => {
    if (!selectedDate || !hydrated) return 0
    const changes = buildMarkAllPresent({
      roster: roster || [],
      records: displayedRecordsRef.current,
      date: selectedDate,
      termInfo,
    })
    const ids = Object.keys(changes)
    for (const learnerId of ids) mutate(selectedDate, learnerId, changes[learnerId], opts)
    return ids.length
  }, [selectedDate, hydrated, roster, termInfo, mutate])

  const undoLast = useCallback(() => {
    const last = undoRef.current.pop()
    if (!last) return null
    const queue = pendingRef.current
    if (!queue.has(last.date)) {
      queue.set(last.date, { base: serverRecordsFor(last.date), changes: {} })
    }
    const entry = queue.get(last.date)
    if (last.prev) {
      entry.changes[last.learnerId] = { ...last.prev }
    } else {
      // The row was unmarked before this session touched it — dropping the
      // pending change restores the (unmarked) server state.
      delete entry.changes[last.learnerId]
      if (!Object.keys(entry.changes).length) queue.delete(last.date)
    }
    setSaveState(queue.size ? 'dirty' : 'saved')
    setMutation((m) => m + 1)
    if (queue.size) scheduleSave({})
    return last
  }, [serverRecordsFor, scheduleSave])

  const retry = useCallback(() => { flushRef.current({}) }, [])
  const saveNow = useCallback((opts = {}) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    return flushRef.current(opts)
  }, [])

  // ── derived views ──────────────────────────────────────────────
  // Displayed records for the selected day = server state + pending overlay.
  const displayedRecords = useMemo(() => {
    void mutation // pending queue changed
    const server = selectedDayDoc === undefined ? {} : plainRecords(selectedDayDoc?.records)
    const pending = pendingRef.current.get(selectedDate)?.changes || {}
    return { ...server, ...pending }
  }, [selectedDayDoc, selectedDate, mutation])
  useEffect(() => { displayedRecordsRef.current = displayedRecords }, [displayedRecords])

  // Day list with records attached (server + pending overlays) — the exact
  // shape attendanceCalculator consumes for totals, summaries and exports.
  const daysWithRecords = useMemo(() => {
    void mutation
    const byDate = new Map((termDayDocs || []).map((d) => [d.date, d]))
    return days.map((day) => {
      const server = plainRecords(byDate.get(day.date)?.records)
      const pending = pendingRef.current.get(day.date)?.changes
      const records = day.date === selectedDate
        ? displayedRecords
        : (pending ? { ...server, ...pending } : server)
      return { ...day, records }
    })
  }, [days, termDayDocs, selectedDate, displayedRecords, mutation])

  const pendingCount = useMemo(() => {
    void mutation
    let n = 0
    for (const entry of pendingRef.current.values()) n += Object.keys(entry.changes).length
    return n
  }, [mutation])

  // Learners with unsaved changes on the selected day (row-level indicators).
  const pendingLearnerIds = useMemo(() => {
    void mutation
    return new Set(Object.keys(pendingRef.current.get(selectedDate)?.changes || {}))
  }, [mutation, selectedDate])

  return {
    classId,
    // term resolution
    termInfo,
    termId,
    // data
    roster: roster || [],
    rosterLoaded: roster !== null,
    termDoc: termDoc === undefined ? null : termDoc,
    termDocLoaded: termDoc !== undefined,
    termState: termDoc?.state || 'draft',
    days,
    daysWithRecords,
    termDayDocs: termDayDocs || [],
    todayIso,
    hydrated,
    loadError,
    // selection
    selectedDate,
    setSelectedDate,
    selectedDayDoc: selectedDayDoc === undefined ? null : selectedDayDoc,
    displayedRecords,
    // saving
    saveState,
    pendingCount,
    pendingLearnerIds,
    remoteEditNotice,
    dismissRemoteEditNotice: () => setRemoteEditNotice(null),
    // actions
    setStatus,
    setNote,
    setStatusOn,
    markAllPresent,
    undoLast,
    canUndo: undoRef.current.length > 0,
    retry,
    saveNow,
  }
}
