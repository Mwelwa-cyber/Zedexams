import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorState from './ErrorState.jsx'
import { ACTIONS } from '../../utils/friendlyErrors.js'

describe('ErrorState', () => {
  it('translates a Firebase auth code into a friendly title + message', () => {
    render(<ErrorState error={{ code: 'auth/wrong-password' }} />)
    expect(screen.getByText('Incorrect Password')).toBeInTheDocument()
    expect(
      screen.getByText('The password you entered is incorrect. Please try again.'),
    ).toBeInTheDocument()
    // Never leaks the raw code.
    expect(screen.queryByText(/auth\/wrong-password/)).toBeNull()
  })

  it('shows the network card for an offline device regardless of the error', () => {
    render(<ErrorState error={new Error('boom')} online={false} />)
    expect(screen.getByText('No Internet Connection')).toBeInTheDocument()
  })

  it('renders a Retry button only when onRetry is provided and calls it', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState error={{ code: 'internal' }} />)
    // server template wants Retry but no handler → button hidden
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull()

    rerender(<ErrorState error={{ code: 'internal' }} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders contextual actions from the handlers map', async () => {
    const onForgot = vi.fn()
    render(
      <ErrorState
        error={{ code: 'auth/wrong-password' }}
        handlers={{ [ACTIONS.FORGOT_PASSWORD]: onForgot }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Forgot Password' }))
    expect(onForgot).toHaveBeenCalledOnce()
  })

  it('fires onReported when the learner reports a problem', async () => {
    const onReported = vi.fn()
    render(<ErrorState error={new Error('weird crash')} onReported={onReported} />)
    await userEvent.click(screen.getByRole('button', { name: 'Report Problem' }))
    expect(onReported).toHaveBeenCalledOnce()
  })
})
