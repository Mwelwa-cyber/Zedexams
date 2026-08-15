import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RecentDocuments from './RecentDocuments'

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

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
    actions: { canOpen: true, canRename: false, canDuplicate: true, canDownload: false, canTrash: false },
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

  it('menu offers only capability-approved actions — never Download, Delete or Trash', () => {
    renderRecent({
      items: [item('a', {
        actions: { canOpen: true, canRename: false, canDuplicate: false, canDownload: false, canTrash: false },
      })],
    })
    fireEvent.click(screen.getByRole('button', { name: /actions for doc a/i }))
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute('href', '/teacher/library/a')
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /download/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete|trash/i })).not.toBeInTheDocument()
    // The menu explains where exporting lives instead of faking a Download.
    expect(screen.getByText(/open this document to download or export it/i)).toBeInTheDocument()
  })

  it('duplicates via the menu with a visible progress state', async () => {
    let release
    const onDuplicate = vi.fn(() => new Promise((res) => { release = res }))
    renderRecent({ onDuplicate })
    fireEvent.click(screen.getByRole('button', { name: /actions for doc a/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(screen.getByText('Duplicating…')).toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.queryByText('Duplicating…')).not.toBeInTheDocument())
  })

  it('renames inline with validation for items that support it', async () => {
    const onRename = vi.fn(async () => {})
    renderRecent({
      items: [item('a', {
        kind: 'assessment',
        actions: { canOpen: true, canRename: true, canDuplicate: false, canDownload: false, canTrash: false },
      })],
      onRename,
    })
    fireEvent.click(screen.getByRole('button', { name: /actions for doc a/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: /new name for doc a/i })

    // Empty name is rejected with a visible problem, nothing submitted.
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a name/i)
    expect(onRename).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'End of Term 2 Test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'End of Term 2 Test'),
    )
  })
})
