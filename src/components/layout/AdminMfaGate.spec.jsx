import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../../contexts/AuthContext'
import AdminMfaGate from './AdminMfaGate'

// Render the gate at a given path, with a visible target for the setup route so
// we can assert a redirect actually happened.
function renderAt(path, auth) {
  useAuth.mockReturnValue(auth)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminMfaGate><div>ADMIN CONTENT</div></AdminMfaGate>} />
        <Route path="/admin/security/mfa-setup" element={<AdminMfaGate><div>SETUP PAGE</div></AdminMfaGate>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('AdminMfaGate', () => {
  it('renders admin content for an admin WITH MFA', () => {
    renderAt('/admin', { mfaEnrolled: true })
    expect(screen.getByText('ADMIN CONTENT')).toBeInTheDocument()
  })

  it('redirects an admin WITHOUT MFA to the setup page', () => {
    renderAt('/admin', { mfaEnrolled: false })
    expect(screen.queryByText('ADMIN CONTENT')).not.toBeInTheDocument()
    expect(screen.getByText('SETUP PAGE')).toBeInTheDocument()
  })

  it('does NOT loop on the setup route: renders it even without MFA', () => {
    renderAt('/admin/security/mfa-setup', { mfaEnrolled: false })
    expect(screen.getByText('SETUP PAGE')).toBeInTheDocument()
  })
})
