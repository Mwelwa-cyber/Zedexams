/**
 * The spelling system, as a learner walks it.
 *
 *   map → stage intro → round → miss → coach → the word returns → results
 *
 * These tests replaced the ones for the old engine, which mounted straight
 * into a round of eight words with nothing above it and wrote its progress to
 * `localStorage`. Both of those changed, so the tests that pinned them had to.
 * What is deliberately kept from the old suite is every REFUSAL it protected:
 * no clock ever ends a round, a half-built word is never cut off, and the
 * score/badge/streak plumbing behind a finished stage is the shared one.
 *
 * `spellingSpeech` is mocked: it reaches /api/tts and a Storage object, and
 * neither exists here. What these tests pin is WHICH audio the round asks for
 * — a pre-generated file when the word has one — not that a sound came out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'learner-1', displayName: 'Chanda' },
    userProfile: { grade: 7 },
  }),
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
  isMuted: vi.fn(() => false), toggleMute: vi.fn(() => true),
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../services/spellingContentService', () => ({ listApprovedWords: vi.fn(async () => []) }))
vi.mock('../lib/spellingSpeech', () => ({
  speakWord: vi.fn(async () => {}),
  speakChunk: vi.fn(async () => {}),
  stopSpeech: vi.fn(),
  // `window.Audio` exists in jsdom, so this is what the real module reports.
  speechAvailable: () => true,
  // The warming pair resolve rather than returning undefined: the stage
  // opener and the coach both chain a second warm off the first, and a double
  // that returns nothing would throw on `.then`.
  warmWord: vi.fn(async () => true),
  warmWords: vi.fn(async () => {}),
  CHUNK_RATE: 0.7,
}))

/**
 * The progress SERVICE is mocked; the progress LOGIC is not. The store below
 * is an in-memory stand-in for `spellingProgress/{uid}` plus its device mirror,
 * so "does a star survive a remount" is a real question these tests can ask —
 * mocking the core instead would have made every persistence assertion a test
 * of the mock.
 */
let store = null
vi.mock('../services/spellingProgressService', () => ({
  loadSpellingProgress: vi.fn(async () => ({
    progress: store || { stars: {}, pool: {}, stagesPlayed: 0, settledRuns: [], resume: null, updatedAtMs: 0 },
    synced: true,
  })),
  saveSpellingProgress: vi.fn(async (_id, progress) => { store = progress; return true }),
}))

import WordBuilderGame from './WordBuilderGame'
import { reportGameStart, saveScore } from '../services/gamesService'
import { saveSpellingProgress } from '../services/spellingProgressService'
import { capture } from '../../../utils/analytics'
import { speakWord } from '../lib/spellingSpeech'

/**
 * Sixteen words in one band — two stages of eight, so the ladder has a
 * "next stage" and a locked one, and a stage can be composed without the
 * short-pack fallback firing.
 */
const WORDS = [
  ['LION', 'The ___ is the king of the jungle.'],
  ['ZEBRA', 'A ___ has black and white stripes.'],
  ['SNAKE', 'A ___ has no legs at all.'],
  ['EAGLE', 'An ___ can see a mouse from far above.'],
  ['TIGER', 'A ___ has orange fur with stripes.'],
  ['HORSE', 'We rode the ___ across the field.'],
  ['MOUSE', 'A small ___ ran under the desk.'],
  ['SHEEP', 'The ___ gave us wool for a jersey.'],
  ['GOOSE', 'A grey ___ landed on the water.'],
  ['CRANE', 'A tall ___ waded in the shallow water.'],
  ['STORK', 'The ___ built a nest on the roof.'],
  ['ROBIN', 'A ___ sang outside the window.'],
  ['FINCH', 'A tiny ___ perched on the fence.'],
  ['HERON', 'The ___ stood very still in the reeds.'],
  ['EGRET', 'A white ___ followed the cattle.'],
  ['SWIFT', 'The ___ flew faster than any other bird.'],
]

const GAME = {
  id: 'english_word_builder_g7',
  title: 'Spelling',
  type: 'word_builder',
  grade: 7,
  subject: 'english',
  questions: WORDS.map(([answer, question]) => ({ answer, question, band: 'animals' })),
}

/** `SEPARATE` carries a full authored cut, so the coach has something to show. */
const COACHED = {
  ...GAME,
  questions: [
    {
      answer: 'SEPARATE',
      question: 'Please ___ the red beans from the white ones.',
      band: 'animals',
      chunks: ['SEP', 'A', 'RATE'],
      trap: 1,
      strategy: 'syllables',
      why: 'Say it in three — sep · a · rate.',
      hook: 'There is <u>a rat</u> in sepa<u>rat</u>e',
      hookNote: 'The middle is an <b>a</b>, not an e.',
      related: ['DESPERATE', 'CELEBRATE'],
    },
    ...GAME.questions.slice(0, 7),
  ],
}

