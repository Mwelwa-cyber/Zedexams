import { useEffect, useMemo, useState } from 'react'
import { useFirestore } from './useFirestore'
import { listMyGenerations } from '../utils/teacherLibraryService'
import { buildReminders, SEEN_REMINDERS_KEY } from '../utils/teacherReminders'

/**
 * The brain behind the teacher reminder bell (TeacherTopBar; it also served
 * the mobile TeacherGlassHeader until Phase 6 deleted that dead V1 header).
 * Loads the teacher's generations + quizzes,
 * builds the personalised reminders, and tracks which have been seen
 * (localStorage, per uid). While `open` is true every visible reminder is
 * marked seen — opening the tray clears the badge, the behaviour both bells
 * previously implemented as ~150 duplicated lines each.
 */
export default function useTeacherReminders(currentUser, { open = false } = {}) {
  const { getMyQuizzes } = useFirestore()

  const [generations, setGenerations] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [seenReminderIds, setSeenReminderIds] = useState(() => new Set())

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    Promise.all([
      listMyGenerations({ uid: currentUser.uid }).catch(() => []),
      getMyQuizzes(currentUser.uid).catch(() => []),
    ])
      .then(([g, q]) => {
        if (cancelled) return
        setGenerations(g || [])
        setQuizzes(q || [])
      })
      .catch((err) => console.error('useTeacherReminders load:', err))
    return () => { cancelled = true }
  }, [currentUser, getMyQuizzes])

  const reminders = useMemo(
    () => buildReminders({ generations, quizzes }),
    [generations, quizzes],
  )

  useEffect(() => {
    if (!currentUser) {
      setSeenReminderIds(new Set())
      return
    }
    try {
      const raw = localStorage.getItem(SEEN_REMINDERS_KEY(currentUser.uid))
      setSeenReminderIds(raw ? new Set(JSON.parse(raw)) : new Set())
    } catch {
      setSeenReminderIds(new Set())
    }
  }, [currentUser])

  useEffect(() => {
    if (!open || !currentUser || reminders.length === 0) return
    let changed = false
    const next = new Set(seenReminderIds)
    for (const r of reminders) {
      if (!next.has(r.id)) { next.add(r.id); changed = true }
    }
    if (!changed) return
    setSeenReminderIds(next)
    try {
      localStorage.setItem(SEEN_REMINDERS_KEY(currentUser.uid), JSON.stringify([...next]))
    } catch { /* localStorage unavailable; badge resets on refresh */ }
  }, [open, reminders, currentUser, seenReminderIds])

  const unreadCount = reminders.reduce(
    (n, r) => (seenReminderIds.has(r.id) ? n : n + 1),
    0,
  )

  return { reminders, unreadCount }
}
