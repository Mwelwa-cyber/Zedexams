/**
 * Tests for ReimportDiffModal — guards the shared-focus-trap rewiring.
 *
 * The modal previously carried its own inline Escape handler and no focus
 * trap. It now delegates to useFocusTrap; these tests confirm the visible
 * contract survived the swap: it renders when open, Escape cancels, the
 * backdrop cancels, and it renders nothing when closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReimportDiffModal from './ReimportDiffModal'

const EMPTY_DIFF = { added: [], changed: [], unchanged: [], removed: [] }

function setup(props = {}) {
  const onCancel = vi.fn()
  const onMerge = vi.fn()
  const onReplace = vi.fn()
  render(
    <ReimportDiffModal
      open
      fileName="paper.pdf"
      diff={EMPTY_DIFF}
      onCancel={onCancel}
      onMerge={onMerge}
      onReplace={onReplace}
      {...props}
    />,
  )
  return { onCancel, onMerge, onReplace }
}

beforeEach(() => vi.clearAllMocks())

describe('ReimportDiffModal', () => {
  it('renders the dialog when open', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Re-import comparison' })).toBeInTheDocument()
    expect(screen.getByText('Re-import this document?')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    const { onCancel } = setup({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Escape via the shared focus trap', () => {
    const { onCancel } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels when the backdrop is clicked', () => {
    const { onCancel } = setup()
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