/**
 * The sentence → word lookup for whichever fixture is mounted.
 *
 * The test cannot ask the component what the answer is — that the answer is
 * never on screen is the property under test — so it reads the rendered
 * sentence and matches it back against the fixture it supplied.
 */
let lookup = new Map()

function renderGame(game = GAME) {
  lookup = new Map(game.questions.map((q) => [q.question.split('___').join('· · ·'), q.answer]))
  return render(<MemoryRouter><WordBuilderGame game={game} /></MemoryRouter>)
}

const tiles = () => [...document.querySelectorAll('.lhx-sp-tile')]
const slots = () => [...document.querySelectorAll('.lhx-sp-slot')]

/** The word the round is currently asking for. */
function askedWord() {
  const shown = (document.querySelector('.lhx-sp-sentence')?.textContent || '').trim()
  return lookup.get(shown) || null
}

/** Tap the tiles spelling `word`, first unused match per letter. */
function spell(word) {
  for (const letter of word) {
    const tile = tiles().find((t) => !t.disabled && t.textContent === letter)
    if (tile) fireEvent.click(tile)
  }
}

/** Fill every slot with whatever tiles come to hand — reliably wrong. */
function spellSomethingWrong() {
  const answer = askedWord() || ''
  // Reversing uses only the word's own letters, so every slot fills, and for
  // every fixture word here the reverse is not the word.
  spell([...answer].reverse().join(''))
}

const checkButton = () => screen.queryByRole('button', { name: 'Check' })

/** Map → intro → round. Returns once the first word is on screen. */
async function startFirstStage(game = GAME) {
  renderGame(game)
  await screen.findByText('Spelling')
  fireEvent.click(await screen.findByRole('button', { name: /Stage 1, play now/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Start stage 1/ }))
  await waitFor(() => expect(document.querySelector('.lhx-sp-tiles')).toBeTruthy())
}

/**
 * Walk the stage until `target` is the word being asked, answering everything
 * before it correctly. Used by the coach tests, which need one specific word.
 */
async function advanceTo(target) {
  for (let guard = 0; guard < 12; guard += 1) {
    if (askedWord() === target) return
    const word = askedWord()
    if (!word) return
    spell(word)
    const check = checkButton()
    if (check) fireEvent.click(check)
    await act(async () => { await new Promise((r) => setTimeout(r, 950)) })
  }
}

beforeEach(() => { vi.clearAllMocks(); store = null })
afterEach(() => { vi.useRealTimers() })

