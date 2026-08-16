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

const flagState = { engine: true, resolved: true, final: true, source: 'rollout-all', runner: 'pastPaperQuiz', live: true, latched: false }
// Per-test knobs for the quiz mock, mutated in tests and reset in beforeEach.
const quizState = { correctAnswer: 1, lockedOut: false, questionExtra: {}, options: null }

vi.mock('../../../hooks/useAssessmentEngineFlag', () => ({
  useAssessmentEngineFlag: () => flagState,
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null }),
}))
vi.mock('../../../utils/pastPaperLookup', () => ({
  getPaperById: vi.fn(async () => ({
    id: 'p1', title: 'Mathematics P1 2024', subject: 'mathematics',
    grade: '7', year: 2024, quizId: 'quiz-1', quizStatus: 'attached',
  })),
}))
vi.mock('../../../utils/quizSubjectIntegrity', () => ({
  validateQuizSubjectIntegrity: () => ({ ok: true }),
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
// The runner's results screen reaches the entitlements service for the
// PAPER_CONTINUE lock, and through it `useTeacherUsage` → the Firebase SDK.
// The runner's own render path uses only the pure free-set helpers, so this
// mock keeps the canary spec free of a Firebase boot it never needed.
vi.mock('../../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: () => ({ data: null, loading: false, error: null }),
  TOOL_TO_FEATURE: { lesson_plan: 'plans' },
}))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../hooks/useQuizDisplayPrefs', () => ({
  useQuizDisplayPrefs: () => ({
    prefs: { readAloud: false }, setPref: vi.fn(), resetPrefs: vi.fn(),
    displayVars: {}, saving: false,
  }),
}))
vi.mock('../../../hooks/useQuizReadAloud', () => ({
  useQuizReadAloud: () => ({ enabled: false, stop: vi.fn() }),
}))
// NOT importOriginal: the real module imports the Firebase client, which
// refuses to initialise in jsdom without a config. The constants live in the
// pure `pastPaperQuizLoad`, which is safe to load anywhere.
vi.mock('../../../utils/pastPaperQuiz', async () => {
  const pure = await import('../../../utils/pastPaperQuizLoad')
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
        // Per-test figure/position fields. Spread before options and the
        // correctAnswer getter so a test can never accidentally displace the
        // engine-canary contract those two encode.
        ...quizState.questionExtra,
        // FIVE options on purpose: the D4 defect was `['A','B','C','D'][i]`
        // yielding undefined past D, and the §2 requirement is letters from a
        // rule that does not stop at four.
        // `quizState.options` is a separate knob rather than part of
        // `questionExtra`, so the "cannot displace the canary contract" rule
        // above still holds: a test that wants a different option SHAPE has to
        // say so explicitly.
        options: quizState.options ?? ['3', '4', '5', '6', '22'],
        get correctAnswer() { return quizState.correctAnswer },
      }],
    })),
    getAnsweredCount: vi.fn(() => 0),
    hasReachedFreeLimit: vi.fn(() => quizState.lockedOut),
    recordAnsweredQuestion: vi.fn(() => 1),
    resetCounter: vi.fn(),
  }
})

import PublicQuizRunner from './PublicQuizRunner'
import { capture } from '../../../utils/analytics'

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
  flagState.resolved = true
  flagState.final = true
  flagState.source = 'rollout-all'
  flagState.latched = false
  quizState.correctAnswer = 1
  quizState.lockedOut = false
  quizState.questionExtra = {}
  quizState.options = null
})

/**
 * Stem figure + image position.
 *
 * These live in this file because it owns the mount harness for this runner,
 * and they are deliberately NOT part of the canary: the stem figure is
 * rendered UPSTREAM of the engine/old card swap, so it is flag-independent —
 * which is itself worth pinning, since a future refactor that moved the figure
 * inside a card would make it flag-dependent without anything failing.
 *
 * This surface honoured neither `imagePosition` (#2204 fixed the other three
 * runners and described the problem as having three surfaces — this was the
 * fourth) nor, before that, a shared precedence rule for which figure wins.
 */
