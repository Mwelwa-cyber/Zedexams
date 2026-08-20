/**
 * Behaviour tests for the fraction ladder engine.
 *
 * The rules here are the ones a rendering test would happily pass while the
 * game taught the wrong thing:
 *
 *   Only level 1 opens on a fresh device, and a locked level SAYS WHAT OPENS
 *   IT rather than showing a padlock and nothing else.
 *   The first stage of level 1 is PICTURES — a learner names what they see and
 *   is shown the written form only after they are right.
 *   A shade question is marked on how many pieces, not which.
 *   A wrong answer comes back with the misconception behind it, and the
 *   working is revealed one step at a time and then TAKEN AWAY for a retry.
 *   An equivalent fraction is accepted — 2/4 for 1/2 — with the line that says
 *   how it simplifies, which is the reason it is accepted.
 *   Finishing every stage passes the level and opens the next one; replaying a
 *   stage never pays twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1', displayName: 'Chanda' }, userProfile: { grade: 7 } }),
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
  playCorrect: vi.fn(), playWrong: vi.fn(), playWin: vi.fn(), primeSounds: vi.fn(),
  isMuted: vi.fn(() => false),
  toggleMute: vi.fn(() => true),
}))

import FractionLadderGame from './FractionLadderGame'
import { saveScore } from '../services/gamesService'

const STORE = 'zedexams:fraction-ladder:test_fraction_ladder'

/**
 * A small pack of the same SHAPE as the shipped one, rather than the shipped
 * one itself: these tests are about the engine, and pinning them to real
 * content would make every content edit a spec edit.
 */
const GAME = {
  id: 'test_fraction_ladder',
  title: 'Fraction Ladder',
  type: 'fraction_ladder',
  grade: 7,
  questions: [
    /* level 1, stage 1 — pictures, no written fraction anywhere */
    {
      id: 'p1', level: 'basics', stage: 1, skill: 'name-unit-fraction', type: 'choice',
      stageTitle: 'Cutting things up', stageBlurb: 'A picture first, then the name.',
      prompt: 'What do we call the piece that was taken?',
      caption: 'The orange is cut into 4 equal pieces. One piece is taken.',
      visual: { shape: 'circle', object: 'orange', parts: 4, numerator: 1, shaded: 1 },
      options: [{ id: 'half', label: 'One half' }, { id: 'quarter', label: 'One quarter' }],
      answer: 'quarter',
      explanation: '4 equal pieces, and you take 1. We say one quarter.',
      reveal: { n: 1, d: 4 },
      misconceptions: [{ answer: 'half', code: 'wrong_piece_count', explanation: 'A half is when there are only 2 pieces.' }],
    },
    {
      id: 'p2', level: 'basics', stage: 1, skill: 'shade-a-fraction', type: 'shade',
      prompt: 'Shade one half of this bun.',
      caption: 'Tap the pieces to shade them.',
      visual: { shape: 'bar', object: 'bun', parts: 4 },
      want: 2,
      explanation: 'The bun has 4 pieces. Half means the same amount on each side, so 2 pieces.',
      reveal: { n: 2, d: 4, also: { n: 1, d: 2 } },
      misconceptions: [{ answer: '1', code: 'wrong_piece_count', explanation: 'One piece out of 4 is a quarter, not a half.' }],
    },
    /* level 1, stage 2 — a written answer, with working behind it */
    {
      id: 'p3', level: 'basics', stage: 2, skill: 'write-a-fraction', type: 'write',
      stageTitle: 'Writing them down', stageBlurb: 'Now you write it.',
      prompt: 'Half of a bun. Write it.',
      answer: '1/2', value: { n: 1, d: 2 },
      explanation: 'Two equal pieces, one taken.',
      workingSteps: [
        { title: 'How many pieces altogether?', math: 'The bottom is 2' },
        { title: 'How many are taken?', math: 'The top is 1' },
      ],
      misconceptions: [{ answer: '2/1', code: 'inverted', explanation: 'That is two wholes. The bottom holds how many pieces the bun was cut into.' }],
    },
    {
      id: 'p4', level: 'basics', stage: 2, skill: 'write-a-fraction', type: 'write',
      prompt: 'Three quarters. Write it.',
      answer: '3/4', value: { n: 3, d: 4 },
      explanation: 'Four equal pieces, three taken.',
    },
    /* level 2 */
    {
      id: 'p5', level: 'equal', stage: 1, skill: 'simplify', type: 'write',
      stageTitle: 'Making them simpler', stageBlurb: 'The smallest numbers that will do it.',
      prompt: 'Write 6/8 in its lowest terms.',
      answer: '3/4', value: { n: 3, d: 4 }, form: 'lowest',
      explanation: '6 and 8 both divide by 2.',
    },
    {
      id: 'p6', level: 'equal', stage: 1, skill: 'simplify', type: 'write',
      prompt: 'Write 10/25 in its lowest terms.',
      answer: '2/5', value: { n: 2, d: 5 }, form: 'lowest',
      explanation: '10 and 25 both divide by 5.',
    },
  ],
}

