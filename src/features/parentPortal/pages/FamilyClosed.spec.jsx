import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('offers sign out only to a signed-in visitor', () => {
    mount('/family')
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
  })

  it('lets a signed-in parent sign out', () => {
    auth.currentUser = { uid: 'p1' }
    mount('/family')
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(auth.logout).toHaveBeenCalledTimes(1)
  })
})
