import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SessionRestorationScreen, { STAGE_COPY } from './SessionRestorationScreen.jsx'

describe('SessionRestorationScreen', () => {
  it('shows the restoring-auth copy on the initial auth-restoration state', () => {
    render(<SessionRestorationScreen stage="restoring-auth" />)
    expect(screen.getByText(STAGE_COPY['restoring-auth'].title)).toBeInTheDocument()
    expect(screen.getByText(STAGE_COPY['restoring-auth'].subtitle)).toBeInTheDocument()
    // Working states are a polite status region, busy.
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the loading-profile copy once auth has resolved', () => {
    render(<SessionRestorationScreen stage="loading-profile" />)
    expect(screen.getByText('Loading your teaching profile…')).toBeInTheDocument()
    expect(screen.getByText('Fetching your teaching information.')).toBeInTheDocument()
  })

  it('shows the dashboard-preparation copy', () => {
    render(<SessionRestorationScreen stage="loading-dashboard" />)
    expect(screen.getByText('Preparing your dashboard…')).toBeInTheDocument()
    expect(screen.getByText('Preparing your teacher workspace.')).toBeInTheDocument()
  })

  it('shows the completion copy and applies the leaving fade class', () => {
    const { container } = render(<SessionRestorationScreen stage="complete" leaving />)
    expect(screen.getByText('Your dashboard is ready.')).toBeInTheDocument()
    expect(container.querySelector('.zsr--leaving')).toBeInTheDocument()
  })

  it('renders the trust row with a shield icon', () => {
    const { container } = render(<SessionRestorationScreen stage="restoring-auth" />)
    expect(screen.getByText(/Secure/)).toBeInTheDocument()
    // Shield icon is the first svg inside the trust row.
    expect(container.querySelector('.zsr__trust svg')).toBeInTheDocument()
  })

  it('never displays a fake percentage — the progress bar is indeterminate', () => {
    const { container } = render(<SessionRestorationScreen stage="loading-profile" />)
    expect(container.textContent).not.toMatch(/\d+\s*%/)
    // No determinate progressbar semantics leak through.
    expect(container.querySelector('[aria-valuenow]')).toBeNull()
    expect(container.querySelector('.zsr__bar')).toBeInTheDocument()
  })

  it('keeps the loader ring decorative (aria-hidden) so only the status text is announced', () => {
    const { container } = render(<SessionRestorationScreen stage="restoring-auth" />)
    // aria-hidden on the ring wrapper hides all its decorative descendants
    // (glow, arcs, badge) from assistive tech — the status text carries meaning.
    const loader = container.querySelector('.zsr__loader')
    expect(loader).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.zsr__badge')).toHaveAttribute('alt', '')
  })

  it('surfaces the offline recovery card and uses an alert region', () => {
    render(<SessionRestorationScreen stage="offline" onRetry={() => {}} onReturnToSignIn={() => {}} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByText('You appear to be offline').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /return to sign in/i })).toBeInTheDocument()
  })

  it('surfaces the timeout recovery card', () => {
    render(<SessionRestorationScreen stage="timeout" onRetry={() => {}} onReturnToSignIn={() => {}} />)
    expect(screen.getAllByText('This is taking longer than expected').length).toBeGreaterThan(0)
  })

  it('surfaces a friendly error message that reassures the account is safe', () => {
    render(<SessionRestorationScreen stage="error" error="permission-denied" onRetry={() => {}} onReturnToSignIn={() => {}} />)
    expect(screen.getAllByText('We could not restore your session').length).toBeGreaterThan(0)
    expect(screen.getByText('Your account is safe. Please try again.')).toBeInTheDocument()
  })

  it('calls onRetry when Try again is clicked', () => {
    const onRetry = vi.fn()
    render(<SessionRestorationScreen stage="timeout" onRetry={onRetry} onReturnToSignIn={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('calls onReturnToSignIn when Return to sign in is clicked', () => {
    const onReturnToSignIn = vi.fn()
    render(<SessionRestorationScreen stage="error" onRetry={() => {}} onReturnToSignIn={onReturnToSignIn} />)
    fireEvent.click(screen.getByRole('button', { name: /return to sign in/i }))
    expect(onReturnToSignIn).toHaveBeenCalledTimes(1)
  })

  it('disables both actions while retrying so no duplicate requests fire', () => {
    const onRetry = vi.fn()
    render(<SessionRestorationScreen stage="timeout" retrying onRetry={onRetry} onReturnToSignIn={() => {}} />)
    const tryAgain = screen.getByRole('button', { name: /retrying/i })
    expect(tryAgain).toBeDisabled()
    fireEvent.click(tryAgain)
    expect(onRetry).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /return to sign in/i })).toBeDisabled()
  })

  it('does not render the dashboard skeleton during the unknown-auth stage', () => {
    const { container, rerender } = render(
      <SessionRestorationScreen stage="restoring-auth" showDashboardSkeleton />,
    )
    // Guard: never expose an authenticated layout to a still-unknown visitor.
    expect(container.querySelector('.zsr__skeleton')).toBeNull()
    rerender(<SessionRestorationScreen stage="loading-profile" showDashboardSkeleton />)
    expect(container.querySelector('.zsr__skeleton')).toBeInTheDocument()
  })
})