const draw = () => render(<MemoryRouter><FractionLadderGame game={GAME} /></MemoryRouter>)
const key = (label) => screen.getByRole('button', { name: label })

/** Open a level and start one of its stages. */
function openStage(levelLabel, stageLabel) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${levelLabel}`) }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${stageLabel}`) }))
  fireEvent.click(screen.getByRole('button', { name: /^Start/ }))
}

/** Type a fraction on the keypad the way a learner does, then check. */
function type(num, den) {
  fireEvent.click(screen.getByRole('button', { name: /^Top number/ }))
  for (const digit of String(num)) fireEvent.click(key(digit))
  fireEvent.click(screen.getByRole('button', { name: /^Bottom number/ }))
  for (const digit of String(den)) fireEvent.click(key(digit))
  fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /Next question|Finish the stage/ }))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('the ladder', () => {
  it('opens with only level 1 playable, and says what opens the rest', () => {
    draw()
    expect(screen.getByRole('button', { name: /^Level 1: What a fraction is/ })).not.toBeDisabled()
    expect(screen.getByRole('button', {
      name: /^Level 3: Which one is bigger\?, locked — opens after Level 2 — Equal fractions & simplifying/,
    })).toBeDisabled()
    // Level 9 names ALL of its prerequisites, earliest first, so the lock
    // points at the next thing to do rather than the furthest.
    expect(screen.getByRole('button', {
      name: /^Level 9: Fractions in real life, locked — opens after Level 4 — Adding fractions,.*and Level 8 — Fractions, decimals & percentages$/,
    })).toBeInTheDocument()
  })

  it('a level with no questions in the pack says so instead of opening on nothing', () => {
    // Levels 1 and 2 already passed on this device, so level 3 is OPEN — and
    // this pack has no level 3 questions. An open level that opens on nothing
    // is the failure; it must say so and stay shut.
    window.localStorage.setItem(STORE, JSON.stringify(['basics', 'equal']))
    draw()
    expect(screen.getByRole('button', {
      name: /^Level 3: Which one is bigger\?, no questions in this pack yet/,
    })).toBeDisabled()
  })

  it('a learner who climbed levels on the OLD stored shape keeps them', () => {
    window.localStorage.setItem(STORE, JSON.stringify(['basics']))
    draw()
    expect(screen.getByRole('button', { name: /^Level 1: What a fraction is, passed/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Level 2: Equal fractions & simplifying/ })).not.toBeDisabled()
  })

  it('a level shows its stages, and only the first is next', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: /^Level 1: What a fraction is/ }))
    expect(screen.getByRole('button', { name: /^Stage 1: Cutting things up.*Not played yet/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Stage 2: Writing them down.*Not played yet/ })).toBeInTheDocument()
    expect(screen.getByText('0 of 2 stages done')).toBeInTheDocument()
  })
})

