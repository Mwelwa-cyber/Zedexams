/**
 * BudgetEnforcementPanel — the /admin/ai-costs budget-enforcement card.
 * Guards the disabled-ceiling message, the armed view (ceiling, month-to-date,
 * bucket hold, per-provider rows, released/expired footer, partial warning),
 * and the fail-soft error state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockGetBudgetEnforcement = vi.fn()
vi.mock('../lib/aiBudget', () => ({
  getBudgetEnforcement: (...a) => mockGetBudgetEnforcement(...a),
}))
vi.mock('../../../components/ui/Skeleton', () => ({ default: () => <div data-testid="skeleton" /> }))

import BudgetEnforcementPanel from './BudgetEnforcementPanel'

const armedFixture = {
  month: '2099-01',
  budget: {
    enabled: true,
    mode: 'static',
    budgetUsd: 50,
    monthCostUsd: 12.5,
    ratio: 0.25,
    overBudget: false,
    warning: false,
  },
  reservedNowUsd: 12.62,
  enforcedProviders: ['anthropic', 'openai', 'gemini', 'embeddings'],
  providers: [
    { provider: 'anthropic', settledUsd: 10, settledCount: 40, openUsd: 0.1, openCount: 1 },
    { provider: 'openai', settledUsd: 2.5, settledCount: 300, openUsd: 0, openCount: 0 },
    { provider: 'gemini', settledUsd: 0, settledCount: 0, openUsd: 0.02, openCount: 2 },
    { provider: 'embeddings', settledUsd: 0, settledCount: 0, openUsd: 0, openCount: 0 },
  ],
  releasedCount: 3,
  expiredCount: 1,
  partial: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetBudgetEnforcement.mockResolvedValue(armedFixture)
})

describe('BudgetEnforcementPanel', () => {
  it('renders the armed ceiling with KPIs and per-provider rows', async () => {
    render(<BudgetEnforcementPanel />)
    expect(await screen.findByText('Enforcing — within budget')).toBeInTheDocument()
    expect(screen.getByText('$50.00')).toBeInTheDocument()
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.getByText('25% of ceiling')).toBeInTheDocument()
    expect(screen.getByText('$12.62')).toBeInTheDocument()
    // Provider rows carry the enforced settled spend.
    expect(screen.getByText('Anthropic (generators)')).toBeInTheDocument()
    expect(screen.getByText('$10.00')).toBeInTheDocument()
    expect(screen.getByText('OpenAI (Zed chat, marking, images)')).toBeInTheDocument()
    // Footer counts.
    expect(screen.getByText(/Released: 3/)).toBeInTheDocument()
    expect(screen.getByText(/Expired\/reclaimed: 1/)).toBeInTheDocument()
  })

  it('shows the over-budget badge and red bar when the ceiling is hit', async () => {
    mockGetBudgetEnforcement.mockResolvedValue({
      ...armedFixture,
      budget: { ...armedFixture.budget, monthCostUsd: 55, ratio: 1.1, overBudget: true },
    })
    render(<BudgetEnforcementPanel />)
    expect(await screen.findByText('Over budget — AI paused')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('explains when no ceiling is armed', async () => {
    mockGetBudgetEnforcement.mockResolvedValue({
      ...armedFixture,
      budget: { enabled: false, mode: 'static', budgetUsd: 0, monthCostUsd: 0, ratio: 0 },
      providers: armedFixture.providers.map((p) => ({
        ...p, settledUsd: 0, settledCount: 0, openUsd: 0, openCount: 0,
      })),
      reservedNowUsd: 0,
      releasedCount: 0,
      expiredCount: 0,
    })
    render(<BudgetEnforcementPanel />)
    expect(await screen.findByText('No ceiling armed')).toBeInTheDocument()
    expect(screen.getByText(/spend is tracked but not limited/)).toBeInTheDocument()
  })

  it('flags a partial (degraded) aggregate read', async () => {
    mockGetBudgetEnforcement.mockResolvedValue({ ...armedFixture, partial: true })
    render(<BudgetEnforcementPanel />)
    expect(await screen.findByText(/partial — some reads degraded/)).toBeInTheDocument()
  })

  it('degrades to a friendly error when the callable fails', async () => {
    mockGetBudgetEnforcement.mockRejectedValue(new Error('nope'))
    render(<BudgetEnforcementPanel />)
    expect(
      await screen.findByText(/couldn't load the budget-enforcement summary/),
    ).toBeInTheDocument()
  })
})
