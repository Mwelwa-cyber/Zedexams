import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../contexts/AuthContext'
import { isSuperAdmin } from '../utils/permissions'

// Maps live tool keys (functions/teacherTools/usageMeter.js) onto the
// dashboard-widget feature keys.
const TOOL_TO_FEATURE = {
  lesson_plan:    'plans',
  worksheet:      'worksheets',
  notes:          'notes',
  quiz:           'assessments',
  scheme_of_work: 'schemes',
}

// Live plan id → display label / chip variant the widget understands.
// The live model still uses free / individual / school; the widget renders
// using the new free / pro / max vocabulary. Treat individual + school
// as Pro until the plan model is unified.
const PLAN_VIEW = {
  free:       { id: 'free', label: 'Free', daily: 2 },
  individual: { id: 'pro',  label: 'Pro',  daily: 10 },
  school:     { id: 'pro',  label: 'Pro',  daily: 10 },
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

function daysUntilMonthReset(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return Math.max(1, Math.ceil((next - now) / (1000 * 60 * 60 * 24)))
}

function project(meterData) {
  if (!meterData) return null
  const planView = PLAN_VIEW[meterData.plan] || PLAN_VIEW.free
  const counters = meterData.counters || {}
  const limits = meterData.limits || {}

  const used = {}
  const caps = {}
  for (const [tool, feature] of Object.entries(TOOL_TO_FEATURE)) {
    used[feature] = Number(counters[tool] || 0)
    caps[feature] = Number(limits[tool] ?? 0)
  }

  return {
    plan: planView.id,
    planLabel: planView.label,
    used,
    caps,
    daily: planView.daily,
    today: 0,                          // daily counter not yet tracked per-doc
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
    daily: ADMIN_DAILY_CAP,
    today: 0,
    resetDays: daysUntilMonthReset(),
  }
}

export function useTeacherUsage(uid) {
  const { userProfile } = useAuth()
  const isAdmin = isSuperAdmin(userProfile)
  const [state, setState] = useState({ loading: true, data: null, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ loading: false, data: null, error: null })
      return
    }
    const ref = doc(db, `usageMeters/${uid}/periods/${yyyymm()}`)
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const raw = snap.exists() ? snap.data() : null
        const projected = isAdmin ? projectAdmin(raw) : project(raw)
        setState({
          loading: false,
          data: projected || {
            plan: 'free', planLabel: 'Free',
            used: { plans: 0, worksheets: 0, notes: 0, assessments: 0, schemes: 0 },
            caps: { plans: 0, worksheets: 0, notes: 0, assessments: 0, schemes: 0 },
            daily: 2, today: 0, resetDays: daysUntilMonthReset(),
          },
          error: null,
        })
      },
      (error) => setState({ loading: false, data: null, error })
    )
    return unsub
  }, [uid, isAdmin])

  return state
}
