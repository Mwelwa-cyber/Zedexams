import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../contexts/AuthContext'
import { isSuperAdmin } from '../utils/permissions'
import { msUntilDailyReset } from '../utils/usageReset'
import {
  PLAN_LIMITS,
  PLAN_LABELS,
  DAILY_LIMITS,
  resolveTeacherPlan,
} from '../engines/payment-engine/teacherPlans'

// Maps live server tool keys (functions/teacherTools/teacherPlans.js PLAN_LIMITS)
// onto the dashboard-widget feature keys. Each feature row in UsageMeter.jsx
// reads the counter for the tool mapped here, so this MUST use the exact tool
// id each studio increments — e.g. the Test Paper studio writes `assessment`
// (not `quiz`, which is the retired quiz creator), and the Exam studio writes
// `exam_paper`. Keep this 1:1 with UsageMeter's FEATURES list.
export const TOOL_TO_FEATURE = {
  lesson_plan:    'plans',
  worksheet:      'worksheets',
  flashcards:     'flashcards',
  notes:          'notes',
  homework:       'homework',
  rubric:         'rubric',
  scheme_of_work: 'schemes',
  assessment:     'assessments',
  exam_paper:     'exams',
  sba_task:       'sba',
}

// Feature key → human label, shared by the paywall copy in useGenerationGate
// and the UsageMeter banners. Single source of truth: this map used to be
// hand-copied in both files, and a tool missing from TOOL_TO_FEATURE above
// once shipped a studio that paywalled paying teachers (the retired
// full_lesson studio) — keep these two maps together and 1:1.
export const FEATURE_LABELS = {
  plans: 'lesson plans',
  worksheets: 'worksheets',
  flashcards: 'flashcards',
  notes: 'teacher notes',
  homework: 'homework',
  rubric: 'rubrics',
  assessments: 'test papers',
  exams: 'exam papers',
  schemes: 'schemes of work',
  sba: 'SBA tasks',
}

// High finite cap stands in for "unlimited" so the meter widget's
// percentage math and "<used> of <cap>" rendering still work. The
// widget renders the max-tier as "<used> used" (no cap shown), so the
// number itself is never visible to the user.
const ADMIN_UNLIMITED_CAP = 99999
const ADMIN_DAILY_CAP = 99999

function yyyymm(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}${m}`
}

// UTC day key — must match functions/teacherTools/usageMeter.js yyyymmdd()
// so the rolling daily counter the server writes resolves to "today" here.
function yyyymmdd(d = new Date()) {
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyymm(d)}${day}`
}

// Server writes daily as {date, count}; a stale date (or a legacy doc with
// no daily field at all) means nothing has been generated today.
function todayCount(meterData) {
  const daily = meterData?.daily
  if (!daily || daily.date !== yyyymmdd()) return 0
  return Number(daily.count || 0)
}

function daysUntilMonthReset(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return Math.max(1, Math.ceil((next - now) / (1000 * 60 * 60 * 24)))
}

// The usageMeters doc carries `plan` + `limits`, but those are only a
// snapshot from the teacher's last generation — a mid-month upgrade leaves
// them stale ("Free" with free caps) until the next generate call rewrites
// them. So the plan, label, caps and daily cap are resolved from the LIVE
// profile entitlement (`livePlan`, the same field the server gates on); the
// meter doc is used only for the actual usage counters. This keeps the
// widget consistent with the "Current plan" banner instead of showing Free
// options to someone who already paid for Pro.
function project(meterData, livePlan, credits = 0) {
  const plan = PLAN_LIMITS[livePlan] ? livePlan : 'free'
  const counters = meterData?.counters || {}
  const planLimits = PLAN_LIMITS[plan]

  const used = {}
  const caps = {}
  for (const [tool, feature] of Object.entries(TOOL_TO_FEATURE)) {
    used[feature] = Number(counters[tool] || 0)
    caps[feature] = Number(planLimits[tool] ?? 0)
  }

  return {
    plan,
    planLabel: PLAN_LABELS[plan] || 'Free',
    used,
    caps,
    // Purchased pay-per-generation top-ups (users/{uid}.generationCredits).
    // Each covers one extra generation on any tool once a cap is hit.
    credits: Math.max(0, Number(credits || 0)),
    daily: DAILY_LIMITS[plan] || DAILY_LIMITS.free,
    today: todayCount(meterData),
    resetDays: daysUntilMonthReset(),
  }
}

// Super admins bypass the usage meter entirely: every tool is unlocked,
// no limits, no "Free" chip, no Upgrade CTA. The meter doc may still
// exist (so admins can see what they've actually generated), but we
// substitute admin-tier caps so the widget never paints "X of Y" or the
// locked "Not on Free — unlock" rows.
function projectAdmin(meterData) {
  const counters = meterData?.counters || {}
  const used = {}
  const caps = {}
  for (const [tool, feature] of Object.entries(TOOL_TO_FEATURE)) {
    used[feature] = Number(counters[tool] || 0)
    caps[feature] = ADMIN_UNLIMITED_CAP
  }
  return {
    plan: 'max',
    planLabel: 'Admin',
    used,
    caps,
    credits: 0,
    daily: ADMIN_DAILY_CAP,
    today: todayCount(meterData),
    resetDays: daysUntilMonthReset(),
  }
}

export function useTeacherUsage(uid) {
  const { userProfile } = useAuth()
  const isAdmin = isSuperAdmin(userProfile)
  const livePlan = resolveTeacherPlan(userProfile)
  // Live top-up balance from the profile (AuthContext subscribes to the user
  // doc), so a credit bought from the paywall unblocks the next generate
  // without a reload.
  const credits = Math.max(0, Number(userProfile?.generationCredits || 0))
  const [state, setState] = useState({ loading: true, data: null, error: null })
  // Latest raw meter snapshot, kept so the projection can be recomputed
  // WITHOUT a new Firestore read when the UTC day rolls over or the app
  // resumes from the background — todayCount() compares against the current
  // day key, so a stale "today" self-corrects on re-projection.
  const rawRef = useRef(null)
  const hasSnapshotRef = useRef(false)

  useEffect(() => {
    if (!uid) {
      setState({ loading: false, data: null, error: null })
      return
    }
    const projectNow = () =>
      isAdmin ? projectAdmin(rawRef.current) : project(rawRef.current, livePlan, credits)

    const ref = doc(db, `usageMeters/${uid}/periods/${yyyymm()}`)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        rawRef.current = snap.exists() ? snap.data() : null
        hasSnapshotRef.current = true
        setState({ loading: false, data: projectNow(), error: null })
      },
      (error) => setState({ loading: false, data: null, error })
    )

    // Re-project just after the daily reset boundary so "today" flips back
    // to 0 without waiting for the next write, re-arming for each new day.
    let boundaryTimer
    const armBoundary = () => {
      boundaryTimer = setTimeout(() => {
        if (hasSnapshotRef.current) setState({ loading: false, data: projectNow(), error: null })
        armBoundary()
      }, msUntilDailyReset() + 1000)
    }
    armBoundary()

    // App resume (tab refocus / Capacitor foreground): the clock may have
    // crossed the boundary while backgrounded — re-project from the cache.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && hasSnapshotRef.current) {
        setState({ loading: false, data: projectNow(), error: null })
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      unsub()
      clearTimeout(boundaryTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [uid, isAdmin, livePlan, credits])

  return state
}
