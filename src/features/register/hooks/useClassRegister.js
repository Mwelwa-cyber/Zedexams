/**
 * useClassRegister — state engine for the Class Register Studio.
 *
 * Owns, for one class + resolved term:
 *   - realtime subscriptions: roster, term settings doc, every saved
 *     attendance day in the term, and the currently selected day;
 *   - an OUTBOX of pending attendance operations: optimistic marking with a
 *     per-date queue persisted to localStorage, debounced submission to the
 *     authoritative saveClassAttendance callable, per-entry sync states
 *     (queued → syncing → synced | conflict | rejected), retry/discard, and
 *     undo. An invalid write can never look "saved": server rejections stay
 *     visible with their reason and the teacher's changes intact;
 *   - concurrency: the server rejects stale versions (STALE_VERSION); the
 *     outbox rebases on the latest doc, auto-resubmits non-conflicting rows,
 *     and surfaces genuinely conflicting learners for an explicit
 *     keep-mine / keep-theirs decision — never a silent overwrite;
 *   - guards: nothing submits before the initial snapshots hydrate, and no
 *     effect depends on an unstable object it also writes (queues live in
 *     refs; renders are triggered by a monotonic counter).
 *
 * The hook never does attendance mathematics — views call
 * attendanceCalculator with the day list this hook exposes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeRoster } from '../../../utils/classRoster'
import {
  getAttendanceDay,
  normalizeAttendanceError,
  submitAttendanceDay,
  subscribeAttendanceDay,
  subscribeAttendanceTerm,
  subscribeTermAttendance,
} from '../services/attendanceService'
import { plainRecords, buildMarkAllPresent, mergeDayRecords, sanitizeNote } from '../lib/attendanceDayCore'
import {
  buildTermDays,
  customTermInfo,
  defaultRegisterDate,
  localTodayIso,
  resolveTermInfo,
  termNumberFromLabel,
} from '../../../utils/attendanceCalendarResolver'

const AUTOSAVE_DELAY_MS = 900
const OUTBOX_PREFIX = 'zedexams:attendanceOutbox:'

function loadOutbox(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw)
    const map = new Map()
    for (const [date, entry] of Object.entries(parsed || {})) {
      if (!entry || typeof entry !== 'object' || !entry.changes) continue
      map.set(date, {
        baseVersion: Number.isInteger(entry.baseVersion) ? entry.baseVersion : 0,
        base: entry.base && typeof entry.base === 'object' ? entry.base : {},
        changes: entry.changes,
        reason: typeof entry.reason === 'string' ? entry.reason : '',
        state: 'queued', // every restored op re-validates against the server
        code: null,
        conflictLearnerIds: [],
      })
    }
    return map
  } catch {
    return new Map()
  }
}

function persistOutbox(storageKey, queue) {
  try {
    if (!queue.size) {
      localStorage.removeItem(storageKey)
      return
    }
    const plain = {}
    for (const [date, entry] of queue) {
      plain[date] = {
        baseVersion: entry.baseVersion,
        base: entry.base,
        changes: entry.changes,
        reason: entry.reason || '',
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(plain))
  } catch {
    // storage full/blocked — ops still live in memory for this session
  }
}

function sameRecord(a, b) {
  return (a?.status || null) === (b?.status || null) && sanitizeNote(a?.note) === sanitizeNote(b?.note)
}

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
  const isEceClass = ['baby', 'middle', 'reception'].includes(register?.grade)
  const days = useMemo(() => {
    if (!termInfo) return []
    const loadedTermDoc = termDoc !== undefined ? termDoc : null
    const breakConfig = loadedTermDoc?.midTermBreak || { mode: 'none' }
    const closures = []
    if (breakConfig.mode === 'custom' && breakConfig.customBreakStart && breakConfig.customBreakEnd) {
      closures.push({ start: breakConfig.customBreakStart, end: breakConfig.customBreakEnd, label: 'Mid-term break' })
    } else if (
      (breakConfig.mode === 'general' || (breakConfig.mode === 'ece' && isEceClass)) &&
      termInfo.eceMidBreak
    ) {
      closures.push({
        ...termInfo.eceMidBreak,
        label: breakConfig.mode === 'ece'
          ? 'ECE mid-term break — attendance not required'
          : 'Mid-term break — attendance not required',
      })
    }
    return buildTermDays({
      termInfo,
      dayOverrides: loadedTermDoc?.dayOverrides || {},
      closures,
      todayIso,
    })
  }, [termInfo, termDoc, todayIso, isEceClass])

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

  // ── the outbox (refs — never effect dependencies) ──────────────
  // Map<date, { baseVersion, base, changes, reason, state, code, conflictLearnerIds }>
  //   state: 'queued' | 'syncing' | 'rejected' | 'conflict'
  const outboxRef = useRef(new Map())
  const undoRef = useRef([])
  const timerRef = useRef(null)
  const flushingRef = useRef(false)
  const [mutation, setMutation] = useState(0) // monotonic render trigger
  const [remoteEditNotice, setRemoteEditNotice] = useState(null)

  const storageKey = uid && classId && termId ? `${OUTBOX_PREFIX}${uid}:${classId}:${termId}` : null
  const persist = useCallback(() => {
    if (storageKey) persistOutbox(storageKey, outboxRef.current)
  }, [storageKey])

  // Restore pending offline work from a previous session — every restored op
  // is re-validated by the server on submit, so a term locked in the
  // meantime rejects it (visibly) rather than letting it slip through.
  const restoredRef = useRef(null)
  useEffect(() => {
    if (!storageKey || restoredRef.current === storageKey) return
    restoredRef.current = storageKey
    const restored = loadOutbox(storageKey)
    if (restored.size) {
      outboxRef.current = restored
      setMutation((m) => m + 1)
    } else {
      outboxRef.current = new Map()
    }
  }, [storageKey])

  // Server records for any date, from the live term subscription (the selected
  // day also has its own doc subscription, which is fresher during typing).
  const serverRecordsFor = useCallback((date) => {
    if (date === selectedDate && selectedDayDoc !== undefined) {
      return plainRecords(selectedDayDoc?.records)
    }
    const dayDoc = (termDayDocs || []).find((d) => d.date === date)
    return plainRecords(dayDoc?.records)
  }, [selectedDate, selectedDayDoc, termDayDocs])

  const serverVersionFor = useCallback((date) => {
    if (date === selectedDate && selectedDayDoc !== undefined) {
      return Number(selectedDayDoc?.version) || 0
    }
    const dayDoc = (termDayDocs || []).find((d) => d.date === date)
    return Number(dayDoc?.version) || 0
  }, [selectedDate, selectedDayDoc, termDayDocs])

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

  // ── submit pipeline ────────────────────────────────────────────
  const submitEntry = useCallback(async (date, entry) => {
    const submitted = { ...entry.changes }
    entry.state = 'syncing'
    setMutation((m) => m + 1)
    try {
      const result = await submitAttendanceDay({
        classId,
        date,
        termId,
        baseVersion: entry.baseVersion,
        records: submitted,
        reason: entry.reason || '',
      })
      // Edits made while the request was in flight stay queued for the next
      // round; everything submitted is now synced.
      const leftover = {}
      for (const [learnerId, record] of Object.entries(entry.changes)) {
        if (!sameRecord(record, submitted[learnerId])) leftover[learnerId] = record
      }
      if (Object.keys(leftover).length) {
        outboxRef.current.set(date, {
          baseVersion: result.version,
          base: { ...entry.base, ...submitted },
          changes: leftover,
          reason: entry.reason || '',
          state: 'queued',
          code: null,
          conflictLearnerIds: [],
        })
        return { status: 'partial' }
      }
      outboxRef.current.delete(date)
      return { status: 'synced' }
    } catch (err) {
      const { code, offline } = normalizeAttendanceError(err)
      if (offline) {
        entry.state = 'queued' // stays in the outbox; the 'online' event retries
        return { status: 'offline' }
      }
      if (code === 'STALE_VERSION') {
        // Someone else saved first. Rebase on the latest server copy: rows
        // only they touched are theirs; rows only we touched auto-resubmit;
        // rows BOTH sides changed become an explicit conflict decision.
        // Re-look-up the live entry after the await — edits made while the
        // fetch was in flight land in the same object, and mutating the
        // fresh reference keeps the update atomic w.r.t. the outbox map.
        let latest = null
        try {
          latest = await getAttendanceDay(classId, date)
        } catch {
          const live = outboxRef.current.get(date)
          if (live) live.state = 'queued'
          return { status: 'offline' }
        }
        const live = outboxRef.current.get(date)
        if (!live) return { status: 'synced' }
        const latestPlain = plainRecords(latest?.records)
        const { conflicts } = mergeDayRecords({ base: live.base, server: latestPlain, local: live.changes })
        const stillDiffering = {}
        for (const [learnerId, record] of Object.entries(live.changes)) {
          if (!sameRecord(record, latestPlain[learnerId])) stillDiffering[learnerId] = record
        }
        live.baseVersion = Number(latest?.version) || 0
        live.base = latestPlain
        live.changes = stillDiffering
        if (!Object.keys(stillDiffering).length) {
          outboxRef.current.delete(date) // they already wrote what we wanted
          return { status: 'synced' }
        }
        const realConflicts = conflicts.filter((id) => stillDiffering[id])
        if (realConflicts.length) {
          live.state = 'conflict'
          live.code = 'STALE_VERSION'
          live.conflictLearnerIds = realConflicts
          return { status: 'conflict', learnerIds: realConflicts }
        }
        live.state = 'queued'
        return { status: 'rebased' } // non-conflicting rows retry immediately
      }
      entry.state = 'rejected'
      entry.code = code
      return { status: 'rejected', code }
    }
  }, [classId, termId])

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    if (!classId || !termId || !uid) return
    flushingRef.current = true
    try {
      let rounds = 0
      // A rebase after STALE_VERSION retries once within the same flush.
      let retry = true
      while (retry && rounds < 3) {
        retry = false
        rounds += 1
        for (const [date, entry] of [...outboxRef.current.entries()]) {
          if (entry.state !== 'queued') continue
          const outcome = await submitEntry(date, entry)
          if (outcome.status === 'rebased' || outcome.status === 'partial') retry = true
          if (outcome.status === 'conflict' && typeof onConflict === 'function') {
            onConflict({ date, learnerIds: outcome.learnerIds })
          }
          if (outcome.status === 'offline') { retry = false; break }
        }
      }
    } finally {
      flushingRef.current = false
      persist()
      setMutation((m) => m + 1)
    }
  }, [classId, termId, uid, submitEntry, onConflict, persist])

  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flushRef.current()
    }, AUTOSAVE_DELAY_MS)
  }, [])

  // Reconnect → drain the outbox; warn before closing with unsynced work.
  useEffect(() => {
    const onOnline = () => flushRef.current()
    const onBeforeUnload = (e) => {
      if (outboxRef.current.size || flushingRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (outboxRef.current.size) flushRef.current()
    }
  }, [])

  // ── mutations ──────────────────────────────────────────────────
  const hydrated = roster !== null && selectedDayDoc !== undefined && termDoc !== undefined

  // Latest displayed records for the selected day (server + pending overlay),
  // kept in a ref so mutation callbacks read fresh state without re-creating.
  const displayedRecordsRef = useRef({})

  const mutate = useCallback((date, learnerId, record, { correctionReason = '' } = {}) => {
    if (!hydrated) return // never mutate before stored data has loaded
    const queue = outboxRef.current
    if (!queue.has(date)) {
      queue.set(date, {
        baseVersion: serverVersionFor(date),
        base: serverRecordsFor(date),
        changes: {},
        reason: '',
        state: 'queued',
        code: null,
        conflictLearnerIds: [],
      })
    }
    const entry = queue.get(date)
    const prev = entry.changes[learnerId] || entry.base[learnerId] || null
    undoRef.current.push({ date, learnerId, prev })
    if (undoRef.current.length > 100) undoRef.current.shift()
    entry.changes[learnerId] = { status: record.status, note: sanitizeNote(record.note ?? prev?.note ?? '') }
    if (correctionReason) entry.reason = sanitizeNote(correctionReason)
    // A fresh edit un-rejects the entry — it re-validates on next submit.
    if (entry.state === 'rejected') { entry.state = 'queued'; entry.code = null }
    persist()
    setMutation((m) => m + 1)
    scheduleSave()
  }, [hydrated, serverRecordsFor, serverVersionFor, scheduleSave, persist])

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
    const base = outboxRef.current.get(date)
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
    const queue = outboxRef.current
    if (!queue.has(last.date)) {
      queue.set(last.date, {
        baseVersion: serverVersionFor(last.date),
        base: serverRecordsFor(last.date),
        changes: {},
        reason: '',
        state: 'queued',
        code: null,
        conflictLearnerIds: [],
      })
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
    persist()
    setMutation((m) => m + 1)
    if (queue.size) scheduleSave()
    return last
  }, [serverRecordsFor, serverVersionFor, scheduleSave, persist])

  // ── conflict / rejection handling ──────────────────────────────
  /**
   * Resolve a conflicted date: 'mine' resubmits the teacher's rows over the
   * rebased server copy; 'theirs' keeps the other editor's rows (drops only
   * the conflicting local changes, keeps the rest queued).
   */
  const resolveConflict = useCallback((date, choice) => {
    const entry = outboxRef.current.get(date)
    if (!entry || entry.state !== 'conflict') return
    if (choice === 'theirs') {
      for (const learnerId of entry.conflictLearnerIds) delete entry.changes[learnerId]
      if (!Object.keys(entry.changes).length) outboxRef.current.delete(date)
    }
    if (outboxRef.current.has(date)) {
      entry.state = 'queued'
      entry.code = null
      entry.conflictLearnerIds = []
    }
    persist()
    setMutation((m) => m + 1)
    flushRef.current()
  }, [persist])

  /** Retry a rejected date (e.g. after an admin reopened the term). */
  const retryRejected = useCallback((date) => {
    const entry = outboxRef.current.get(date)
    if (!entry) return
    entry.state = 'queued'
    entry.code = null
    persist()
    setMutation((m) => m + 1)
    flushRef.current()
  }, [persist])

  /** Discard a rejected date's local changes (explicit teacher action). */
  const discardRejected = useCallback((date) => {
    outboxRef.current.delete(date)
    persist()
    setMutation((m) => m + 1)
  }, [persist])

  const retry = useCallback(() => {
    for (const entry of outboxRef.current.values()) {
      if (entry.state === 'rejected') { entry.state = 'queued'; entry.code = null }
    }
    flushRef.current()
  }, [])
  const saveNow = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    return flushRef.current()
  }, [])

  // ── derived views ──────────────────────────────────────────────
  // Displayed records for the selected day = server state + pending overlay.
  const displayedRecords = useMemo(() => {
    void mutation // outbox changed
    const server = selectedDayDoc === undefined ? {} : plainRecords(selectedDayDoc?.records)
    const pending = outboxRef.current.get(selectedDate)?.changes || {}
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
      const pending = outboxRef.current.get(day.date)?.changes
      const records = day.date === selectedDate
        ? displayedRecords
        : (pending ? { ...server, ...pending } : server)
      return { ...day, records }
    })
  }, [days, termDayDocs, selectedDate, displayedRecords, mutation])

  const pendingCount = useMemo(() => {
    void mutation
    let n = 0
    for (const entry of outboxRef.current.values()) n += Object.keys(entry.changes).length
    return n
  }, [mutation])

  // Learners with unsaved changes on the selected day (row-level indicators).
  const pendingLearnerIds = useMemo(() => {
    void mutation
    return new Set(Object.keys(outboxRef.current.get(selectedDate)?.changes || {}))
  }, [mutation, selectedDate])

  // Per-date sync issues for the UI (conflicts + server rejections).
  const syncIssues = useMemo(() => {
    void mutation
    const issues = []
    for (const [date, entry] of outboxRef.current.entries()) {
      if (entry.state === 'conflict') {
        issues.push({ date, kind: 'conflict', code: entry.code, learnerIds: entry.conflictLearnerIds })
      } else if (entry.state === 'rejected') {
        issues.push({ date, kind: 'rejected', code: entry.code, learnerIds: Object.keys(entry.changes) })
      }
    }
    return issues.sort((a, b) => (a.date < b.date ? -1 : 1))
  }, [mutation])

  // Overall save state: rejected/conflict outrank offline/queued/syncing.
  const saveState = useMemo(() => {
    void mutation
    const entries = [...outboxRef.current.values()]
    if (!entries.length) return flushingRef.current ? 'saving' : 'saved'
    if (entries.some((e) => e.state === 'rejected')) return 'rejected'
    if (entries.some((e) => e.state === 'conflict')) return 'conflict'
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
    if (entries.some((e) => e.state === 'syncing')) return 'saving'
    return 'dirty'
  }, [mutation])

  return {
    classId,
    // term resolution
    termInfo,
    termId,
    isEceClass,
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
    syncIssues,
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
    resolveConflict,
    retryRejected,
    discardRejected,
  }
}
