import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../../../firebase/config'

export const STUDY_PLAN_PROGRESS_COLLECTION = 'studyPlanProgress'
export const MAX_COMPLETED_TASK_KEYS = 20

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function toLocalDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return toLocalDateKey(new Date())
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function addDays(date, offset) {
  const d = date instanceof Date ? new Date(date) : new Date(date)
  d.setDate(d.getDate() + offset)
  return d
}

export function toWeekKey(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date)
  if (Number.isNaN(d.getTime())) return toWeekKey(new Date())

  const localMidday = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  const day = localMidday.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return toLocalDateKey(addDays(localMidday, mondayOffset))
}

export function previousDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number)
  if (!year || !month || !day) return null
  return toLocalDateKey(addDays(new Date(year, month - 1, day, 12), -1))
}

export function normaliseCompletedTaskKeys(keys = [], validKeys = null) {
  const allowed = validKeys ? new Set(validKeys) : null
  const out = []
  const seen = new Set()

  for (const value of Array.isArray(keys) ? keys : []) {
    if (typeof value !== 'string') continue
    const key = value.trim().slice(0, 96)
    if (!key || seen.has(key)) continue
    if (allowed && !allowed.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= MAX_COMPLETED_TASK_KEYS) break
  }

  return out
}

function boundedInt(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.trunc(number), 0), 100000)
}

function cleanDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

export function normaliseStudyPlanProgress(data = {}, userId, options = {}) {
  const dateKey = options.dateKey || toLocalDateKey(options.date)
  const weekKey = options.weekKey || toWeekKey(options.date)
  const sameWeek = data.weekKey === weekKey
  const planStreak = boundedInt(data.planStreak)
  const longestPlanStreak = boundedInt(data.longestPlanStreak, planStreak)

  return {
    userId,
    dateKey,
    weekKey,
    completedTaskKeys: sameWeek
      ? normaliseCompletedTaskKeys(data.completedTaskKeys, options.validKeys)
      : [],
    planStreak,
    longestPlanStreak: Math.max(longestPlanStreak, planStreak),
    lastCompletedDate: cleanDateKey(data.lastCompletedDate),
  }
}

export function awardPlanStreak(progress, dateKey = toLocalDateKey()) {
  const current = normaliseStudyPlanProgress(progress, progress.userId, {
    dateKey,
    weekKey: progress.weekKey || toWeekKey(),
  })

  if (current.lastCompletedDate === dateKey) {
    return {
      ...current,
      planStreak: Math.max(current.planStreak, 1),
      longestPlanStreak: Math.max(current.longestPlanStreak, current.planStreak, 1),
    }
  }

  const yesterday = previousDateKey(dateKey)
  const nextStreak = current.lastCompletedDate === yesterday
    ? Math.max(current.planStreak, 0) + 1
    : 1

  return {
    ...current,
    planStreak: nextStreak,
    longestPlanStreak: Math.max(current.longestPlanStreak, nextStreak),
    lastCompletedDate: dateKey,
  }
}

export async function getStudyPlanProgress(userId, options = {}) {
  if (!userId) return normaliseStudyPlanProgress({}, '', options)
  const snap = await getDoc(doc(db, STUDY_PLAN_PROGRESS_COLLECTION, userId))
  return normaliseStudyPlanProgress(snap.exists() ? snap.data() : {}, userId, options)
}

export async function saveStudyPlanProgress(userId, progress, validKeys = null) {
  if (!userId) throw new Error('Cannot save study plan progress without a user id')

  const payload = {
    userId,
    dateKey: progress.dateKey || toLocalDateKey(),
    weekKey: progress.weekKey || toWeekKey(),
    completedTaskKeys: normaliseCompletedTaskKeys(progress.completedTaskKeys, validKeys),
    planStreak: boundedInt(progress.planStreak),
    longestPlanStreak: boundedInt(progress.longestPlanStreak, progress.planStreak),
    lastCompletedDate: cleanDateKey(progress.lastCompletedDate),
    updatedAt: serverTimestamp(),
  }

  await setDoc(doc(db, STUDY_PLAN_PROGRESS_COLLECTION, userId), payload)
  return payload
}