describe('level 1 teaches with pictures before the symbol', () => {
  it('the first stage shows a real partition and no written fraction', () => {
    draw()
    openStage('Level 1', 'Stage 1')
    // The picture is exact: four equal wedges, one shaded, and its accessible
    // name says so in words rather than leaving a screen reader with an SVG.
    expect(screen.getByRole('img', { name: /orange in 4 equal pieces, 1 shaded — one quarter/ })).toBeInTheDocument()
    // Nothing on the screen is a written fraction yet.
    expect(screen.queryByRole('math')).toBeNull()
    expect(screen.getByText('What do we call the piece that was taken?')).toBeInTheDocument()
  })

  it('a correct answer is where the written form is introduced', () => {
    draw()
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One quarter/ }))
    expect(screen.getByText(/We say one quarter/)).toBeInTheDocument()
    // …and NOW the symbol appears, read aloud as words rather than "one four".
    expect(screen.getByRole('math', { name: 'one quarter' })).toBeInTheDocument()
  })

  it('a naming round shows the picture BEFORE it asks — see it, then name it', () => {
    const { container } = draw()
    openStage('Level 1', 'Stage 1')
    const card = container.querySelector('.lhx-fl-card')
    const order = [...card.children].map((el) => el.className)
    expect(order.indexOf('lhx-fv is-md is-circle')).toBeLessThan(order.indexOf('lhx-fl-q'))
  })

  it('a "do one yourself" round asks FIRST — an instruction under the thing is read second', () => {
    const { container } = draw()
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One quarter/ }))
    next()
    const card = container.querySelector('.lhx-fl-card')
    const order = [...card.children].map((el) => el.className)
    expect(order.indexOf('lhx-fl-q')).toBeLessThan(order.indexOf('lhx-fv is-md is-bar'))
  })

  it('the learner\'s own shading is still on the screen while they are told about it', () => {
    draw()
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One quarter/ }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Piece 3 of 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Piece 4 of 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
    // Not the pack's shading (which is none) — the two pieces the learner tapped.
    expect(screen.getByRole('img', { name: /bun in 4 equal pieces, 2 shaded — two quarters/ })).toBeInTheDocument()
  })

  it('a wrong answer is answered by name, not by a red cross', () => {
    draw()
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One half/ }))
    expect(screen.getByText(/only 2 pieces/)).toBeInTheDocument()
  })

  it('shading is marked on HOW MANY pieces, not which', () => {
    draw()
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One quarter/ }))
    next()

    // Two pieces from the RIGHT-hand end is still one half.
    fireEvent.click(screen.getByRole('button', { name: 'Piece 3 of 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Piece 4 of 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
    expect(screen.getByText(/same amount on each side/)).toBeInTheDocument()
    // Two quarters and one half, side by side — the equivalence made visible.
    expect(screen.getByRole('math', { name: 'two quarters' })).toBeInTheDocument()
    expect(screen.getByRole('math', { name: 'one half' })).toBeInTheDocument()
  })

  it('shading the wrong number names what went wrong', () => {
    draw()
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One quarter/ }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Piece 1 of 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
    expect(screen.getByText(/a quarter, not a half/)).toBeInTheDocument()
  })

  it('a tapped region can be untapped, and nothing can be checked while empty', () => {
    draw()
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One quarter/ }))
    next()
    expect(screen.getByRole('button', { name: 'Check my answer' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Piece 1 of 4' }))
    expect(screen.getByRole('button', { name: 'Check my answer' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Piece 1 of 4' }))
    expect(screen.getByRole('button', { name: 'Check my answer' })).toBeDisabled()
  })
})

describe('a written answer', () => {
  it('accepts an equivalent fraction and says how it simplifies', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(2, 4)
    expect(screen.getByText("That's right")).toBeInTheDocument()
    expect(screen.getByText(/simplifies to one half/)).toBeInTheDocument()
  })

  it('refuses an equivalent only where the question asks for lowest terms', () => {
    window.localStorage.setItem(STORE, JSON.stringify(['basics']))
    draw()
    openStage('Level 2', 'Stage 1')
    type(6, 8)
    expect(screen.getByText('Right amount, wrong form')).toBeInTheDocument()
    expect(screen.getByText(/asks for lowest terms/)).toBeInTheDocument()
  })

  it('a wrong answer comes back with the misconception behind it', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(2, 1)
    expect(screen.getByText(/The bottom holds how many pieces/)).toBeInTheDocument()
  })

  it('an empty pad cannot be checked at all', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    expect(screen.getByRole('button', { name: 'Check my answer' })).toBeDisabled()
  })

  it('delete steps back to the box before it once the current one is empty', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    fireEvent.click(screen.getByRole('button', { name: /^Bottom number/ }))
    fireEvent.click(key('4'))
    expect(screen.getByRole('button', { name: 'Bottom number, 4' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Bottom number, empty' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // Focus has stepped back to the top box, so the next digit lands there.
    fireEvent.click(key('1'))
    expect(screen.getByRole('button', { name: 'Top number, 1' })).toBeInTheDocument()
  })
})

describe('the working, and the retry that follows it', () => {
  it('reveals one step at a time and then hands the question back with no help', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(2, 1)

    fireEvent.click(screen.getByRole('button', { name: /Show me the working/ }))
    // Nothing is revealed until the learner asks for it — a solution dropped
    // whole is read as a paragraph and skimmed.
    expect(screen.queryByText('How many pieces altogether?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show step 1' }))
    // Step 1 only. Step 2's content is not on the page yet — not dimmed, absent.
    expect(screen.getByText('How many pieces altogether?')).toBeInTheDocument()
    expect(screen.queryByText('How many are taken?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show step 2' }))
    expect(screen.getByText('How many are taken?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Now you try it again/ }))
    expect(screen.getByText('Your turn — no help this time.')).toBeInTheDocument()
    // Everything is gone: the steps, the feedback, the answer.
    expect(screen.queryByText('How many pieces altogether?')).toBeNull()
    expect(screen.queryByText(/The bottom holds how many pieces/)).toBeNull()
  })

  it('getting it right in the retry says so, and marks it for a later return', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(2, 1)
    fireEvent.click(screen.getByRole('button', { name: /Show me the working/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Show step 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show step 2' }))
    fireEvent.click(screen.getByRole('button', { name: /Now you try it again/ }))
    type(1, 2)
    expect(screen.getByText(/goes on your practice list/)).toBeInTheDocument()
  })

  it('the help can be declined without the miss being undone', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(2, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Skip — I see it' }))
    expect(screen.getByRole('button', { name: /Next question/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show me the working/ })).toBeNull()
    // The miss is on the record: the ladder offers it back.
    next()
    type(3, 4)
    fireEvent.click(screen.getByRole('button', { name: /Finish the stage/ }))
    fireEvent.click(screen.getByRole('button', { name: /BACK TO THE STAGES/ }))
    fireEvent.click(screen.getByRole('button', { name: /Back to the levels/ }))
    expect(screen.getByText(/1 thing to come back to/)).toBeInTheDocument()
  })

  it('a question with no working offers none, rather than an invented one', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(1, 2)
    next()
    // p4 carries no workingSteps.
    type(9, 9)
    expect(screen.queryByRole('button', { name: /Show me the working/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'I see it' })).toBeInTheDocument()
  })
})

describe('stages, stars and the level pass', () => {
  it('finishing a stage scores it once and records the stars', async () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(1, 2)
    next()
    type(3, 4)
    fireEvent.click(screen.getByRole('button', { name: /Finish the stage/ }))

    expect(screen.getByLabelText('3 of 3 stars')).toBeInTheDocument()
    expect(screen.getByText('2 of 2 right first time')).toBeInTheDocument()
    // `finish` is async — the score write is a promise, not a render.
    await vi.waitFor(() => expect(saveScore).toHaveBeenCalledTimes(1))
    expect(saveScore.mock.calls[0][0].correct).toBe(2)
    expect(window.localStorage.getItem(STORE)).toContain('basics:2')
  })

  it('a stage that went badly earns fewer stars, and still counts as played', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(2, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Skip — I see it' }))
    next()
    type(9, 9)
    fireEvent.click(screen.getByRole('button', { name: 'I see it' }))
    fireEvent.click(screen.getByRole('button', { name: /Finish the stage/ }))
    expect(screen.getByLabelText('0 of 3 stars')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /BACK TO THE STAGES/ }))
    expect(screen.getByRole('button', { name: /^Stage 2: Writing them down.*Done, 0 of 3 stars/ })).toBeInTheDocument()
  })

  it('every stage done passes the level and opens the next one', () => {
    draw()
    // Stage 1 — the pictures.
    openStage('Level 1', 'Stage 1')
    fireEvent.click(screen.getByRole('button', { name: /One quarter/ }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Piece 1 of 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Piece 2 of 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
    fireEvent.click(screen.getByRole('button', { name: /Finish the stage/ }))
    fireEvent.click(screen.getByRole('button', { name: /BACK TO THE STAGES/ }))
    // The level is not passed on one stage.
    fireEvent.click(screen.getByRole('button', { name: /Back to the levels/ }))
    expect(screen.getByRole('button', { name: /^Level 2: Equal fractions & simplifying, locked/ })).toBeDisabled()

    // Stage 2 — the written ones.
    openStage('Level 1', 'Stage 2')
    type(1, 2)
    next()
    type(3, 4)
    fireEvent.click(screen.getByRole('button', { name: /Finish the stage/ }))
    fireEvent.click(screen.getByRole('button', { name: /BACK TO THE STAGES/ }))
    fireEvent.click(screen.getByRole('button', { name: /Back to the levels/ }))

    expect(screen.getByRole('button', { name: /^Level 1: What a fraction is, passed/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Level 2: Equal fractions & simplifying/ })).not.toBeDisabled()
  })

  it('replaying a stage can raise its stars and never pays twice', () => {
    // A stage played badly, then played perfectly.
    window.localStorage.setItem(STORE, JSON.stringify({
      version: 2, stars: { 'basics:2': 1 }, pool: {}, resume: null,
    }))
    draw()
    openStage('Level 1', 'Stage 2')
    type(1, 2)
    next()
    type(3, 4)
    fireEvent.click(screen.getByRole('button', { name: /Finish the stage/ }))
    fireEvent.click(screen.getByRole('button', { name: /BACK TO THE STAGES/ }))
    expect(screen.getByRole('button', { name: /^Stage 2: Writing them down.*Done, 3 of 3 stars/ })).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem(STORE))
    expect(Object.keys(stored.stars)).toEqual(['basics:2'])
  })
})

