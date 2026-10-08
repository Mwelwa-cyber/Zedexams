import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const native = vi.hoisted(() => ({ value: false }))
const share = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('../../utils/runtime.js', () => ({ isNativePlatform: () => native.value }))
vi.mock('@capacitor/share', () => ({ Share: { share } }))

import ShareWithParent from './ShareWithParent'

beforeEach(() => { native.value = false; share.mockClear() })

describe('ShareWithParent', () => {
  it('is a plain wa.me link on the web, with no phone number in it', () => {
    render(<ShareWithParent message={'Hello 👋\nzedexams.com'} />)
    const a = screen.getByTestId('share-with-parent')
    expect(a.getAttribute('href')).toBe(`https://wa.me/?text=${encodeURIComponent('Hello 👋\nzedexams.com')}`)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    fireEvent.click(a)
    expect(share).not.toHaveBeenCalled()
  })

  it('uses the native share sheet in the app', async () => {
    native.value = true
    render(<ShareWithParent message="Hi" />)
    fireEvent.click(screen.getByTestId('share-with-parent'))
    await vi.waitFor(() => expect(share).toHaveBeenCalledWith({ text: 'Hi', dialogTitle: 'Send to my parent' }))
  })

  it('still shares if the click callback throws', async () => {
    native.value = true
    render(<ShareWithParent message="Hi" onShare={() => { throw new Error('x') }} />)
    fireEvent.click(screen.getByTestId('share-with-parent'))
    await vi.waitFor(() => expect(share).toHaveBeenCalled())
  })
})