describe('Spelling — the ladder', () => {
  it('opens on the stage map, not straight into a round', async () => {
    renderGame()
    expect(reportGameStart).toHaveBeenCalledWith(GAME)
    await screen.findByText('Spelling')
    // Sixteen words in one band is two stages: one to play, one locked.
    expect(await screen.findByRole('button', { name: /Stage 1, play now/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stage 2, locked/ })).toBeDisabled()
    expect(document.querySelector('.lhx-sp-tiles')).toBeNull()
  })

  it('the stage intro says what is coming without showing an answer', async () => {
    renderGame()
    fireEvent.click(await screen.findByRole('button', { name: /Stage 1, play now/ }))
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('Stage 1')
    expect(sheet).toHaveTextContent('words')
    // A first stage draws no returning words, so none are named.
    expect(sheet).not.toHaveTextContent('tricky words are back')
    // And no spelling from the stage is printed on the intro.
    for (const [word] of WORDS) expect(sheet).not.toHaveTextContent(word)
  })

  it('a locked stage cannot be started', async () => {
    renderGame()
    const locked = await screen.findByRole('button', { name: /Stage 2, locked/ })
    fireEvent.click(locked)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Spelling — the round', () => {
  it('shows the sentence with the word hidden, and one slot per letter', async () => {
    await startFirstStage()
    const sentence = document.querySelector('.lhx-sp-sentence')
    expect(sentence).toBeTruthy()
    // The gap is a gap. The answer is never on screen before it is answered.
    expect(sentence.textContent).toContain('· · ·')
    const word = askedWord()
    expect(word).toBeTruthy()
    expect(sentence.textContent).not.toContain(word)
    expect(slots()).toHaveLength(word.length)
    // The Hear it button is offered wherever AUDIO can play — which is
    // everywhere, since the cloud voice and a stored file both go through an
    // <audio> element. It used to be gated on `speechSynthesis`, so a device
    // without a speech engine was shown no button at all despite both of
    // those working perfectly.
    expect(screen.getByRole('button', { name: /Hear it/ })).toBeInTheDocument()
  })

  it('asks for the PRE-GENERATED file when the word has one', async () => {
    const voiced = {
      ...GAME,
      questions: GAME.questions.map((q) => ({ ...q, audio: `https://cdn.test/${q.answer}.mp3` })),
    }
    await startFirstStage(voiced)
    const word = askedWord()
    // The word is spoken shortly AFTER it appears, not on the same tick.
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    // A stored file costs the learner nothing. Falling through to /api/tts
    // would spend one of their 60 daily AI calls on a word an admin has
    // already paid to voice.
    expect(speakWord).toHaveBeenCalledWith(word, { audioUrl: `https://cdn.test/${word}.mp3` })
  })

  it('asks for the live voice when the word has no stored file', async () => {
    await startFirstStage()
    const word = askedWord()
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(speakWord).toHaveBeenCalledWith(word, { audioUrl: '' })
  })

  it('re-hearing a word does not re-ask for a different source', async () => {
    await startFirstStage()
    const word = askedWord()
    speakWord.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Hear it/ }))
    expect(speakWord).toHaveBeenCalledWith(word, { audioUrl: '' })
  })

  it('offers decoy tiles that are never letters the word needs', async () => {
    await startFirstStage()
    const word = askedWord()
    const letters = tiles().map((t) => t.textContent)
    expect(letters.length).toBeGreaterThan(word.length)
    // Every one of the word's own letters is present…
    for (const letter of word) expect(letters).toContain(letter)
    // …and the surplus tiles are letters the word does NOT use, so the word
    // stays spellable. A decoy duplicating a needed letter would make the
    // exercise impossible.
    const surplus = [...letters]
    for (const letter of word) surplus.splice(surplus.indexOf(letter), 1)
    for (const decoy of surplus) expect(word).not.toContain(decoy)
  })

  it('nothing is judged until Check, and Undo and Clear are not answers', async () => {
    await startFirstStage()
    const word = askedWord()
    spell(word)

    // Full slots, still no verdict — the old engine marked this the moment the
    // last letter landed, so a learner who spotted their own mistake had
    // already been marked wrong.
    expect(document.querySelector('.lhx-sp-fb')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    expect(slots().filter((s) => s.textContent).length).toBe(word.length - 1)
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    expect(slots().every((s) => !s.textContent)).toBe(true)
    // Still nothing judged, and no miss recorded.
    expect(document.querySelector('.lhx-sp-fb')).toBeNull()
  })

  it('carries its own mute control — this engine mounts bare', async () => {
    await startFirstStage()
    // The shell's nav is not on the page for a bare-mounted engine, and this
    // round draws its own header instead of GameTopBar's — so without a
    // control here a learner could not silence a round mid-way (#2556).
    const mute = screen.getByRole('button', { name: /Mute game sounds/ })
    expect(mute).toBeInTheDocument()
    fireEvent.click(mute)
    const { toggleMute } = await import('../lib/gameSounds')
    expect(toggleMute).toHaveBeenCalled()
  })

  it('Check is disabled until every slot is filled', async () => {
    await startFirstStage()
    const word = askedWord()
    expect(screen.getByRole('button', { name: /letters$/ })).toBeDisabled()
    spell(word)
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled()
  })

  it('a correct spelling is confirmed and the sentence is completed', async () => {
    await startFirstStage()
    const word = askedWord()
    spell(word)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText(/Correct/)).toBeInTheDocument()
    // NOW the word is shown, filled into its own sentence.
    expect(document.querySelector('.lhx-sp-fb-word').textContent).toBe(word)
  })

  it('a wrong spelling says where it went wrong and never ends the round', async () => {
    await startFirstStage()
    const word = askedWord()
    // Spell it backwards — wrong, but using only real letters of the word.
    spell([...word].reverse().join(''))
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))

    expect(await screen.findByText(/Not quite/)).toBeInTheDocument()
    expect(screen.getByText(/It goes wrong at letter/)).toBeInTheDocument()
    expect(screen.getByText(/comes back later with no help/)).toBeInTheDocument()
    // No lives, no game over, no score penalty on screen.
    expect(screen.queryByText(/game over/i)).toBeNull()
    expect(screen.queryByText(/lives/i)).toBeNull()
  })

  it('no clock ever ends a round — a half-built word is never cut off', async () => {
    vi.useFakeTimers()
    renderGame()
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: /Stage 1, play now/ }))
    fireEvent.click(screen.getByRole('button', { name: /Start stage 1/ }))
    await act(async () => { vi.advanceTimersByTime(500) })

    const before = slots().length
    fireEvent.click(tiles().find((t) => !t.disabled))
    // Five minutes of doing nothing else.
    await act(async () => { vi.advanceTimersByTime(300000) })
    expect(slots()).toHaveLength(before)
    expect(screen.queryByText(/Stage cleared/)).toBeNull()
  })
})

