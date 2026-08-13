import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

import {
  FieldNumberCombo,
  AdvancedOptions,
  GenerateButton,
  StudioEmptyState,
} from './studioFields'

// A small controlled wrapper so the combobox behaves like it does in a studio
// (parent owns the value, mirrors it back in via the `value` prop).
function Harness({ onChange, min = 5, max = 100, initial = 20 }) {
  const [value, setValue] = useState(initial)
  return (
    <FieldNumberCombo
      label="Total marks"
      value={value}
      min={min}
      max={max}
      options={[10, 20, 50].map((n) => ({ value: n, label: `${n} marks` }))}
      onChange={(v) => { setValue(v); onChange(v) }}
    />
  )
}

describe('FieldNumberCombo', () => {
  it('lets a teacher type a custom value the preset list does not offer', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '75' } })
    expect(onChange).toHaveBeenLastCalledWith(75)
  })

  it('does not prematurely clamp a partial entry on the way to a bigger number', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} min={5} max={100} />)
    const input = screen.getByRole('spinbutton')
    // Typing "100" arrives one digit at a time; "1" must not snap up to min(5)
    // and block the rest, and the field keeps showing what was typed.
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.change(input, { target: { value: '100' } })
    expect(input.value).toBe('100')
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('clamps an out-of-range value into [min, max] on blur', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} min={5} max={100} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '250' } })
    fireEvent.blur(input)
    expect(input.value).toBe('100')
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('falls back to min when the field is left empty', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} min={5} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(input.value).toBe('5')
    expect(onChange).toHaveBeenLastCalledWith(5)
  })
})

describe('AdvancedOptions', () => {
  it('hides its fields until the teacher opens it, then shows them', () => {
    render(
      <AdvancedOptions hint="Term, language">
        <span>Term field</span>
      </AdvancedOptions>,
    )
    const toggle = screen.getByRole('button', { name: /advanced options/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Term field')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Term field')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByText('Term field')).not.toBeInTheDocument()
  })

  it('starts open when defaultOpen is set', () => {
    render(
      <AdvancedOptions defaultOpen>
        <span>Term field</span>
      </AdvancedOptions>,
    )
    expect(screen.getByText('Term field')).toBeInTheDocument()
  })
})

describe('GenerateButton', () => {
  it('shows the call to action when idle', () => {
    render(<GenerateButton generating={false}>Generate Worksheet</GenerateButton>)
    const btn = screen.getByRole('button', { name: /generate worksheet/i })
    expect(btn).toBeEnabled()
  })

  it('disables itself and shows the generating label while running', () => {
    render(<GenerateButton generating generatingLabel="Writing notes…">Generate Notes</GenerateButton>)
    const btn = screen.getByRole('button', { name: /writing notes/i })
    expect(btn).toBeDisabled()
    expect(screen.queryByText('Generate Notes')).not.toBeInTheDocument()
  })

  it('honours an extra readiness condition via the disabled prop', () => {
    render(<GenerateButton generating={false} disabled>Generate Scheme of Work</GenerateButton>)
    expect(screen.getByRole('button', { name: /generate scheme of work/i })).toBeDisabled()
  })
})

describe('StudioEmptyState', () => {
  it('renders the title and helper copy', () => {
    render(
      <StudioEmptyState emoji="🐢" tone="#d8ecd0" title="Ready to make a worksheet">
        Pick the grade, subject and topic.
      </StudioEmptyState>,
    )
    expect(screen.getByText('Ready to make a worksheet')).toBeInTheDocument()
    expect(screen.getByText('Pick the grade, subject and topic.')).toBeInTheDocument()
  })
})
