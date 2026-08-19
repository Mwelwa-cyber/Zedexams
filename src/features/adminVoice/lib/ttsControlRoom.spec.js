import { describe, it, expect, vi } from 'vitest'

// firebase/config and the callable layer are mocked so the pure summary logic
// can be exercised without an SDK. summariseTtsDay is the only thing here with
// real arithmetic in it, and every way it can be wrong is quiet.
vi.mock('../../../firebase/config', () => ({ default: {} }))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => vi.fn(),
}))
vi.mock('../../../utils/aiCosts', () => ({ listToolsForDate: vi.fn() }))

import { summariseTtsDay, TTS_TOOL, TTS_CACHE_TOOL } from './ttsControlRoom.js'

const paid = (o) => ({ tool: TTS_TOOL, callCount: 0, characters: 0, costUsd: 0, ...o })
const hit = (o) => ({ tool: TTS_CACHE_TOOL, callCount: 0, characters: 0, costUsd: 0, ...o })

describe('summariseTtsDay', () => {
  it('reports nothing rather than zero when the day is empty', () => {
    const s = summariseTtsDay([])
    expect(s.totalCalls).toBe(0)
    // A hit rate of 0% would claim the cache is failing; there were no requests.
    expect(s.hitRate).toBeNull()
    expect(s.savedUsd).toBeNull()
  })

  it('splits paid synthesis from cache hits', () => {
    const s = summariseTtsDay([
      paid({ callCount: 4, characters: 4000, costUsd: 0.064 }),
      hit({ callCount: 6, characters: 6000 }),
    ])
    expect(s.paidCalls).toBe(4)
    expect(s.cachedCalls).toBe(6)
    expect(s.totalCalls).toBe(10)
    expect(s.hitRate).toBeCloseTo(0.6, 10)
    expect(s.costUsd).toBeCloseTo(0.064, 10)
  })

  it('prices the saving from the rate actually paid that day', () => {
    // 4000 chars cost $0.064 → $16/M (Neural2). 6000 cached chars would have
    // cost $0.096. The saving is derived, because nothing was spent to record.
    const s = summariseTtsDay([
      paid({ callCount: 4, characters: 4000, costUsd: 0.064 }),
      hit({ callCount: 6, characters: 6000 }),
    ])
    expect(s.savedUsd).toBeCloseTo(0.096, 10)
  })

  it('still prices the saving on a day served ENTIRELY from cache', () => {
    // The best possible day, and the one where a naive implementation reports
    // "saved $0.00" because there is no paid row to infer a rate from.
    const s = summariseTtsDay([hit({ callCount: 20, characters: 10_000 })], { usdPerMchar: 150 })
    expect(s.hitRate).toBe(1)
    expect(s.savedUsd).toBeCloseTo(1.5, 10)
  })

  it('reports an unknown saving as unknown, never as zero', () => {
    // No paid row to infer from and no configured rate: we genuinely cannot
    // say. "$0.00 saved" would be a claim we have no basis for.
    const s = summariseTtsDay([hit({ callCount: 20, characters: 10_000 })])
    expect(s.savedUsd).toBeNull()
    expect(s.cachedChars).toBe(10_000)
  })

  it('prefers the paid rate over a configured one when both exist', () => {
    // The rate actually charged is evidence; the configured rate is a setting
    // that may be stale.
    const s = summariseTtsDay(
      [paid({ callCount: 1, characters: 1000, costUsd: 0.004 }), hit({ characters: 1000, callCount: 1 })],
      { usdPerMchar: 150 },
    )
    expect(s.savedUsd).toBeCloseTo(0.004, 10)
  })

  it('ignores unrelated tool rows', () => {
    const s = summariseTtsDay([
      { tool: 'generateQuiz', callCount: 99, characters: 0, costUsd: 5 },
      paid({ callCount: 1, characters: 100, costUsd: 0.0016 }),
    ])
    expect(s.totalCalls).toBe(1)
    expect(s.costUsd).toBeCloseTo(0.0016, 10)
  })
})
