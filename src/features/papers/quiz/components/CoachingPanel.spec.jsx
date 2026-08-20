/**
 * The coaching panel, and §4.1's hard rule as it reaches the screen.
 *
 * `resolveCoaching` is unit-tested separately (test:paper-quiz-core drives
 * every non-approved status field by field). What THIS pins is the property
 * that makes that test sufficient: the panel renders whatever it is handed and
 * has no gate of its own to forget. So a panel handed a gated `coaching`
 * object shows the answer and no prose — which is the behaviour a learner
 * meets, rather than the behaviour a pure function returns.
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import CoachingPanel from './CoachingPanel'
import { resolveCoaching } from '../lib/coaching'

const QUESTION = {
  options: ['a', 'an'],
  correctAnswer: 'B',
  why: 'Umbrella begins with a vowel sound.',
  distractors: { A: 'A goes before a consonant sound.' },
  example: 'an apple · an hour',
  noteRef: 'english/articles',
  gameSlug: 'word-builder',
}

function renderPanel(question, { selectedIndex = 0, correctIndex = 1 } = {}) {
  const coaching = resolveCoaching({ question, selectedIndex, correctIndex })
  render(
    <MemoryRouter>
      <CoachingPanel
        coaching={coaching}
        seed={0}
        noteHref={coaching.noteRef ? `/notes?topic=${coaching.noteRef}` : ''}
        gameHref={coaching.gameSlug ? `/games/${coaching.gameSlug}` : ''}
        gameLabel={coaching.gameSlug}
      />
    </MemoryRouter>,
  )
  return coaching
}

describe('CoachingPanel', () => {
  it('an APPROVED explanation shows all four blocks and the links', () => {
    renderPanel({ ...QUESTION, explanationStatus: 'approved' })
    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(screen.getByText(/The correct answer is B — an/)).toBeInTheDocument()
    expect(screen.getByText('Why B is right')).toBeInTheDocument()
    expect(screen.getByText(QUESTION.why)).toBeInTheDocument()
    expect(screen.getByText('Why A is wrong')).toBeInTheDocument()
    expect(screen.getByText(QUESTION.distractors.A)).toBeInTheDocument()
    expect(screen.getByText('Remember it like this')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Read the note/ })).toBeInTheDocument()
  })

  it.each(['missing', 'ai_draft', undefined, 'rejected'])(
    'a %s explanation shows the ANSWER and no prose at all',
    (status) => {
      // The failure this guards is invisible: an unreviewed AI sentence
      // explaining an exam answer to a child looks exactly like a working
      // feature.
      renderPanel({ ...QUESTION, explanationStatus: status })
      expect(screen.getByText(/The correct answer is B — an/)).toBeInTheDocument()
      expect(screen.queryByText(QUESTION.why)).not.toBeInTheDocument()
      expect(screen.queryByText(QUESTION.distractors.A)).not.toBeInTheDocument()
      expect(screen.queryByText(QUESTION.example)).not.toBeInTheDocument()
      expect(screen.queryByText('Why B is right')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Read the note/ })).not.toBeInTheDocument()
    },
  )

  it('a correct answer never shows a mistake block', () => {
    // Beside a right answer it reads as an accusation about an option they did
    // not choose.
    renderPanel({ ...QUESTION, explanationStatus: 'approved' }, { selectedIndex: 1, correctIndex: 1 })
    expect(screen.queryByText(/is wrong/)).not.toBeInTheDocument()
    expect(screen.getByText(QUESTION.why)).toBeInTheDocument()
    expect(screen.getByText(/that's the right one/i)).toBeInTheDocument()
  })

  it('announces the verdict politely, for a learner who cannot see the colour', () => {
    const { container } = render(
      <MemoryRouter>
        <CoachingPanel coaching={resolveCoaching({ question: QUESTION, selectedIndex: 0, correctIndex: 1 })} seed={0} />
      </MemoryRouter>,
    )
    const live = container.querySelector('[aria-live]')
    expect(live).toBeTruthy()
    // Polite, not assertive: the learner just acted and is waiting for this.
    expect(live).toHaveAttribute('aria-live', 'polite')
  })
})
