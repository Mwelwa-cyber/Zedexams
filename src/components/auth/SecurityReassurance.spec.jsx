import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SecurityReassurance from './SecurityReassurance.jsx'

describe('SecurityReassurance', () => {
  it('renders the three trust items', () => {
    render(<SecurityReassurance />)
    expect(screen.getByText('Secure')).toBeInTheDocument()
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Trusted')).toBeInTheDocument()
    expect(screen.getByText('Your data is protected')).toBeInTheDocument()
    expect(screen.getByText('Built for teachers and learners')).toBeInTheDocument()
  })

  it('claims only that biometrics are never stored — not that no passkey data is stored', () => {
    // Passkeys DO store a public key + credential metadata server-side; the
    // honest claim is scoped to biometric data, which never leaves the device.
    render(<SecurityReassurance />)
    expect(screen.getByText('We never store your biometrics')).toBeInTheDocument()
    expect(screen.queryByText(/never store any data/i)).not.toBeInTheDocument()
  })
})
