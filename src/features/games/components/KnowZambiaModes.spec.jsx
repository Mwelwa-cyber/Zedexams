/**
 * Behaviour tests for the five map modes that are not place-the-province.
 *
 * The pure rules — which provinces touch, whether an odd-one-out set is true
 * of the data, whether a route is a road — are checked against the real
 * dataset in scripts/test-know-zambia.mjs, and deliberately not repeated here.
 * What this file tests is the part only a rendered component can be wrong
 * about:
 *
 *   THE DIMMED PROVINCES ARE INERT BY CONSTRUCTION. Odd one out lights four
 *   and dims six, and the six carry no role, no tabIndex and no click target
 *   — so a stray tap, the Tab key and a screen reader all agree with the
 *   picture. Filtering them in the handler instead would leave them focusable
 *   and announced while looking unavailable.
 *
 *   THE FOUR JOURNEY ANSWERS REACH THE SCREEN. The core can return four
 *   distinct verdicts and the component can still render one generic line.
 *
 *   TWO OF THE THREE CEREMONY QUESTIONS ARE OFF THE MAP. That is the rule
 *   about a learner who only ever taps a map, and it is a rendering decision.
 *
 *   THE ROUND ENDS BY FINISHING THE WORK. No mode is timed, and each saves
 *   through the same shared plumbing as every other mechanic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1', displayName: 'Chanda' } }),
}))
vi.mock('../services/gamesService', () => ({
  saveScore: vi.fn(async () => ({ ok: true, id: 'score-1' })),
  reportGameStart: vi.fn(),
  readRoundBaseline: vi.fn(async () => ({})),
  readRoundOutcome: vi.fn(async () => ({ levelChange: null, personalBest: null })),
}))
vi.mock('../../../utils/gameBadgesService', () => ({
  evaluateAndAwardGameBadges: vi.fn(async () => ({ newlyEarned: [] })),
}))
vi.mock('../../../utils/dailyChallengeService', () => ({
  getTodaysChallenge: vi.fn(async () => ({ game: null })),
  recordDailyPlay: vi.fn(async () => ({ isDaily: false })),
}))
vi.mock('../lib/gameSounds', () => ({
  playCorrect: vi.fn(),
  playWrong: vi.fn(),
  playWin: vi.fn(),
  primeSounds: vi.fn(),
}))

import KnowZambiaGame from './KnowZambiaGame'
import { saveScore } from '../services/gamesService'

const pack = (mode) => ({ id: `social_know_zambia_${mode}_g7`, title: `Zambia: ${mode}`, type: 'map_place', mode, grade: 7, points: 15 })
const draw = (mode) => render(<MemoryRouter><KnowZambiaGame game={pack(mode)} /></MemoryRouter>)
const province = (name) => screen.getByRole('button', { name: new RegExp(`^${name} Province`) })
const shapeFor = (name) => document.querySelector(`path[aria-label^="${name} Province"]`)

beforeEach(() => { vi.clearAllMocks() })

describe('Know Zambia — where’s the capital?', () => {
  it('plots the town from real coordinates and asks for its province', () => {
    draw('capital')
    expect(screen.getByText(/THE CAPITAL OF\?$/i)).toBeInTheDocument()
    expect(document.querySelectorAll('.lhx-kz-pin circle')).toHaveLength(1)
    expect(document.querySelectorAll('path.lhx-kz-prov[role="button"]')).toHaveLength(10)
  })

  it('names what was tapped and gives the hint, rather than only marking it wrong', () => {
    draw('capital')
    // Kabwe is the first capital in the dataset, and it is in Central.
    fireEvent.click(province('Lusaka'))
    expect(screen.getByText(/It is Central/)).toBeInTheDocument()
    expect(screen.getByText(/You tapped Lusaka/)).toBeInTheDocument()
    expect(screen.getByText(/on the road between Lusaka and the Copperbelt/)).toBeInTheDocument()
  })
})

describe('Know Zambia — journey', () => {
  it('opens on the road, naming where it goes and how far', () => {
    draw('journey')
    expect(screen.getByText(/LIVINGSTONE → KASAMA/)).toBeInTheDocument()
    expect(screen.getByText(/Great North Road/)).toBeInTheDocument()
    expect(screen.getByText(/1,300 km/)).toBeInTheDocument()
  })

  it('answers a wrong turn four different ways, each from the map', () => {
    draw('journey')

    // Not where the journey starts.
    fireEvent.click(province('Central'))
    expect(screen.getByText(/That is not where you start/)).toBeInTheDocument()

    fireEvent.click(province('Southern'))
    expect(screen.getByText(/Mosi-oa-Tunya/)).toBeInTheDocument()

    // Touches where you are, but goes the wrong way — and it says so.
    fireEvent.click(province('Western'))
    expect(screen.getByText('Western does touch Southern')).toBeInTheDocument()
    expect(screen.getByText(/heading for Kasama/)).toBeInTheDocument()

    // Does not touch where you are at all — a different lesson, in different words.
    fireEvent.click(province('Northern'))
    expect(screen.getByText('Northern does not touch Southern')).toBeInTheDocument()
    expect(screen.getByText(/without crossing a province in between/)).toBeInTheDocument()

    // Somewhere you have already been.
    fireEvent.click(province('Lusaka'))
    fireEvent.click(province('Southern'))
    expect(screen.getByText(/You have been there/)).toBeInTheDocument()
    expect(screen.getByText(/number 1 on the strip/)).toBeInTheDocument()
  })

  it('numbers each province as it is crossed, so the route reads without colour', () => {
    draw('journey')
    fireEvent.click(province('Southern'))
    fireEvent.click(province('Lusaka'))

    /* The marks are drawn in province order, not route order, so this checks
       WHICH province carries WHICH number rather than the order of the nodes:
       each number sits at its own province's label anchor. */
    const marks = [...document.querySelectorAll('text.lhx-kz-mark.is-step')]
      .map((node) => ({ n: node.textContent, x: Number(node.getAttribute('x')) }))
    expect(marks.map((m) => m.n).sort()).toEqual(['1', '2'])
    const southernMark = marks.find((m) => m.n === '1')
    const lusakaMark = marks.find((m) => m.n === '2')
    // Southern's anchor is west of Lusaka's on the traced map.
    expect(southernMark.x).toBeLessThan(lusakaMark.x)

    // And the strip under the map is what actually shows the learner the order.
    const strip = [...document.querySelectorAll('.lhx-kz-rs.is-on')].map((n) => n.textContent)
    expect(strip).toEqual(['1Southern', '2Lusaka'])
  })
})

