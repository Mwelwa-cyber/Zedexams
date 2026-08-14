import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReadingSettingsSheet from './ReadingSettingsSheet'
import { DEFAULT_QUIZ_DISPLAY } from '../../utils/quizDisplayPrefs'

function setup(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    prefs: DEFAULT_QUIZ_DISPLAY,
    setPref: vi.fn(),
    resetPrefs: vi.fn(),
    saving: false,
    ...overrides,
  }
  render(<ReadingSettingsSheet {...props} />)
  return props
}

describe('ReadingSettingsSheet', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <ReadingSettingsSheet
        open={false}
        onClose={() => {}}
        prefs={DEFAULT_QUIZ_DISPLAY}
        setPref={() => {}}
        resetPrefs={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the dialog with title when open', () => {
    setup()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Reading Settings')).toBeInTheDocument()
  })

  it('calls setPref when a font size option is chosen', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    expect(props.setPref).toHaveBeenCalledWith('textSize', 'large')
  })

  it('calls setPref when a theme is chosen', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(props.setPref).toHaveBeenCalledWith('theme', 'dark')
  })

  it('reset button calls resetPrefs', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }))
    expect(props.resetPrefs).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the sheet', () => {
    const props = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('switches tabs to reveal layout toggles', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
    expect(screen.getByText('Wider answer spacing')).toBeInTheDocument()
  })
})
