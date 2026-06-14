import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useRef } from 'react'
import { ToastProvider, useToast } from './Toast.jsx'

// A tiny harness that exposes the toast API through buttons so tests can
// trigger it the way real surfaces do (inside the provider).
function Harness() {
  const toast = useToast()
  const lastId = useRef(null)
  return (
    <>
      <button onClick={() => { lastId.current = toast.error('Something broke') }}>fire-error</button>
      <button onClick={() => toast.success('Saved')}>fire-success</button>
      <button onClick={() => toast.dismiss(lastId.current)}>kill-last</button>
    </>
  )
}

const renderWithProvider = () =>
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  )

afterEach(() => {
  vi.useRealTimers()
})

describe('useToast / ToastProvider', () => {
  it('throws a helpful error when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Harness />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })

  it('shows an error toast with role="alert" and the message', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('fire-error'))
    const toast = screen.getByRole('alert')
    expect(toast).toHaveTextContent('Something broke')
  })

  it('shows a success toast with role="status"', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('fire-success'))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('auto-dismisses after the variant duration', () => {
    vi.useFakeTimers()
    renderWithProvider()
    fireEvent.click(screen.getByText('fire-error'))
    expect(screen.getByText('Something broke')).toBeInTheDocument()
    // Error toasts linger 6000ms (DEFAULT_DURATION.error).
    act(() => { vi.advanceTimersByTime(6000) })
    expect(screen.queryByText('Something broke')).not.toBeInTheDocument()
  })

  it('dismisses immediately via the close button', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('fire-error'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Something broke')).not.toBeInTheDocument()
  })

  it('dismisses by id via toast.dismiss()', () => {
    renderWithProvider()
    fireEvent.click(screen.getByText('fire-error'))
    expect(screen.getByText('Something broke')).toBeInTheDocument()
    fireEvent.click(screen.getByText('kill-last'))
    expect(screen.queryByText('Something broke')).not.toBeInTheDocument()
  })
})
