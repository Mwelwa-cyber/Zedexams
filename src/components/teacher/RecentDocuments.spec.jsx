import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RecentDocuments from './RecentDocuments'

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

function item(id, extra = {}) {
  return {
    id,
    kind: 'generation',
    tool: 'weekly_forecast',
    icon: '📅',
    title: `Doc ${id}`,
    typeLabel: 'Weekly Forecast',
    grade: 'G4',
    subject: 'integrated science',
    timeLabel: 'Created 2d ago',
    status: 'ready',
    to: `/teacher/library/${id}`,
    canRename: false,
    canDuplicate: true,
    raw: { id },
    ...extra,
  }
}

function renderRecent(props = {}) {
  return render(
    <MemoryRouter>
      <RecentDocuments
        items={props.items ?? [item('a')]}
        loading={props.loading ?? false}
        onDuplicate={props.onDuplicate ?? vi.fn()}
        onRename={props.onRename ?? vi.fn()}
        onDelete={props.onDelete ?? vi.fn()}
      />
    </MemoryRouter>,
  )
}

describe('RecentDocuments', () => {
  it('shows a loading skeleton and renders nothing when empty', () => {
    const { unmount } = renderRecent({ loading: true })
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()
    const { container } = renderRecent({ items: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders title, type/grade/subject meta, status and View all link', () => {
    renderRecent({ items: [item('a'), item('b', { status: 'draft', title: 'Draft doc' })] })
    expect(screen.getByRole('link', { name: 'Doc a' })).toHaveAttribute('href', '/teacher/library/a')
    expect(screen.getAllByText('Weekly Forecast · G4 · integrated science')).toHaveLength(2)
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', '/teacher/library')
  })

  it('opens the row menu with Open/Duplicate/Delete and honours capability flags', () => {
    renderRecent({ items: [item('a', { canDuplicate: false, canRename: false })] })
    fireEvent.click(screen.getByRole('button', { name: /actions for doc a/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute('href', '/teacher/library/a')
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('duplicates via the menu', () => {
    const onDuplicate = vi.fn()
    renderRecent({ onDuplicate })
    fireEvent.click(screen.getByRole('button', { name: /actions for doc a/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('renames inline for items that support it', async () => {
    const onRename = vi.fn(async () => {})
    renderRecent({ items: [item('a', { kind: 'assessment', canRename: true, canDuplicate: false })], onRename })
    fireEvent.click(screen.getByRole('button', { name: /actions for doc a/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: /new name for doc a/i })
    fireEvent.change(input, { target: { value: 'End of Term 2 Test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'End of Term 2 Test'),
    )
  })

  it('deletes only after the ConfirmDialog is confirmed', async () => {
    const onDelete = vi.fn(async () => {})
    renderRecent({ onDelete })
    fireEvent.click(screen.getByRole('button', { name: /actions for doc a/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' })))
  })
})
