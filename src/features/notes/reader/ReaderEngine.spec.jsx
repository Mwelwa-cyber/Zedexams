/**
 * Behaviour tests for the prototype-v3 note reader engine, driven by the
 * Conjunctions demo fixture (the prototype's working note): Learn-mode
 * paced reveal, keyword word-sheet, YOUR TURN practice, SECTION CHECK
 * remediation with retry, Revise mode visibility, and the label diagram
 * (tap-to-place path + scoring).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReaderEngine from './ReaderEngine'
import LabelDiagram from './LabelDiagram'
import { CONJUNCTIONS_NOTE, CONJUNCTIONS_BLOCKS } from './fixtures/conjunctionsDemo'

function renderEngine(props = {}) {
  return render(
    <MemoryRouter>
      <ReaderEngine
        note={{ title: CONJUNCTIONS_NOTE.title, kicker: CONJUNCTIONS_NOTE.kicker }}
        blocks={CONJUNCTIONS_BLOCKS}
        onBack={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('ReaderEngine', () => {
  it('renders the header with a real reading-time meta line', () => {
    renderEngine()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Conjunctions')
    expect(screen.getByText(CONJUNCTIONS_NOTE.kicker)).toBeInTheDocument()
    expect(screen.getByText(/min read · 3 sections · with Zed/)).toBeInTheDocument()
  })

  it('Learn mode paces the note: sections reveal behind Continue', () => {
    renderEngine()
    // Intro paragraph is visible; section 1's heading is not yet.
    expect(screen.getByText(/works like glue/)).toBeInTheDocument()
    expect(screen.queryByText('Coordinating — joining equals')).toBeNull()
    const begin = screen.getByRole('button', { name: /let's begin/i })
    fireEvent.click(begin)
    expect(screen.getByText('Coordinating — joining equals')).toBeInTheDocument()
    // Later sections stay hidden until their own Continue.
    expect(screen.queryByText(/Subordinating — one idea/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/Subordinating — one idea/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/Conjunction pairs — words that work as a team/)).toBeInTheDocument()
    // Fully revealed → no Continue button remains.
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
  })

  it('keypoints are hidden in Learn and shown in Revise; practice inverts', () => {
    renderEngine()
    expect(screen.queryByText(/KEY POINTS/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /revise/i }))
    // Whole note at once, no pacing.
    expect(screen.queryByRole('button', { name: /let's begin/i })).toBeNull()
    expect(screen.getAllByText(/KEY POINTS/).length).toBe(3)
    // Practice surfaces are revision-hidden.
    expect(screen.queryByText(/YOUR TURN/)).toBeNull()
    expect(screen.queryByText(/SECTION CHECK/)).toBeNull()
    expect(screen.queryByText(/Tap to see the answer/)).toBeNull()
  })

  it('Revise hoists the key points above the note body', () => {
    const { container } = renderEngine({ initialMode: 'revise' })
    const kps = container.querySelectorAll('.lhx-keypoints')
    expect(kps.length).toBe(3)
    // The first thing under the header is a key-points card, not the
    // note's opening paragraph — Revise leads with the summary.
    const body = container.querySelector('.lhx-page > div:last-of-type')
    expect(body.firstElementChild).toHaveClass('lhx-keypoints')
    // Hoisted, not re-entered: the words are the authored ones.
    expect(screen.getAllByText(/Pairs always travel together/).length).toBe(1)
  })

  it('Revise collapses the exercises into a closed accordion, not out of existence', () => {
    renderEngine({ initialMode: 'revise' })
    const head = screen.getByRole('button', { name: /practice these later/i })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    // The fixture has 4 practice + 3 section-check blocks.
    expect(screen.getByText('7 exercises')).toBeInTheDocument()
    // Closed → the questions are not on the page at all.
    expect(screen.queryByText(/YOUR TURN/)).toBeNull()
    fireEvent.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText(/YOUR TURN/).length).toBe(4)
    expect(screen.getAllByText(/SECTION CHECK/).length).toBe(3)
  })

  it('Revise shows the reveal card already open — no re-earning a known answer', () => {
    renderEngine({ initialMode: 'revise' })
    expect(screen.queryByText(/tap to see the answer/i)).toBeNull()
    expect(screen.getByText(/he kept on studying/)).toBeInTheDocument()
  })

  it('Revise offers the guided pass when the Learn pass is unfinished', () => {
    const onModeChange = vi.fn()
    renderEngine({ initialMode: 'revise', onModeChange })
    fireEvent.click(screen.getByRole('button', { name: /learn this properly/i }))
    expect(onModeChange).toHaveBeenCalledWith('learn')
    // Same note, now paced.
    expect(screen.getByRole('button', { name: /let's begin/i })).toBeInTheDocument()
  })

  it('Revise resumes the Learn pass at the first un-revealed section', () => {
    renderEngine({ initialMode: 'revise', resumeStep: 2 })
    fireEvent.click(screen.getByRole('button', { name: /learn this properly/i }))
    // Sections 1 and 2 are already revealed; section 3 is not.
    expect(screen.getByText('Coordinating — joining equals')).toBeInTheDocument()
    expect(screen.getByText(/Subordinating — one idea/)).toBeInTheDocument()
    expect(screen.queryByText(/Conjunction pairs — words that work as a team/)).toBeNull()
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
  })

  it('a finished Learn pass is not asked to be learned again', () => {
    renderEngine({ initialMode: 'revise', resumeStep: 3 })
    expect(screen.queryByRole('button', { name: /learn this properly/i })).toBeNull()
  })

  it('the end of the Learn pass points at the same note in Revise', () => {
    const onModeChange = vi.fn()
    renderEngine({ onModeChange })
    expect(screen.queryByText(/saved to your notes/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /let's begin/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/📌 Saved to your Notes for revision/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /revise this in notes/i }))
    expect(onModeChange).toHaveBeenCalledWith('revise')
    expect(screen.getAllByText(/KEY POINTS/).length).toBe(3)
  })

  it('reports each section reached so the Learn pass can be resumed', () => {
    const onStepReached = vi.fn()
    renderEngine({ onStepReached })
    fireEvent.click(screen.getByRole('button', { name: /let's begin/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onStepReached.mock.calls.map(([n]) => n)).toEqual([1, 2])
  })

  it('tapping a keyword opens the word-explainer sheet with its meaning and examples', () => {
    renderEngine()
    fireEvent.click(screen.getAllByRole('button', { name: 'conjunction' })[0])
    const sheet = screen.getByRole('dialog', { name: /meaning of conjunction/i })
    expect(within(sheet).getByText('A joining word 🔗')).toBeInTheDocument()
    expect(within(sheet).getByText(/sticks two words/)).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: /close word meaning/i }))
    expect(screen.queryByRole('dialog', { name: /meaning of conjunction/i })).toBeNull()
  })

  it('keyword lookup folds case and ellipsis spacing (pairs section)', () => {
    renderEngine()
    fireEvent.click(screen.getByRole('tab', { name: /revise/i }))
    fireEvent.click(screen.getAllByRole('button', { name: 'neither … nor' })[0])
    expect(screen.getByRole('dialog', { name: /meaning of neither … nor/i })).toBeInTheDocument()
  })

  it('practice: a wrong pick stays retryable, the right pick locks with its feedback', () => {
    renderEngine()
    fireEvent.click(screen.getByRole('button', { name: /let's begin/i }))
    const card = screen.getByText('I like mangoes …… I do not like lemons.').closest('.lhx-try-card')
    fireEvent.click(within(card).getByRole('button', { name: 'because' }))
    expect(within(card).getByText(/not quite — try another answer/i)).toBeInTheDocument()
    // Still tappable after a miss.
    fireEvent.click(within(card).getByRole('button', { name: 'but' }))
    expect(within(card).getByText('✓ Correct! The two ideas pull against each other.')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'so' })).toBeDisabled()
  })

  it('section check: a wrong pick opens remediation; the retry celebrates recovery', () => {
    renderEngine()
    fireEvent.click(screen.getByRole('button', { name: /let's begin/i }))
    const card = screen.getByText('It started raining, …… we ran inside.').closest('.lhx-check-card')
    // No remediation until a wrong pick.
    expect(within(card).queryByText(/let’s look at it again/i)).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'yet' }))
    expect(within(card).getByText(/let’s look at it again/i)).toBeInTheDocument()
    expect(within(card).getByText(/shows a/)).toBeInTheDocument() // the re-teach line
    expect(within(card).getByText(/The test was easy/)).toBeInTheDocument() // retry question
    // Retry picks live in the remediation's own chips row — the explain
    // line renders [[so]] as a keyword bubble, so scope past it.
    const retryChips = card.querySelector('.lhx-remed .lhx-try-chips')
    fireEvent.click(within(retryChips).getByRole('button', { name: 'or' }))
    expect(within(card).getByText('Hint: which word shows a RESULT?')).toBeInTheDocument()
    // Right retry → recovery.
    fireEvent.click(within(retryChips).getByRole('button', { name: 'so' }))
    expect(within(card).getByText('✓ Now you have it! 🎉')).toBeInTheDocument()
  })

  it('a correct section-check pick never shows remediation', () => {
    renderEngine()
    fireEvent.click(screen.getByRole('button', { name: /let's begin/i }))
    const card = screen.getByText('It started raining, …… we ran inside.').closest('.lhx-check-card')
    fireEvent.click(within(card).getByRole('button', { name: 'so' }))
    expect(within(card).getByText(/correct — you understood this section/i)).toBeInTheDocument()
    expect(within(card).queryByText(/let’s look at it again/i)).toBeNull()
  })

  it('tap-to-reveal shows the answer in place', () => {
    renderEngine()
    fireEvent.click(screen.getByRole('button', { name: /let's begin/i }))
    const reveal = screen.getByText(/Which joining word fits best/).closest('.lhx-reveal-card')
    expect(within(reveal).getByText(/tap to see the answer/i)).toBeInTheDocument()
    fireEvent.click(reveal)
    expect(within(reveal).getByText(/he kept on studying/)).toBeInTheDocument()
    expect(within(reveal).queryByText(/tap to see the answer/i)).toBeNull()
  })
})

describe('LabelDiagram', () => {
  const BLOCK = {
    type: 'labeldiagram',
    url: '/x.png',
    alt: 'Digestive system to label',
    instructions: 'Drag each word onto the right box — or tap a word, then tap a box.',
    items: [
      { key: 'mouth', label: 'Mouth', x: 0.2, y: 0.1 },
      { key: 'liver', label: 'Liver', x: 0.1, y: 0.5 },
    ],
  }

  it('tap word → tap box places the label; the chip leaves the bank', () => {
    render(<LabelDiagram block={BLOCK} />)
    // Bank is alphabetical.
    const chips = screen.getAllByRole('button', { name: /^(Liver|Mouth)$/ })
    expect(chips.map((c) => c.textContent)).toEqual(['Liver', 'Mouth'])
    // Tap-select Mouth (pointer down + up without travel), then tap a slot.
    const mouthChip = screen.getByRole('button', { name: 'Mouth' })
    fireEvent.pointerDown(mouthChip, { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(document, { clientX: 10, clientY: 10 })
    expect(mouthChip).toHaveAttribute('aria-pressed', 'true')
    const slots = screen.getAllByRole('button', { name: 'Empty label box' })
    fireEvent.click(slots[0])
    expect(screen.getByRole('button', { name: /Mouth placed/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mouth' })).toBeNull() // gone from the bank
  })

  it('Check reports the score; a full correct placement is celebrated; Reset restarts', () => {
    render(<LabelDiagram block={BLOCK} />)
    const placeByTap = (label, slotIndex) => {
      const chip = screen.getByRole('button', { name: label })
      fireEvent.pointerDown(chip, { clientX: 5, clientY: 5 })
      fireEvent.pointerUp(document, { clientX: 5, clientY: 5 })
      fireEvent.click(screen.getAllByRole('button', { name: 'Empty label box' })[slotIndex])
    }
    // Wrong placement first: Liver onto the mouth slot.
    placeByTap('Liver', 0)
    fireEvent.click(screen.getByRole('button', { name: 'Check answers' }))
    expect(screen.getByText('You got 0 of 2. Fix the red boxes and check again!')).toBeInTheDocument()
    // Fix it: reset, then place both correctly (slots render in item order).
    fireEvent.click(screen.getByRole('button', { name: '↺ Reset' }))
    placeByTap('Mouth', 0)
    placeByTap('Liver', 0) // the remaining empty slot is the liver slot
    fireEvent.click(screen.getByRole('button', { name: 'Check answers' }))
    expect(screen.getByText('🎉 Perfect! All 2 labelled correctly.')).toBeInTheDocument()
  })
})
