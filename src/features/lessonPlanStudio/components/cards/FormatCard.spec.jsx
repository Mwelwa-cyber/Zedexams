import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FormatCard } from './FormatCard'

function renderCard(props = {}) {
  const defaults = {
    formatId: 'modern',
    label: 'Modern Clean',
    selected: false,
    onSelect: vi.fn(),
    previewSrc: '/studio/previews/modern-preview.png',
    ...props,
  }
  return { ...render(<FormatCard {...defaults} />), onSelect: defaults.onSelect, onPreview: defaults.onPreview }
}

// The card root is a <div> wrapper (selecting and previewing are two distinct
// buttons; a button can't nest another button). The select button is the one
// that carries the label + thumbnail.
const selectButton = (label = 'Modern Clean') => screen.getByText(label).closest('button')

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('FormatCard — rendering', () => {
  it('renders the label text', () => {
    renderCard({ label: 'Classic' })
    expect(screen.getByText('Classic')).toBeInTheDocument()
  })

  it('renders an img with the correct alt text', () => {
    renderCard({ label: 'Modern Clean' })
    expect(screen.getByAltText('Modern Clean format preview')).toBeInTheDocument()
  })

  it('img alt combines label and "format preview"', () => {
    renderCard({ label: 'Official CBC' })
    expect(screen.getByAltText('Official CBC format preview')).toBeInTheDocument()
  })

  it('img src matches the previewSrc prop', () => {
    renderCard({ previewSrc: '/studio/previews/classic-preview.png', label: 'Classic' })
    const img = screen.getByAltText('Classic format preview')
    expect(img).toHaveAttribute('src', '/studio/previews/classic-preview.png')
  })

  it('select control is a <button> with type="button"', () => {
    renderCard()
    const btn = selectButton()
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('type', 'button')
  })
})

// ── aria-pressed ──────────────────────────────────────────────────────────────

describe('FormatCard — aria-pressed', () => {
  it('aria-pressed is "false" when selected=false', () => {
    renderCard({ selected: false })
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false')
  })

  it('aria-pressed is "true" when selected=true', () => {
    renderCard({ selected: true })
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true')
  })
})

// ── Selected / unselected border classes ──────────────────────────────────────

describe('FormatCard — selected state styles', () => {
  it('applies blue border class when selected', () => {
    const { container } = renderCard({ selected: true })
    expect(container.firstChild.className).toMatch(/border-blue-500/)
  })

  it('applies ring class when selected', () => {
    const { container } = renderCard({ selected: true })
    expect(container.firstChild.className).toMatch(/ring-1/)
  })

  it('applies muted border when not selected', () => {
    const { container } = renderCard({ selected: false })
    expect(container.firstChild.className).toMatch(/border-\[#d9cfbe\]/)
  })

  it('does NOT apply blue border when not selected', () => {
    const { container } = renderCard({ selected: false })
    expect(container.firstChild.className).not.toMatch(/border-blue-500/)
  })
})

// ── onSelect ──────────────────────────────────────────────────────────────────

describe('FormatCard — interaction', () => {
  it('calls onSelect when the select button is clicked', () => {
    const { onSelect } = renderCard()
    fireEvent.click(selectButton())
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not call onSelect when not clicked', () => {
    const { onSelect } = renderCard()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onSelect again on each additional click', () => {
    const { onSelect } = renderCard()
    fireEvent.click(selectButton())
    fireEvent.click(selectButton())
    expect(onSelect).toHaveBeenCalledTimes(2)
  })
})

// ── Preview button ────────────────────────────────────────────────────────────

describe('FormatCard — preview', () => {
  it('renders a Preview button when onPreview is provided', () => {
    renderCard({ label: 'Classic', onPreview: vi.fn() })
    expect(screen.getByLabelText('Preview Classic format')).toBeInTheDocument()
  })

  it('does NOT render a Preview button when onPreview is omitted', () => {
    renderCard({ label: 'Classic' })
    expect(screen.queryByLabelText('Preview Classic format')).not.toBeInTheDocument()
  })

  it('calls onPreview (not onSelect) when the Preview button is clicked', () => {
    const onPreview = vi.fn()
    const { onSelect } = renderCard({ label: 'Classic', onPreview })
    fireEvent.click(screen.getByLabelText('Preview Classic format'))
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

// ── formatId data attribute ───────────────────────────────────────────────────

describe('FormatCard — formatId', () => {
  it('exposes data-format-id attribute matching formatId prop', () => {
    const { container } = renderCard({ formatId: 'official' })
    expect(container.firstChild).toHaveAttribute('data-format-id', 'official')
  })
})
