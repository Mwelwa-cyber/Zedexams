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

  it('offers Preview before Continue when an old draft has a preview handler', async () => {
    const onPreview = vi.fn()
    render(
      <DraftRecoveryPrompt
        recovery={{ available: true, payload: { savedAt: Date.now() - 14 * 24 * 60 * 60 * 1000 } }}
        source="local"
        acceptRecovery={() => {}}
        discardRecovery={() => {}}
        onPreview={onPreview}
        label="class timetable"
      />,
    )
    expect(screen.getByText(/14 days old/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Preview'))
    expect(onPreview).toHaveBeenCalled()
  })

  it('does not offer Preview for a fresh draft even with a handler', () => {
    render(
      <DraftRecoveryPrompt
        recovery={{ available: true, payload: { savedAt: Date.now() } }}
        source="local"
        acceptRecovery={() => {}}
        discardRecovery={() => {}}
        onPreview={() => {}}
        label="class timetable"
      />,
    )
    expect(screen.queryByText('Preview')).not.toBeInTheDocument()
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