describe('Know Zambia — odd one out', () => {
  it('lights four and dims six, and the six are inert in the markup itself', () => {
    draw('odd')
    expect(document.querySelectorAll('.lhx-kz-prov.is-live')).toHaveLength(4)
    const dimmed = [...document.querySelectorAll('.lhx-kz-prov.is-dim')]
    expect(dimmed).toHaveLength(6)
    for (const shape of dimmed) {
      expect(shape.getAttribute('role')).toBeNull()
      expect(shape.getAttribute('tabindex')).toBeNull()
    }
    // No halo for a province the question is not about, either.
    expect(document.querySelectorAll('circle.lhx-kz-halo').length).toBeLessThanOrEqual(4)
  })

  it('a tap on a dimmed province changes nothing', () => {
    draw('odd')
    const before = document.body.textContent
    fireEvent.click(shapeFor('Lusaka'))
    expect(document.body.textContent).toBe(before)
  })

  it('renders the question’s emphasis as text, never as markup', () => {
    draw('odd')
    expect(screen.getByText('DR Congo').tagName).toBe('B')
    expect(document.querySelector('.lhx-kz-ask').innerHTML).not.toMatch(/<script|onerror/i)
  })

  it('explains the answer whichever way it was reached', () => {
    draw('odd')
    fireEvent.click(province('Southern'))
    expect(screen.getByText(/other end of the country/)).toBeInTheDocument()
  })
})

describe('Know Zambia — our neighbours', () => {
  it('asks for a country before it accepts a box', () => {
    draw('neighbours')
    const box = screen.getByRole('button', { name: /^DR Congo, to the/ })
    fireEvent.click(box)
    expect(screen.getByText('Pick a country first')).toBeInTheDocument()
  })

  it('places a country and teaches the fact behind it', () => {
    draw('neighbours')
    fireEvent.click(screen.getByRole('button', { name: /^DR Congo$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^DR Congo, to the/ }))
    expect(screen.getByText(/Congo Pedicle/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^✓\s*DR Congo$/ })).toBeDisabled()
  })

  it('a wrong box names both countries rather than only saying no', () => {
    draw('neighbours')
    fireEvent.click(screen.getByRole('button', { name: /^Botswana$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Zimbabwe, to the/ }))
    expect(screen.getByText(/That box is Zimbabwe’s/)).toBeInTheDocument()
    expect(screen.getByText(/Kazungula/)).toBeInTheDocument()
  })
})

describe('Know Zambia — where’s the ceremony?', () => {
  it('asks where on the map, then whose and when off it', () => {
    vi.useFakeTimers()
    try {
      draw('ceremony')
      expect(screen.getByText(/Where does the/)).toBeInTheDocument()
      expect(document.querySelectorAll('.lhx-kz-opt')).toHaveLength(0)

      fireEvent.click(province('Western'))
      expect(screen.getByText(/Litunga/)).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(2700) })
      expect(screen.getByText(/WHOSE CEREMONY IS IT\?/i)).toBeInTheDocument()
      // Off the map on purpose: a learner who only ever taps a map stops reading.
      expect(document.querySelectorAll('.lhx-kz-opt')).toHaveLength(3)

      fireEvent.click(screen.getByRole('button', { name: /Lozi/ }))
      act(() => { vi.advanceTimersByTime(2700) })
      expect(screen.getByText(/WHEN IS IT HELD\?/i)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('every mode', () => {
  it('ends by finishing the work — not on a clock — and saves the round', async () => {
    vi.useFakeTimers()
    try {
      draw('neighbours')
      const order = ['DR Congo', 'Tanzania', 'Malawi', 'Mozambique', 'Zimbabwe', 'Botswana', 'Namibia', 'Angola']
      for (const name of order) {
        fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}$`) }))
        fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}, to the`) }))
      }
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(screen.getByText(/You know the neighbours!/)).toBeInTheDocument()
      expect(saveScore).toHaveBeenCalledTimes(1)
      const saved = saveScore.mock.calls[0][0]
      expect(saved.correct).toBe(8)
      // 20 × the combo, the same shape every other mechanic pays.
      expect(saved.score).toBe(20 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8))
    } finally {
      vi.useRealTimers()
    }
  })

  it('a pack naming no mode still plays the original place-the-province round', () => {
    render(<MemoryRouter><KnowZambiaGame game={{ id: 'social_know_zambia_g7', type: 'map_place', grade: 7 }} /></MemoryRouter>)
    expect(screen.getByText(/TAP A NAME, THEN TAP WHERE IT GOES/i)).toBeInTheDocument()
  })
})
