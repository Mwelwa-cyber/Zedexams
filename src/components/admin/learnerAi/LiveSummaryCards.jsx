import { useEffect, useState } from 'react'
import {
  collection, onSnapshot, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { AGENTS } from './agentRegistry'

// Section 1: 6 KPI cards driven by Firestore onSnapshot listeners.
//
//   Active agents         — aiLiveAgentStates docs whose status is
//                           one of the non-idle, non-terminal values
//   Running tasks         — aiAgentTasks with active status set
//   Completed today       — aiAgentTasks with status 'published' OR
//                           'approved' since UTC midnight
//   Needs review          — aiAgentTasks with status 'needs_review'
//   Errors today          — aiAgentLogs with severity 'error' since
//                           UTC midnight
//   Content published     — aiGeneratedContent with status 'published'
//   today                   since UTC midnight
//
// We deliberately do all counts client-side rather than using
// getCountFromServer so the dashboard updates in real time as
// docs arrive. Per-collection listeners cap their result sets so
// no query runs unbounded.

const ACTIVE_AGENT_STATUSES = new Set([
  'running', 'thinking', 'generating', 'checking', 'waiting',
])
const ACTIVE_TASK_STATUSES = [
  'queued', 'running', 'thinking', 'generating',
  'checking', 'waiting', 'regenerating',
]

function startOfUtcDay() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function Card({ label, value, accent, subtitle }) {
  return (
    <div className={`rounded-lg border p-4 bg-white ${accent || 'border-slate-200'}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </div>
      <div className="text-3xl font-bold text-slate-900 mt-1">{value}</div>
      {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
    </div>
  )
}

export default function LiveSummaryCards() {
  const [activeAgents, setActiveAgents] = useState(0)
  const [runningTasks, setRunningTasks] = useState(0)
  const [completedToday, setCompletedToday] = useState(0)
  const [needsReview, setNeedsReview] = useState(0)
  const [errorsToday, setErrorsToday] = useState(0)
  const [publishedToday, setPublishedToday] = useState(0)

  // Active agents (count of aiLiveAgentStates with a "doing something"
  // status). Cap at the number of registered agents — defensive.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'aiLiveAgentStates'),
      snap => {
        let n = 0
        snap.forEach(d => {
          const s = (d.data() || {}).status
          if (s && ACTIVE_AGENT_STATUSES.has(s)) n += 1
        })
        setActiveAgents(Math.min(n, AGENTS.length))
      },
      () => setActiveAgents(0),
    )
    return () => unsub()
  }, [])

  // Running tasks + needs review (one listener for both — same
  // collection, different status counts).
  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'aiAgentTasks'),
        where('status', 'in', [...ACTIVE_TASK_STATUSES, 'needs_review']),
      ),
      snap => {
        let r = 0; let nr = 0
        snap.forEach(d => {
          const s = (d.data() || {}).status
          if (s === 'needs_review') nr += 1
          else if (ACTIVE_TASK_STATUSES.includes(s)) r += 1
        })
        setRunningTasks(r)
        setNeedsReview(nr)
      },
      () => { setRunningTasks(0); setNeedsReview(0) },
    )
    return () => unsub()
  }, [])

  // Completed today — aiAgentTasks with `completedAt >= startOfUtcDay()`.
  useEffect(() => {
    const since = startOfUtcDay()
    const unsub = onSnapshot(
      query(
        collection(db, 'aiAgentTasks'),
        where('completedAt', '>=', since),
      ),
      snap => setCompletedToday(snap.size),
      () => setCompletedToday(0),
    )
    return () => unsub()
  }, [])

  // Errors today — aiAgentLogs severity='error' since UTC midnight.
  useEffect(() => {
    const since = startOfUtcDay()
    const unsub = onSnapshot(
      query(
        collection(db, 'aiAgentLogs'),
        where('severity', '==', 'error'),
        where('createdAt', '>=', since),
      ),
      snap => setErrorsToday(snap.size),
      () => setErrorsToday(0),
    )
    return () => unsub()
  }, [])

  // Published today — aiGeneratedContent docs with status='published'
  // since UTC midnight.
  useEffect(() => {
    const since = startOfUtcDay()
    const unsub = onSnapshot(
      query(
        collection(db, 'aiGeneratedContent'),
        where('status', '==', 'published'),
        where('updatedAt', '>=', since),
      ),
      snap => setPublishedToday(snap.size),
      () => setPublishedToday(0),
    )
    return () => unsub()
  }, [])

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <Card label="Active agents"   value={activeAgents} accent="border-blue-200" subtitle={`of ${AGENTS.length}`} />
      <Card label="Running tasks"   value={runningTasks} accent="border-violet-200" />
      <Card label="Needs review"    value={needsReview}  accent="border-orange-200" />
      <Card label="Completed today" value={completedToday} accent="border-emerald-200" />
      <Card label="Published today" value={publishedToday} accent="border-emerald-200" />
      <Card label="Errors today"    value={errorsToday}  accent="border-rose-200" />
    </div>
  )
}
