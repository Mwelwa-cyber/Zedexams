import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const auth = { currentUser: null, logout: vi.fn() }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth }))

import FamilyClosed from './FamilyClosed'

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/family/*" element={<FamilyClosed />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('FamilyClosed', () => {
  beforeEach(() => {
    auth.currentUser = null
    auth.logout.mockReset()
  })

  it('stays on the page it was opened on instead of redirecting', () => {
    // A redirect home would loop for a signed-in parent: RootRedirect resolves
    // "/" by role and sends them straight back to /family.
    mount('/family/children')
    expect(screen.getByText('The parent area has closed')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/family/children')
  })

  it('gives a signed-out visitor a plain link home and no sign-out button', () => {
    mount('/family')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: /go to zedexams/i })).toHaveAttribute('href', '/')
  })

  it('signs a signed-in parent out before sending them home', async () => {
    // A plain link home would return them here: RootRedirect resolves "/" by
    // role and sends a parent back to /family.
    auth.currentUser = { uid: 'p1' }
    mount('/family')
    expect(screen.queryByRole('link', { name: /go to zedexams/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /sign out and go to zedexams/i }))
    expect(auth.logout).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
  })
})
