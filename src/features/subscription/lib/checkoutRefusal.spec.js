import { describe, it, expect } from 'vitest'
import { checkoutRefusalMessage } from './checkoutRefusal'

const MESSAGE =
  'Ask your parent or guardian to check their messages and approve your account.'

describe('checkoutRefusalMessage', () => {
  it('returns the server message for a permission-denied refusal', () => {
    expect(checkoutRefusalMessage({ code: 'permission-denied', message: MESSAGE })).toBe(MESSAGE)
    expect(checkoutRefusalMessage({ code: 'functions/permission-denied', message: MESSAGE })).toBe(MESSAGE)
  })

  it('ignores every other failure, so a real fault keeps its ordinary wording', () => {
    for (const code of ['unavailable', 'internal', 'functions/internal', 'unauthenticated', 'failed-precondition', '']) {
      expect(checkoutRefusalMessage({ code, message: MESSAGE })).toBe('')
    }
  })

  it('returns nothing when there is no usable message', () => {
    expect(checkoutRefusalMessage({ code: 'permission-denied' })).toBe('')
    expect(checkoutRefusalMessage({ code: 'permission-denied', message: '   ' })).toBe('')
    expect(checkoutRefusalMessage({ code: 'permission-denied', message: 42 })).toBe('')
  })

  it('never throws on a non-error', () => {
    for (const value of [null, undefined, 'permission-denied', 0, {}, []]) {
      expect(checkoutRefusalMessage(value)).toBe('')
    }
  })

  it('clips an unreasonably long message', () => {
    const long = 'x'.repeat(5000)
    expect(checkoutRefusalMessage({ code: 'permission-denied', message: long }).length).toBe(300)
  })
})
