import { describe, it, expect } from 'vitest'
import { formatZambianPhoneInput, zambianPhoneDigits } from './phoneFormat'

describe('zambianPhoneDigits', () => {
  it('keeps a national number as typed', () => {
    expect(zambianPhoneDigits('0977740465')).toBe('0977740465')
  })
  it('strips spaces, dashes and letters', () => {
    expect(zambianPhoneDigits('0977 740-465abc')).toBe('0977740465')
  })
  it('converts a pasted +260 international number to national form', () => {
    expect(zambianPhoneDigits('+260977740465')).toBe('0977740465')
    expect(zambianPhoneDigits('+260 97 774 0465')).toBe('0977740465')
  })
  it('re-adds the trunk 0 to a 9-digit mobile form', () => {
    expect(zambianPhoneDigits('977740465')).toBe('0977740465')
    expect(zambianPhoneDigits('766123456')).toBe('0766123456')
  })
  it('caps at 10 digits so over-typing cannot grow the field', () => {
    expect(zambianPhoneDigits('09777404659999')).toBe('0977740465')
  })
  it('handles empty and garbage input', () => {
    expect(zambianPhoneDigits('')).toBe('')
    expect(zambianPhoneDigits(null)).toBe('')
    expect(zambianPhoneDigits('abc')).toBe('')
  })
  it('leaves partial input alone while typing', () => {
    expect(zambianPhoneDigits('0977')).toBe('0977')
  })
})

describe('formatZambianPhoneInput', () => {
  it('groups a full number 4-3-3', () => {
    expect(formatZambianPhoneInput('0977740465')).toBe('0977 740 465')
  })
  it('formats progressively while typing', () => {
    expect(formatZambianPhoneInput('0')).toBe('0')
    expect(formatZambianPhoneInput('0977')).toBe('0977')
    expect(formatZambianPhoneInput('09777')).toBe('0977 7')
    expect(formatZambianPhoneInput('0977740')).toBe('0977 740')
    expect(formatZambianPhoneInput('09777404')).toBe('0977 740 4')
  })
  it('formats a pasted international number', () => {
    expect(formatZambianPhoneInput('+260977740465')).toBe('0977 740 465')
  })
  it('is idempotent over its own output', () => {
    expect(formatZambianPhoneInput('0977 740 465')).toBe('0977 740 465')
  })
  it('returns empty string for empty input', () => {
    expect(formatZambianPhoneInput('')).toBe('')
  })
})
