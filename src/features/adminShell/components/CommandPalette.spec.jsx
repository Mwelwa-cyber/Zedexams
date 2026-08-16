/**
 * Behaviour tests for the admin ⌘K palette.
 *
 * The ranking itself is covered by the pure `adminNavSearch.test.js`; what is
 * asserted here is what only a rendered component can show — that an action
 * with no route is dispatched rather than navigated, that pending counts
 * reach the rows, and that closing hands focus back to whatever opened it.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import CommandPalette from './CommandPalette'

const SECTIONS = [
  {
    label: 'Approvals',
    items: [
      { to: '/admin/approvals', label: 'Content queue', badgeKey: 'content', keywords: 'pending review' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/admin/payments', label: 'Payments', badgeKey: 'payments', keywords: 'billing refund lenco' },
    ],
  },
  {
    label: 'Account',
    items: [
      { command: 'logout', label: 'Sign out', keywords: 'logout exit', danger: true },
    ],
  },
]

function renderPalette(props = {}) {
  return render(
    <MemoryRouter>
      <CommandPalette open onClose={() => {}} sections={SECTIONS} {...props} />
    </MemoryRouter>,
  )
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    render(
      <MemoryRouter>
        <CommandPalette open={false} onClose={() => {}} sections={SECTIONS} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists every destination, including actions with no route', () => {
    renderPalette()
    expect(screen.getByText('Content queue')).toBeInTheDocument()
    expect(screen.getByText('Payments')).toBeInTheDocument()
    // The regression: the palette used to be handed the nav sections only,
    // so Sign out was in the sidebar but unreachable from ⌘K.
    expect(screen.getByText('Sign out')).toBeInTheDocument()
  })

  it('finds a page by a keyword that is not in its label', () => {
    renderPalette()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'refund' } })
    expect(screen.getByText('Payments')).toBeInTheDocument()
    expect(screen.queryByText('Content queue')).toBeNull()
  })

  it('matches tokens in any order', () => {
    renderPalette()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'queue content' } })
    expect(screen.getByText('Content queue')).toBeInTheDocument()
  })

  it('dispatches a command instead of navigating', () => {
    const onCommand = vi.fn()
    const onClose = vi.fn()
    renderPalette({ onCommand, onClose })
    fireEvent.click(screen.getByText('Sign out'))
    expect(onCommand).toHaveBeenCalledWith('logout')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows pending counts on the rows that carry a badge', () => {
    renderPalette({ badges: { content: 7, payments: 0 } })
    expect(screen.getByText('7')).toBeInTheDocument()
    // A zero count renders nothing rather than a "0" pill.
    expect(screen.queryByText('0')).toBeNull()
  })

  it('caps a large count at 99+', () => {
    renderPalette({ badges: { content: 250 } })
    expect(screen.getByText('99+')).toBeInTheDocument()
  })

  it('reports no matches for a query that hits nothing', () => {
    renderPalette()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzznope' } })
    expect(screen.getByText(/No matches/i)).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderPalette({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('wraps the highlight so ArrowUp from the top reaches the last row', () => {
    renderPalette()
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the highlighted row on Enter', () => {
    const onCommand = vi.fn()
    renderPalette({ onCommand })
    // Narrow to the action, then Enter without touching the mouse.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sign out' } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onCommand).toHaveBeenCalledWith('logout')
  })

  it('exposes the highlighted row through aria-activedescendant', async () => {
    renderPalette()
    const input = screen.getByRole('combobox')
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant'))
    const active = input.getAttribute('aria-activedescendant')
    expect(document.getElementById(active)).toHaveAttribute('aria-selected', 'true')
  })

  it('returns focus to the element that was focused before it opened', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { rerender } = render(
      <MemoryRouter>
        <CommandPalette open onClose={() => {}} sections={SECTIONS} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox')))

    rerender(
      <MemoryRouter>
        <CommandPalette open={false} onClose={() => {}} sections={SECTIONS} />
      </MemoryRouter>,
    )
    // Without this, Esc drops focus onto <body> and the next Tab restarts
    // from the top of the page.
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
