import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog.jsx'

const baseProps = {
  open: true,
  title: 'Delete quiz?',
  message: 'This cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Keep',
}

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="Delete quiz?" />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('renders an alertdialog with title, message and both actions when open', () => {
    render(<ConfirmDialog {...baseProps} onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Delete quiz?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
  })

  it('calls onConfirm / onCancel from the respective buttons', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...baseProps} onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels on a backdrop click', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog {...baseProps} onConfirm={() => {}} onCancel={onCancel} />,
    )
    // The outermost fixed container is the backdrop click target.
    fireEvent.mouseDown(container.firstChild)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape and backdrop while loading', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog {...baseProps} loading onConfirm={() => {}} onCancel={onCancel} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(container.firstChild)
    expect(onCancel).not.toHaveBeenCalled()
    // Cancel button is disabled while the action is in flight.
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled()
  })
})