describe('leaving and coming back', () => {
  it('a stage left part way is offered back, with the answers already given', () => {
    draw()
    openStage('Level 1', 'Stage 2')
    type(1, 2)
    next()
    // The learner walks away here. A reload re-mounts the engine from storage.
    screen.unmount?.()
    const stored = JSON.parse(window.localStorage.getItem(STORE))
    expect(stored.resume.answered).toHaveLength(1)
    expect(stored.resume.stageNumber).toBe(2)
  })

  it('resuming picks up at the next question rather than the first', () => {
    window.localStorage.setItem(STORE, JSON.stringify({
      version: 2,
      stars: {},
      pool: {},
      resume: {
        levelId: 'basics', stageNumber: 2, index: 1, score: 20, session: 's',
        answered: [{ id: 'p3', correct: true, firstTry: true }],
      },
    }))
    draw()
    fireEvent.click(screen.getByRole('button', { name: /Carry on where you stopped/ }))
    // Question 2 of 2 — the first is not replayed and is not paid for again.
    expect(screen.getByText(/Question 2 of 2/)).toBeInTheDocument()
    expect(screen.getByText('Three quarters. Write it.')).toBeInTheDocument()
  })

  it('a snapshot for a stage already finished is not offered', () => {
    window.localStorage.setItem(STORE, JSON.stringify({
      version: 2,
      stars: { 'basics:2': 3 },
      pool: {},
      resume: {
        levelId: 'basics', stageNumber: 2, index: 1, score: 20, session: 's',
        answered: [{ id: 'p3', correct: true, firstTry: true }],
      },
    }))
    draw()
    expect(screen.queryByRole('button', { name: /Carry on where you stopped/ })).toBeNull()
  })
})

describe('the review list', () => {
  it('names the skill and the mistake that keeps coming back', () => {
    window.localStorage.setItem(STORE, JSON.stringify({
      version: 2,
      stars: {},
      resume: null,
      pool: {
        'write-a-fraction': { correct: 0, sessions: [], misses: 2, recoveries: 0, dueAt: 2, codes: { inverted: 2 } },
      },
    }))
    draw()
    fireEvent.click(screen.getByRole('button', { name: /things to come back to|thing to come back to/ }))
    const list = screen.getByText('Write a fraction').closest('li')
    expect(within(list).getByText(/wrote the top and bottom the other way round/i)).toBeInTheDocument()
  })

  it('is not offered at all when nothing is waiting', () => {
    draw()
    expect(screen.queryByText(/to come back to/)).toBeNull()
  })
})
