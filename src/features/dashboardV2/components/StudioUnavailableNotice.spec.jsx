import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import StudioUnavailableNotice from './StudioUnavailableNotice'

function LocationSink() {
  const { search } = useLocation()
  return <div data-testid="search">{search}</div>
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/teacher"
          element={<><StudioUnavailableNotice /><LocationSink /></>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StudioUnavailableNotice', () => {
  it('renders nothing without the parameter', () => {
    renderAt('/teacher')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing for a tool that is not gated', () => {
    // Guards against a hand-typed URL turning the dashboard into a billboard
    // for any string someone puts in the query.
    renderAt('/teacher?unavailable=lesson_plan')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('explains the retired Rubric Studio', () => {
    renderAt('/teacher?unavailable=rubric')
    expect(screen.getByRole('status')).toHaveTextContent('This tool is no longer available.')
  })

  it('explains that Worksheet Studio is coming back', () => {
    renderAt('/teacher?unavailable=worksheet')
    expect(screen.getByRole('status'))
      .toHaveTextContent('Worksheet Studio is being rebuilt and will return.')
  })

  it('consumes the parameter on dismiss so a back-navigation does not replay it', async () => {
    const user = userEvent.setup()
    renderAt('/teacher?unavailable=rubric&type=notes')
    await user.click(screen.getByRole('button', { name: 'Dismiss notice' }))
    expect(screen.queryByRole('status')).toBeNull()
    // Only the notice parameter goes — anything else on the URL is left alone.
    expect(screen.getByTestId('search').textContent).toBe('?type=notes')
  })
})