describe('the stem figure and its position', () => {
  it('honours imagePosition — the gap #2204 left on this surface', async () => {
    quizState.questionExtra = { imageUrl: 'https://storage.example/fig.jpg', imagePosition: 'below' }
    const { container } = mountRunner()
    await screen.findByText(/What is 2 \+ 2\?/)
    const wrap = container.querySelector('[data-image-position="below"]')
    expect(wrap).not.toBeNull()
    expect(wrap.className).toContain('flex-col-reverse')
    expect(wrap.querySelector('img')).not.toBeNull()
  })

  it('positions the figure the same way with the engine card OFF (it is upstream of the swap)', async () => {
    flagState.engine = false
    quizState.questionExtra = { imageUrl: 'https://storage.example/fig.jpg', imagePosition: 'right' }
    const { container } = mountRunner()
    await screen.findByText(/What is 2 \+ 2\?/)
    expect(container.querySelector('[data-engine-runner]')).toBeNull()
    expect(container.querySelector('[data-image-position="right"]').className).toContain('sm:flex-row-reverse')
  })

  it('renders a library diagram, and it beats a leftover imageUrl', async () => {
    quizState.questionExtra = {
      imageDiagram: { libraryKey: 'trapezium', params: {} },
      imageUrl: 'https://storage.example/stale.jpg',
    }
    const { container } = mountRunner()
    await screen.findByText(/What is 2 \+ 2\?/)
    expect(container.querySelector('.zx-diagram-svg')).not.toBeNull()
    expect(container.querySelector('img[src="https://storage.example/stale.jpg"]')).toBeNull()
  })

  it('emits no position wrapper for a question with no figure', async () => {
    quizState.questionExtra = { imagePosition: 'below' }
    const { container } = mountRunner()
    await screen.findByText(/What is 2 \+ 2\?/)
    expect(container.querySelector('[data-image-position]')).toBeNull()
  })
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

  it('a legacy answer-key shape refuses the engine and the OLD card scores it', async () => {
    // Codex P1 on #2149 (r3733259611): the canonical key derives only from an
    // integer correctAnswer, so a legacy string/letter key normalises to a
    // null correctIndex — an engine card that paints nothing green and marks
    // every selection wrong. Until the normaliser learns the legacy shapes,
    // such a paper is the old runner's to serve, and telemetry must say so.
    quizState.correctAnswer = 'B'
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')
    expect(container.querySelector('[data-engine-runner]')).toBeNull()
    await waitFor(() => expect(capture).toHaveBeenCalledWith('assessment_engine_path', {
      runner: 'pastPaperQuiz', engine: false, flagSource: 'rollout-all', latched: false, build: 'dev',
    }))
  })

  it('an unresolved flag serves the OLD card and reports nothing yet', async () => {
    // Codex P2 on #2149 (r3733259614): before both flag reads settle the hook
    // reports a provisional decision; serving the engine card on it can show a
    // returning learner a card their eventual uid is not rolled out to, then
    // swap it mid-question.
    flagState.resolved = false
    flagState.final = false
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')
    expect(container.querySelector('[data-engine-runner]')).toBeNull()
    expect(capture).not.toHaveBeenCalled()
  })

  it('a spent free set NEVER disables the engine rows — there is no mid-quiz wall', async () => {
    // This test used to assert the opposite, and the inversion is the point.
    //
    // The old runner disabled every option once the free quota was spent, then
    // fired a paywall modal: twenty or thirty questions of real work, then a
    // wall, no score and no answers. The free set now ends the RUN at its
    // boundary and the offer lives on the results screen, after the learner
    // has been paid in feedback for what they did. So a learner mid-question
    // is never locked out of the question they are on — the rows stay
    // enabled, for assistive tech and sighted users alike.
    //
    // (The original note, Codex P2 on #2149 r3733259617, was that swallowing
    // clicks in the handler leaves the rows focusable and apparently
    // actionable. That asymmetry is gone because nothing is refused.)
    quizState.lockedOut = true
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')
    const rows = container.querySelectorAll('[data-engine-runner] .zx-opt')
    expect(rows.length).toBe(5)
    for (const row of rows) expect(row.disabled).toBe(false)
    // And no modal, sheet, toast or banner anywhere in the tree.
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).not.toMatch(/free preview ended|upgrade to keep going/i)
  })

  it('a provisional answer is never recorded: no event until the decision is final', async () => {
    // Codex P2 on #2153 (r3733460759): resolved-but-not-final is the watchdog
    // window under a partial rollout — the card renders (old), but `latched`
    // is provisional and a once-only event captured here counts holds wrongly
    // in both directions. The event waits for `final`.
    flagState.engine = false
    flagState.final = false
    flagState.source = 'rollout-bucket'
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    expect(capture).not.toHaveBeenCalled()
  })

  it('reports which path SERVED, once, to PostHog — both ways', async () => {
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1))
    expect(capture).toHaveBeenCalledWith('assessment_engine_path', {
      runner: 'pastPaperQuiz', engine: true, flagSource: 'rollout-all', latched: false, build: 'dev',
    })
  })

  it('the watchdog hold is countable: latched travels with the event', async () => {
    // engine:false with an engine-selecting source happens two ways — the
    // watchdog held the visit, or normalisation refused the paper. `latched`
    // is what tells them apart in PostHog (Codex P2 on #2152, r3733390982).
    flagState.engine = false
    flagState.latched = true
    flagState.source = 'rollout-bucket'
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    await waitFor(() => expect(capture).toHaveBeenCalledWith('assessment_engine_path', {
      runner: 'pastPaperQuiz', engine: false, flagSource: 'rollout-bucket', latched: true, build: 'dev',
    }))
  })

  it('refuses an OBJECT-shaped option and serves the old card', async () => {
    // The open question the quiz cutover left about this route, closed. The
    // old card reads `imageUrl`, `diagram` and option-level `isCorrect` off an
    // option object; the canonical model has nowhere to put any of them.
    quizState.options = [
      { text: 'A triangle', imageUrl: 'https://storage.example/a.png' },
      { text: 'A square', imageUrl: 'https://storage.example/b.png' },
    ]
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')
    expect(container.querySelector('[data-engine-runner]')).toBeNull()
  })

  it('refuses a bare `{text}` option too — the failure is the object, not the media', async () => {
    // Shaped as "not a string" rather than "has media" on purpose. An option
    // carrying only text looks harmless and is not: see the control below.
    quizState.options = [{ text: 'A triangle' }, { text: 'A square' }]
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')
    expect(container.querySelector('[data-engine-runner]')).toBeNull()
  })

  it('and a STRING option is unaffected — the refusal is not just "always off"', async () => {
    // The control. Without it the two refusals above would pass with the
    // engine branch deleted entirely.
    quizState.options = ['A triangle', 'A square']
    const { container } = mountRunner()
    await screen.findByText('What is 2 + 2?')
    expect(container.querySelector('[data-engine-runner="pastPaperQuiz"]')).not.toBeNull()
  })

  it('the refusal is reported as engine:false, so the ramp counts it', async () => {
    quizState.options = [{ text: 'A triangle', imageUrl: 'https://storage.example/a.png' }]
    quizState.correctAnswer = 0
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    await waitFor(() => expect(capture).toHaveBeenCalledWith('assessment_engine_path', {
      runner: 'pastPaperQuiz', engine: false, flagSource: 'rollout-all', latched: false, build: 'dev',
    }))
  })

  it('reports engine:false when the flag is off', async () => {
    flagState.engine = false
    flagState.source = 'runner-off'
    mountRunner()
    await screen.findByText('What is 2 + 2?')
    await waitFor(() => expect(capture).toHaveBeenCalledWith('assessment_engine_path', {
      runner: 'pastPaperQuiz', engine: false, flagSource: 'runner-off', latched: false, build: 'dev',
    }))
  })
})
