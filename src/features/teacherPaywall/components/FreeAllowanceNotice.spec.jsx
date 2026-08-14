import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FreeAllowanceNotice from './FreeAllowanceNotice'
import { PLAN_CATALOG_VERSION } from '../../../utils/teacherPlans'

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

const KEY = `zedexams:allowance-notice:${PLAN_CATALOG_VERSION}`

beforeEach(() => localStorage.clear())

describe('FreeAllowanceNotice', () => {
  it('shows once for free teachers and never for paid plans', () => {
    const { unmount } = render(<FreeAllowanceNotice plan="free" />)
    expect(screen.getByText(/free teacher allowance has increased/i)).toBeInTheDocument()
    unmount()
    const { container } = render(<FreeAllowanceNotice plan="pro" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('dismiss persists per catalogue revision', () => {
    const { unmount } = render(<FreeAllowanceNotice plan="free" />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss this notice/i }))
    expect(localStorage.getItem(KEY)).toBe('1')
    unmount()
    const { container } = render(<FreeAllowanceNotice plan="free" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('"View my allowance" fires the callback and also dismisses', () => {
    const onViewAllowance = vi.fn()
    render(<FreeAllowanceNotice plan="free" onViewAllowance={onViewAllowance} />)
    fireEvent.click(screen.getByRole('button', { name: /view my allowance/i }))
    expect(onViewAllowance).toHaveBeenCalledOnce()
    expect(localStorage.getItem(KEY)).toBe('1')
    expect(screen.queryByText(/allowance has increased/i)).not.toBeInTheDocument()
  })
})
