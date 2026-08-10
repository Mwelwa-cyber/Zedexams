/**
 * useControlCenterData — live platform vitals for the Control Center
 * (/admin/settings).
 *
 * Every read soft-fails to null so a missing collection or a rules change
 * can never blank the settings page — cards render an em-dash instead.
 * One shot on mount + a manual refresh handle; the settings page doesn't
 * need to poll.
 */

import { useCallback, useEffect, useState } from 'react'
import { collection, getCountFromServer, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { getDayUsage, isAnomalous, listDailyUsage } from '../../../utils/aiCosts'

const EMPTY = {
  users: null,
  learners: null,
  teachers: null,
  admins: null,
  pendingPayments: null,
  agentQueue: null,
  pendingContent: null,
  aiTodayUsd: null,
  aiMonthUsd: null,
  aiAnomalous: false,
  health: null, // Marshal rollup: { healthy, summary, checkedAt }
  audit: [], // latest adminAuditLogs rows
}

async function countOf(...constraints) {
  try {
    const snap = await getCountFromServer(query(...constraints))
    return snap.data().count
  } catch {
    return null
  }
}

async function loadAiSpend() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const [todayDoc, days] = await Promise.all([
      getDayUsage(today).catch(() => null),
      listDailyUsage({ days: 30 }).catch(() => []),
    ])
    const monthUsd = days.reduce((sum, d) => sum + (Number(d.totalCostUsd) || 0), 0)
    return {
      aiTodayUsd: Number(todayDoc?.totalCostUsd) || 0,
      aiMonthUsd: monthUsd,
      aiAnomalous: isAnomalous(todayDoc, days),
    }
  } catch {
    return { aiTodayUsd: null, aiMonthUsd: null, aiAnomalous: false }
  }
}

async function loadHealth() {
  try {
    const snap = await getDocs(query(
      collection(db, 'agentJobs'),
      where('agentId', '==', 'marshal'),
      orderBy('createdAt', 'desc'),
      fsLimit(1),
    ))
    const job = snap.docs[0]?.data()
    return job?.output?.marshal || null
  } catch {
    return null
  }
}

async function loadAudit() {
  try {
    const snap = await getDocs(query(collection(db, 'adminAuditLogs'), orderBy('createdAt', 'desc'), fsLimit(8)))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch {
    return []
  }
}

export default function useControlCenterData() {
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const users = collection(db, 'users')
    const [
      totalUsers, learners, teachers, admins,
      pendingPayments, agentQueue, pendingQuizzes, pendingLessons,
      ai, health, audit,
    ] = await Promise.all([
      countOf(users),
      countOf(users, where('role', '==', 'learner')),
      countOf(users, where('role', '==', 'teacher')),
      countOf(users, where('role', 'in', ['admin', 'superAdmin'])),
      countOf(collection(db, 'payments'), where('status', '==', 'pending')),
      countOf(collection(db, 'agentJobs'), where('status', '==', 'awaiting_approval')),
      countOf(collection(db, 'quizzes'), where('status', '==', 'pending')),
      countOf(collection(db, 'lessons'), where('status', '==', 'pending')),
      loadAiSpend(),
      loadHealth(),
      loadAudit(),
    ])
    setData({
      users: totalUsers,
      learners,
      teachers,
      admins,
      pendingPayments,
      agentQueue,
      pendingContent: pendingQuizzes == null && pendingLessons == null
        ? null
        : (pendingQuizzes || 0) + (pendingLessons || 0),
      ...ai,
      health,
      audit,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    refresh().catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  return { data, loading, refresh }
}
