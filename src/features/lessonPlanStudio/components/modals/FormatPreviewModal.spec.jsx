import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FormatPreviewModal } from './FormatPreviewModal'

function renderModal(props = {}) {
  const defaults = {
    format: 'modern',
    curriculumMode: 'cbc',
    advanced: {},
    onClose: vi.fn(),
    ...props,
  }
  return { ...render(<FormatPreviewModal {...defaults} />), onClose: defaults.onClose }
}

describe('FormatPreviewModal — visibility', () => {
  it('renders nothing when format is null', () => {
    const { container } = renderModal({ format: null })
    expect(container.firstChild).toBeNull()
  })

  it('renders a dialog when a format is given', () => {
    renderModal({ format: 'modern' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('FormatPreviewModal — title', () => {
  it('shows the Modern Clean title for the modern format', () => {
    renderModal({ format: 'modern' })
    expect(screen.getByText(/Modern Clean — preview/)).toBeInTheDocument()
  })

  it('shows the Official CBC title for the official format', () => {
    renderModal({ format: 'official' })
    expect(screen.getByText(/Official CBC — preview/)).toBeInTheDocument()
  })

  it('marks the previous-curriculum era in the title', () => {
    renderModal({ format: 'classic', curriculumMode: 'previous' })
    expect(screen.getByText(/Classic \(Previous 2013\) — preview/)).toBeInTheDocument()
  })
})

describe('FormatPreviewModal — sample content', () => {
  it('renders the CBC sample document', () => {
    const { container } = renderModal({ format: 'modern', curriculumMode: 'cbc' })
    expect(container.querySelector('.doc')).toBeInTheDocument()
    expect(container.textContent).toMatch(/Tourism/)
  })

  it('renders the previous-curriculum sample document', () => {
    const { container } = renderModal({ format: 'classic', curriculumMode: 'previous' })
    expect(container.textContent).toMatch(/Computer Career Opportunities/)
  })

  it('never renders a Key Vocabulary section (feature removed)', () => {
    const { container } = renderModal({
      format: 'modern',
      curriculumMode: 'cbc',
      advanced: { includeKeyVocabulary: true },
    })
    expect(container.textContent).not.toMatch(/Key Vocabulary/i)
  })
})

describe('FormatPreviewModal — close', () => {
  it('calls onClose when the close button is clicked', () => {
    const { onClose } = renderModal({ format: 'modern' })
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the scrim is clicked', () => {
    const { onClose } = renderModal({ format: 'modern' })
    fireEvent.click(screen.getByLabelText('Close preview'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderModal({ format: 'modern' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
