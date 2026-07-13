import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgentOutput, { humanizeKey } from './AgentOutputCards.jsx'

describe('humanizeKey', () => {
  it('turns camelCase / snake_case / kebab into Title Case', () => {
    expect(humanizeKey('stillPending')).toBe('Still Pending')
    expect(humanizeKey('skipped_too_new')).toBe('Skipped Too New')
    expect(humanizeKey('auto-publish')).toBe('Auto Publish')
  })
})

describe('AgentOutput — readable cards (no raw JSON)', () => {
  it('renders Till as a payment reconciliation summary', () => {
    render(<AgentOutput output={{ till: {
      checked: 3,
      recovered: [{ paymentId: 'p1', userId: 'u1', amountZMW: 50, planId: 'monthly' }],
      failedClosed: [],
      stillPending: 1,
      skippedTooNew: 0,
      errors: [],
    } }} />)

    expect(screen.getByText('Payment reconciliation — Lenco')).toBeInTheDocument()
    expect(screen.getByText(/1 buyer recovered/i)).toBeInTheDocument()
    expect(screen.getByText('K50')).toBeInTheDocument()
    // The sweep covers Lenco only — the card must say so, so an all-zero
    // "quiet" run can't be misread as "every payment channel is healthy"
    // while e.g. Google Play verification is broken.
    expect(screen.getByText(/Covers Lenco .*only/i)).toBeInTheDocument()
  })

  it('scopes a quiet Till run to Lenco (no all-channels overclaim)', () => {
    render(<AgentOutput output={{ till: {
      checked: 0, recovered: [], failedClosed: [], stillPending: 0,
      skippedTooNew: 0, errors: [],
    } }} />)

    expect(screen.getByText('No stuck Lenco payments needed recovery.')).toBeInTheDocument()
    expect(screen.getByText(/Google Play purchases are verified separately/i)).toBeInTheDocument()
  })

  it('renders Compass backlog with ranked recommendations', () => {
    render(<AgentOutput output={{ compass: {
      sampled: 40, totalAttempts: 120, distinctAreas: 5, struggleCount: 2,
      backlog: [{
        grade: '7', subject: 'Mathematics', attempts: 30, learners: 12,
        avgPercentage: 42, struggle: true, priority: 17,
        recommendation: 'Build more practice for Grade 7 Mathematics.',
      }],
      errors: [],
    } }} />)

    expect(screen.getByText('Product signal — what to build next')).toBeInTheDocument()
    expect(screen.getByText('1. Grade 7 Mathematics')).toBeInTheDocument()
    expect(screen.getByText(/Build more practice for Grade 7 Mathematics/)).toBeInTheDocument()
  })

  it('renders Reva verdict + suggested edits', () => {
    render(<AgentOutput output={{ reva: {
      verdict: 'revise', severity: 'medium', summary: 'Tone is slightly advanced.',
      edits: [{ where: 'Intro', suggestion: 'Simplify the opening.', reason: 'Age fit.' }],
    } }} />)

    expect(screen.getByText(/Content review — Revise/)).toBeInTheDocument()
    expect(screen.getByText('Simplify the opening.')).toBeInTheDocument()
  })

  it('falls back to a readable panel for an unknown agent key', () => {
    render(<AgentOutput output={{ newAgent: { totalThings: 4, ok: true } }} />)
    // The key is humanized into a heading, and values render readably.
    expect(screen.getAllByText('New Agent').length).toBeGreaterThan(0)
    expect(screen.getByText('Total Things')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })

  it('renders nothing meaningful for empty output', () => {
    render(<AgentOutput output={{}} />)
    expect(screen.getByText(/hasn't produced any output/i)).toBeInTheDocument()
  })
})
