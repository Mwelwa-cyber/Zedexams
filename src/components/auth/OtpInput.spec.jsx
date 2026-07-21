import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import OtpInput from './OtpInput'

// Controlled wrapper so we exercise the real value flow.
function Harness({ onComplete }) {
  const [value, setValue] = useState('')
  return <OtpInput value={value} onChange={setValue} onComplete={onComplete} />
}

describe('OtpInput', () => {
  it('accepts digits only and strips letters/symbols', () => {
    render(<Harness />)
    const input = screen.getByLabelText(/six-digit verification code/i)
    fireEvent.change(input, { target: { value: '12a3-4' } })
    expect(input.value).toBe('1234')
  })

  it('limits input to 6 digits', () => {
    render(<Harness />)
    const input = screen.getByLabelText(/six-digit verification code/i)
    fireEvent.change(input, { target: { value: '1234567890' } })
    expect(input.value).toBe('123456')
  })

  it('supports paste (sanitises the pasted value)', () => {
    render(<Harness />)
    const input = screen.getByLabelText(/six-digit verification code/i)
    // A paste surfaces as a change event with the full pasted string.
    fireEvent.change(input, { target: { value: '  654 321 ' } })
    expect(input.value).toBe('654321')
  })

  it('fires onComplete once 6 digits are present', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const input = screen.getByLabelText(/six-digit verification code/i)
    fireEvent.change(input, { target: { value: '123' } })
    expect(onComplete).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '123456' } })
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('uses a numeric input mode + one-time-code autofill for mobile', () => {
    render(<Harness />)
    const input = screen.getByLabelText(/six-digit verification code/i)
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
  })
})