describe('Spelling — the coach', () => {
  it('after a miss the coach is OFFERED, never forced', async () => {
    await startFirstStage(COACHED)
    await advanceTo('SEPARATE')
    // NOT 'SEPERATE': that needs a third E and the tiles carry only the word's
    // own two, so the classic misspelling is literally untappable here. The
    // reverse uses exactly the letters on offer and is just as wrong.
    spellSomethingWrong()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await screen.findByText(/Not quite/)

    expect(screen.getByRole('button', { name: /Let's fix this/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skip/ })).toBeInTheDocument()
  }, 30000)

  it('the cut, the trap, the hook and why it is missed all reach the screen', async () => {
    await startFirstStage(COACHED)
    await advanceTo('SEPARATE')
    // NOT 'SEPERATE': that needs a third E and the tiles carry only the word's
    // own two, so the classic misspelling is literally untappable here. The
    // reverse uses exactly the letters on offer and is just as wrong.
    spellSomethingWrong()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    fireEvent.click(await screen.findByRole('button', { name: /Let's fix this/ }))

    expect(await screen.findByText(/Let's fix this one/)).toBeInTheDocument()
    expect(screen.getByText('Why people get it wrong')).toBeInTheDocument()
    // The trap is marked by a class AND by its accessible name — colour alone
    // would be the whole signal for a learner who cannot see the difference.
    const trap = document.querySelector('.lhx-sp-chunk.is-trap')
    expect(trap).toBeTruthy()
    expect(trap.getAttribute('aria-label')).toMatch(/tricky bit/)
    // The hook renders, with its emphasis intact and nothing executable.
    const hook = document.querySelector('.lhx-sp-hook-line')
    expect(hook.innerHTML).toContain('<u>a rat</u>')
    expect(hook.innerHTML).not.toContain('<script')
  }, 30000)

  it('the rebuild shuffles the chunks and refuses a wrong one without punishing it', async () => {
    await startFirstStage(COACHED)
    await advanceTo('SEPARATE')
    // NOT 'SEPERATE': that needs a third E and the tiles carry only the word's
    // own two, so the classic misspelling is literally untappable here. The
    // reverse uses exactly the letters on offer and is just as wrong.
    spellSomethingWrong()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    fireEvent.click(await screen.findByRole('button', { name: /Let's fix this/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Now you build it/ }))

    const option = (chunk) => screen.getByRole('button', { name: `Place ${chunk}` })
    // Out of order: refused. Nothing is removed and the option stays there.
    fireEvent.click(option('RATE'))
    expect(document.querySelectorAll('.lhx-sp-rslot.is-filled')).toHaveLength(0)
    expect(option('RATE')).toBeEnabled()

    fireEvent.click(option('SEP'))
    expect(document.querySelectorAll('.lhx-sp-rslot.is-filled')).toHaveLength(1)
    // A wrong choice AFTER correct progress keeps the progress.
    fireEvent.click(option('RATE'))
    expect(document.querySelectorAll('.lhx-sp-rslot.is-filled')).toHaveLength(1)
  }, 30000)

  it('finishing the rebuild shows the words the same cut solves', async () => {
    await startFirstStage(COACHED)
    await advanceTo('SEPARATE')
    // NOT 'SEPERATE': that needs a third E and the tiles carry only the word's
    // own two, so the classic misspelling is literally untappable here. The
    // reverse uses exactly the letters on offer and is just as wrong.
    spellSomethingWrong()
    fireEvent.click(checkButton())
    fireEvent.click(await screen.findByRole('button', { name: /Let's fix this/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Now you build it/ }))
    for (const chunk of ['SEP', 'A', 'RATE']) {
      fireEvent.click(screen.getByRole('button', { name: `Place ${chunk}` }))
    }

    expect(await screen.findByText('The same cut works on these')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /DESPERATE/ })).toBeInTheDocument()
  }, 30000)

  it('a word the pack has not broken up gets no coach at all — never a guessed split', async () => {
    await startFirstStage()
    const word = askedWord()
    spell([...word].reverse().join(''))
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await screen.findByText(/Not quite/)

    expect(screen.queryByRole('button', { name: /Let's fix this/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Got it/ })).toBeInTheDocument()
  })

  it('the missed word returns in the same stage with no scaffolding', async () => {
    await startFirstStage(COACHED)
    await advanceTo('SEPARATE')

    // NOT 'SEPERATE': that needs a third E and the tiles carry only the word's
    // own two, so the classic misspelling is literally untappable here. The
    // reverse uses exactly the letters on offer and is just as wrong.
    spellSomethingWrong()
    fireEvent.click(checkButton())
    fireEvent.click(await screen.findByRole('button', { name: /Skip/ }))

    // Walk on, answering everything correctly, until it comes round again.
    let seen = false
    for (let guard = 0; guard < 12 && !seen; guard += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 950)) })
      if (screen.queryByText(/one you missed/)) { seen = true; break }
      const word = askedWord()
      if (!word) break
      spell(word)
      const check = checkButton()
      if (check) fireEvent.click(check)
    }

    expect(seen).toBe(true)
    expect(screen.getByText(/one you missed/)).toBeInTheDocument()
    // No chunks, no trap, no hook, no answer — the plain interface only.
    expect(document.querySelector('.lhx-sp-chunk')).toBeNull()
    expect(document.querySelector('.lhx-sp-hook')).toBeNull()
    expect(document.querySelector('.lhx-sp-fb')).toBeNull()
  }, 30000)
})

describe('Spelling — results and persistence', () => {
  /** Play a whole stage, getting every word right first time. */
  async function clearStage() {
    await startFirstStage()
    for (let i = 0; i < 10; i += 1) {
      const word = askedWord()
      if (!word) break
      spell(word)
      const check = checkButton()
      if (check) fireEvent.click(check)
      await act(async () => { await new Promise((r) => setTimeout(r, 950)) })
      if (screen.queryByText('Stage cleared')) break
    }
  }

  it('a perfect stage earns three stars and saves through the shared backend', async () => {
    await clearStage()
    expect(await screen.findByText('Stage cleared')).toBeInTheDocument()
    expect(document.querySelector('.lhx-sp-bigstars').getAttribute('aria-label')).toBe('3 of 3 stars')
    // The kept plumbing: one round, one score row.
    await waitFor(() => expect(saveScore).toHaveBeenCalledTimes(1))
    expect(saveScore.mock.calls[0][0].game).toBe(GAME)
  }, 30000)

  it('the stage result is written to the record, not just to component state', async () => {
    await clearStage()
    await screen.findByText('Stage cleared')
    await waitFor(() => expect(saveSpellingProgress).toHaveBeenCalled())
    expect(store.stars['1']).toBe(3)
    // Every word played is in the pool, so the spacing has something to run on.
    expect(Object.keys(store.pool).length).toBeGreaterThan(0)
  }, 30000)

  it('the stars survive a remount — the map reads the record back', async () => {
    await clearStage()
    await screen.findByText('Stage cleared')
    await waitFor(() => expect(store?.stars?.['1']).toBe(3))
    vi.useRealTimers()

    // A fresh mount is what a refresh, a re-login and a second device all are.
    const again = render(<MemoryRouter><WordBuilderGame game={GAME} /></MemoryRouter>)
    const map = await again.findAllByText('Spelling')
    expect(map.length).toBeGreaterThan(0)
    await waitFor(() => {
      const stage1 = again.getAllByRole('button', { name: /Stage 1, cleared with 3 of 3 stars/ })
      expect(stage1.length).toBeGreaterThan(0)
    })
    // And stage 2 is now the live one rather than locked.
    expect(again.getAllByRole('button', { name: /Stage 2, play now/ }).length).toBeGreaterThan(0)
  }, 30000)

  it('records learning events, and never the answer', async () => {
    await clearStage()
    await screen.findByText('Stage cleared')
    const names = capture.mock.calls.map((call) => call[0])
    expect(names).toContain('spelling_stage_started')
    expect(names).toContain('spelling_word_attempted')
    expect(names).toContain('spelling_word_correct_first_try')
    expect(names).toContain('spelling_stage_completed')
    // NOT chapter_completed. The fixture is two stages in one chapter and only
    // the first has been cleared — a chapter with an open stage in it has not
    // been completed, and reporting one would overstate what the learner did.
    expect(names).not.toContain('spelling_chapter_completed')

    // No payload anywhere carries a word being tested. A client event stream
    // holding the answers is an answer key readable in the network tab.
    const payloads = JSON.stringify(capture.mock.calls.map((call) => call[1]))
    for (const [word] of WORDS) expect(payloads).not.toContain(word)
  }, 30000)
})
