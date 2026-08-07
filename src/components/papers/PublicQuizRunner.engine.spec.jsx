/**
 * The past-paper canary: the flag selects the choice card, and only the card.
 *
 * §5.1(6) of docs/phase3-plan.md — before a flip, a Vitest spec renders the
 * engine's version of the runner and asserts the §2 layout requirements. This
 * is that spec, plus the two claims that make the canary a canary:
 *
 *   • flag ON  → the ENGINE card serves (letters past D, one column, no
 *     verdict before reveal, verdict from the engine's marking seam after);
 *   • flag OFF → the OLD card serves, byte-for-byte the pre-canary runner.
 *
 * The card is asserted by `data-engine-runner` and the engine's own class
 * vocabulary (`.opt-grid`, `.zx-opt`), because "looks the same" is exactly what
 * the two cards are meant to do — a control that cannot tell them apart would
 * pass with the flag ignored, which is the one regression this file exists to
 * catch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const flagState = { engine: true, resolved: true, source: 'rollout-all', runner: 'pastPaperQuiz', live: true, latched: false }

vi.mock('../../hooks/useAssessmentEngineFlag', () => ({
  useAssessmentEngineFlag: () => flagState,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null }),
}))
vi.mock('../../utils/pastPapers', () => ({
  getPaperById: vi.fn(async () => ({
    id: 'p1', title: 'Mathematics P1 2024', subject: 'mathematics',
    grade: '7', year: 2024, quizId: 'quiz-1', quizStatus: 'attached',
  })),
}))
vi.mock('../../utils/quizSubjectIntegrity', () => ({
  validateQuizSubjectIntegrity: () => ({ ok: true }),
}))
vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../hooks/useQuizDisplayPrefs', () => ({
  useQuizDisplayPrefs: () => ({
    prefs: { readAloud: false }, setPref: vi.fn(), resetPrefs: vi.fn(),
    displayVars: {}, saving: false,
  }),
}))
vi.mock('../../hooks/useQuizReadAloud', () => ({
  useQuizReadAloud: () => ({ enabled: false, stop: vi.fn() }),
}))
// NOT importOriginal: the real module imports the Firebase client, which
// refuses to initialise in jsdom without a config. The constants live in the
// pure `pastPaperQuizLoad`, which is safe to load anywhere.
vi.mock('../../utils/pastPaperQuiz', async () => {
  const pure = await import('../../utils/pastPaperQuizLoad')
  return {
    QUIZ_LOAD: pure.QUIZ_LOAD,
    QUIZ_LOAD_TEXT: pure.QUIZ_LOAD_TEXT,
    FREE_QUESTION_LIMIT: 30,
    loadPublicQuiz: vi.fn(async () => ({
      outcome: pure.QUIZ_LOAD.OK,
      denied: false,
      error: null,
      quiz: { id: 'quiz-1', title: 'Mathematics P1 2024', subject: 'Mathematics', grade: '7' },
      questions: [{
        id: 'q1', type: 'mcq', text: 'What is 2 + 2?', marks: 1, topic: 'Addition',
        // FIVE options on purpose: the D4 defect was `['A','B','C','D'][i]`
        // yielding undefined past D, and the §2 requirement is letters from a
        // rule that does not stop at four.
        options: ['3', '4', '5', '6', '22'],
        correctAnswer: 1,
      }],
    })),
    getAnsweredCount: vi.fn(() => 0),
    hasReachedFreeLimit: vi.fn(() => false),
    recordAnsweredQuestion: vi.fn(() => 1),
    resetCounter: vi.fn(),
  }
})

import PublicQuizRunner from './PublicQuizRunner'
import { capture } from '../../utils/analytics'

function mountRunner() {
  return render(
    <MemoryRouter initialEntries={['/papers/p1/quiz']}>
      <Routes>
        <Route path="/papers/:paperId/quiz" element={<PublicQuizRunner />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  flagState.engine = true
  flagState.source = 'rollout-all'
})

describe('the past-paper canary card swap', () => {
  it('flag ON: the engine card serves, §2 layout intact', async () => {
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')

    const engineCard = container.querySelector('[data-engine-runner="pastPaperQuiz"]')
    expect(engineCard, 'the engine card is what mounted').toBeTruthy()
    // One vertical column: the engine's whole choice area is ONE .opt-grid
    // (grid-template-columns: 1fr in src/index.css), never a per-option grid.
    expect(engineCard.querySelectorAll('.opt-grid')).toHaveLength(1)
    const rows = engineCard.querySelectorAll('.zx-opt')
    expect(rows).toHaveLength(5)
    // Letters from the shared rule — past D, where the array form broke.
    const letters = [...engineCard.querySelectorAll('.zx-opt-letter')].map((el) => el.textContent)
    expect(letters).toEqual(['A', 'B', 'C', 'D', 'E'])
    // No verdict is painted before reveal, on any row.
    for (const row of rows) {
      expect(row.dataset.correct).toBe('false')
      expect(row.dataset.wrong).toBe('false')
    }
    expect(screen.queryByRole('img', { name: 'Correct' })).toBeNull()
  })

  it('flag ON: reveal paints the verdict from the engine seam and tallies the score', async () => {
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    // Pick the WRONG option (C, "5") so both ✓ and ✗ must appear on reveal —
    // asserting only the tick would pass for a card that paints everything green.
    fireEvent.click(screen.getByText('5').closest('button'))
    fireEvent.click(screen.getByText('Check answer'))
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Correct' })).toBeTruthy()
      expect(screen.getByRole('img', { name: 'Incorrect' })).toBeTruthy()
    })
    const key = screen.getByText('4').closest('button')
    expect(key.dataset.correct).toBe('true')
    // A wrong answer must not move the tally.
    expect(screen.getByText('Score 0')).toBeTruthy()
  })

  it('flag ON: a correct answer moves the tally through the marking seam', async () => {
    // The card paints ✓ from its own `correctIndex`; the TALLY comes from
    // `markAttempt`. Asserting the score is what catches a bypassed seam —
    // a mutation that hardcodes the verdict passes every paint-only assertion
    // and fails only here.
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    fireEvent.click(screen.getByText('4').closest('button'))
    fireEvent.click(screen.getByText('Check answer'))
    await waitFor(() => expect(screen.getByText('Score 1')).toBeTruthy())
  })

  it('flag OFF: the old card serves, untouched', async () => {
    flagState.engine = false
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')
    expect(container.querySelector('[data-engine-runner]')).toBeNull()
    expect(container.querySelector('.zx-opt')).toBeNull()
    // The old card's letters come from its own badge span; still A..E.
    expect(screen.getByText('E')).toBeTruthy()
  })

  it('reports which path SERVED, once, to PostHog — both ways', async () => {
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1))
    expect(capture).toHaveBeenCalledWith('assessment_engine_path', {
      runner: 'pastPaperQuiz', engine: true, flagSource: 'rollout-all',
    })
  })

  it('reports engine:false when the flag is off', async () => {
    flagState.engine = false
    flagState.source = 'runner-off'
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    await waitFor(() => expect(capture).toHaveBeenCalledWith('assessment_engine_path', {
      runner: 'pastPaperQuiz', engine: false, flagSource: 'runner-off',
    }))
  })
})
