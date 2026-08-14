import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PasskeySignInButton from './PasskeySignInButton.jsx'

describe('PasskeySignInButton', () => {
  it('renders the required label and inclusive supporting copy', () => {
    render(<PasskeySignInButton onClick={() => {}} />)
    // The label must never be fingerprint-only — passkeys also cover face,
    // PIN, screen lock and hardware keys.
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument()
    expect(
      screen.getByText('Use your fingerprint, face, PIN, or device screen lock.'),
    ).toBeInTheDocument()
  })

  it('fires onClick when enabled', () => {
    const onClick = vi.fn()
    render(<PasskeySignInButton onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled and shows waiting copy while loading', () => {
    const onClick = vi.fn()
    render(<PasskeySignInButton onClick={onClick} loading />)
    const btn = screen.getByRole('button', { name: 'Sign in with a passkey' })
    expect(btn).toBeDisabled()
    expect(screen.getByText('Waiting for your device…')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('respects the disabled prop (another sign-in method is in flight)', () => {
    render(<PasskeySignInButton onClick={() => {}} disabled />)
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeDisabled()
  })
})
