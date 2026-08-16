import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useGenerationGate is the client pre-flight in front of every studio's
// Generate button. It reads caps through useTeacherUsage + TOOL_TO_FEATURE,
// so a tool key missing from TOOL_TO_FEATURE silently resolves to cap 0 and
// paywalls teachers whose plan actually funds the tool — that exact bug
// shipped for the (now retired) full_lesson studio. This spec runs the REAL useTeacherUsage +
// teacherPlans catalogue (only firebase/auth/paywall are mocked) so every
// studio tool key is exercised end-to-end against the live plan limits.

const onSnapshot = vi.fn()
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, path) => ({ path }),
  onSnapshot: (...args) => onSnapshot(...args),
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../engines/payment-engine/paywall', () => ({ paywall: { show: vi.fn() } }))

import { useAuth } from '../contexts/AuthContext'
import { paywall } from '../engines/payment-engine/paywall'
import { useGenerationGate } from './useGenerationGate.js'

// Every tool key a live studio actually passes to ensureCanGenerate —
// grep-verified against src/components/teacher. A new studio's key belongs
// here the day it ships.
const STUDIO_TOOL_KEYS = [
  'lesson_plan',
  'worksheet',
  'flashcards',
  'notes',
  'homework',
  'rubric',
  'scheme_of_work',
  'assessment',
  'exam_paper',
  'sba_task',
]

// Today's UTC day key, matching useTeacherUsage's yyyymmdd().
function todayKey(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

let nextCb
beforeEach(() => {
  onSnapshot.mockReset()
  paywall.show.mockClear()
  nextCb = null
  onSnapshot.mockImplementation((_ref, onNext) => {
    nextCb = onNext
    return vi.fn()
  })
})

const snap = (data) => ({ exists: () => data !== null, data: () => data })

function mountGate(profile, meterDoc) {
  useAuth.mockReturnValue({ userProfile: profile })
  const rendered = renderHook(() => useGenerationGate('t1'))
  if (meterDoc !== undefined) act(() => nextCb(snap(meterDoc)))
  return rendered
}

describe('useGenerationGate', () => {
  it.each(['pro', 'max'])(
    'lets a fresh %s teacher generate on every studio tool — no false paywall',
    (plan) => {
      const { result } = mountGate({ teacherPlan: plan }, { counters: {} })
      for (const tool of STUDIO_TOOL_KEYS) {
        expect(result.current.ensureCanGenerate(tool), `${plan}/${tool}`).toBe(true)
      }
      expect(paywall.show).not.toHaveBeenCalled()
    }
  )

  it('shows feature-locked for a Free teacher on a 0-cap studio', () => {
    // Notes stays a 0-cap studio on Free (worksheets gained a free-preview
    // allowance in the dashboard redesign, so they no longer lock here).
    const { result } = mountGate({ teacherPlan: 'free' }, { counters: {} })
    expect(result.current.ensureCanGenerate('notes')).toBe(false)
    expect(paywall.show).toHaveBeenCalledWith(
      'feature-locked',
      expect.objectContaining({ feature: 'Teacher notes', tool: 'notes' })
    )
  })

  it('lets a Free teacher through a preview-funded studio under its cap', () => {
    const { result } = mountGate({ teacherPlan: 'free' }, { counters: {} })
    expect(result.current.ensureCanGenerate('worksheet')).toBe(true)
    expect(result.current.ensureCanGenerate('assessment')).toBe(true)
    expect(paywall.show).not.toHaveBeenCalled()
  })

  it('shows monthly-limit when a Pro teacher exhausts a funded studio', () => {
    const { result } = mountGate(
      { teacherPlan: 'pro' },
      { counters: { worksheet: 25 } } // pro worksheet cap
    )
    expect(result.current.ensureCanGenerate('worksheet')).toBe(false)
    expect(paywall.show).toHaveBeenCalledWith(
      'monthly-limit',
      expect.objectContaining({ feature: 'worksheets', tool: 'worksheet' })
    )
  })

  it('routes a Pro teacher who exhausted the Exam Paper taster to the Max paywall', () => {
    // Exam Paper stays the Max-anchor (MAX_ONLY_TOOLS): Pro's single taster
    // spent → the Max-feature paywall, not the generic monthly-limit copy.
    const { result } = mountGate(
      { teacherPlan: 'pro' },
      { counters: { exam_paper: 1 } } // pro exam-paper taster spent
    )
    expect(result.current.ensureCanGenerate('exam_paper')).toBe(false)
    expect(paywall.show).toHaveBeenCalledWith(
      'max-feature',
      expect.objectContaining({ feature: 'Exam papers', tool: 'exam_paper' })
    )
  })

  it('routes a Pro teacher who used all 3 Test Papers to the monthly-limit paywall', () => {
    // Test Papers are an allowance-based entitlement now (not Max-only), so
    // exhausting the Pro allowance shows the ordinary monthly-limit paywall.
    const { result } = mountGate(
      { teacherPlan: 'pro' },
      { counters: { assessment: 3 } } // pro complete-paper allowance spent
    )
    expect(result.current.ensureCanGenerate('assessment')).toBe(false)
    expect(paywall.show).toHaveBeenCalledWith(
      'monthly-limit',
      expect.objectContaining({ feature: 'test papers', tool: 'assessment' })
    )
  })

  it('shows plain monthly-limit for a Max teacher at the assessment cap', () => {
    const { result } = mountGate(
      { teacherPlan: 'max' },
      { counters: { assessment: 200 } }
    )
    expect(result.current.ensureCanGenerate('assessment')).toBe(false)
    expect(paywall.show).toHaveBeenCalledWith(
      'monthly-limit',
      expect.objectContaining({ feature: 'test papers' })
    )
  })

  it('shows daily-cap when the rolling daily total is exhausted', () => {
    const { result } = mountGate(
      { teacherPlan: 'pro' },
      { counters: {}, daily: { date: todayKey(), count: 10 } } // pro daily cap
    )
    expect(result.current.ensureCanGenerate('worksheet')).toBe(false)
    expect(paywall.show).toHaveBeenCalledWith(
      'daily-cap',
      expect.objectContaining({ feature: 'worksheets', tool: 'worksheet' })
    )
  })

  it('lets a purchased top-up credit through any block, no paywall', () => {
    const { result } = mountGate(
      { teacherPlan: 'pro', generationCredits: 1 },
      { counters: { worksheet: 25 } }
    )
    expect(result.current.ensureCanGenerate('worksheet')).toBe(true)
    expect(paywall.show).not.toHaveBeenCalled()
  })

  it('falls through to the server gate while the meter has not loaded', () => {
    const { result } = mountGate({ teacherPlan: 'free' }) // no snapshot driven
    expect(result.current.ensureCanGenerate('worksheet')).toBe(true)
    expect(paywall.show).not.toHaveBeenCalled()
  })

  it('never meters admins', () => {
    const { result } = mountGate({ role: 'admin' }, { counters: { worksheet: 999 } })
    for (const tool of STUDIO_TOOL_KEYS) {
      expect(result.current.ensureCanGenerate(tool)).toBe(true)
    }
    expect(paywall.show).not.toHaveBeenCalled()
  })
})
