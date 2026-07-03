import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import DraftRecoveryPrompt from './DraftRecoveryPrompt'

describe('DraftRecoveryPrompt', () => {
  it('renders nothing when there is no recoverable draft', () => {
    const { container } = render(<DraftRecoveryPrompt recovery={{ available: false }} />)
    expect(container.firstChild).toBeNull()
  })

  it('offers to continue or discard a local draft', async () => {
    const acceptRecovery = vi.fn()
    const discardRecovery = vi.fn()
    render(
      <DraftRecoveryPrompt
        recovery={{ available: true, payload: { savedAt: Date.now() } }}
        source="local"
        acceptRecovery={acceptRecovery}
        discardRecovery={discardRecovery}
        label="worksheet"
      />,
    )
    expect(screen.getByText(/unfinished worksheet/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Continue editing'))
    expect(acceptRecovery).toHaveBeenCalled()
    await userEvent.click(screen.getByText('Discard'))
    expect(discardRecovery).toHaveBeenCalled()
  })

  it('tells the teacher when the draft came from another device', () => {
    render(
      <DraftRecoveryPrompt
        recovery={{ available: true, payload: { savedAt: Date.now() } }}
        source="remote"
        acceptRecovery={() => {}}
        discardRecovery={() => {}}
        label="lesson plan"
      />,
    )
    expect(screen.getByText(/another device/)).toBeInTheDocument()
  })
})
