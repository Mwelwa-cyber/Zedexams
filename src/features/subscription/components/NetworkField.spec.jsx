import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// lenco.js pulls in the Firebase callables; stub them so the real, pure
// detect/resolve operator logic can run under jsdom without booting Firebase.
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => () => ({ data: {} }),
}))
vi.mock('../../../firebase/config', () => ({ default: {} }))

import NetworkField from './NetworkField'

function setup(props = {}) {
  const onSelect = vi.fn()
  render(
    <NetworkField
      phone=""
      operator=""
      operatorTouched={false}
      onSelect={onSelect}
      {...props}
    />,
  )
  return { onSelect }
}

describe('NetworkField — automatic network detection', () => {
  it('prompts for a number before anything is typed (no dropdown)', () => {
    setup({ phone: '' })
    expect(screen.getByText(/detect your network automatically/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('auto-detects MTN from an 096 number and shows it confirmed', () => {
    setup({ phone: '0966 123 456' })
    expect(screen.getByText('MTN MoMo')).toBeInTheDocument()
    expect(screen.getByText(/detected/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('auto-detects Airtel (097) and Zamtel (095)', () => {
    const { unmount } = render(
      <NetworkField phone="0977 000 111" operator="" operatorTouched={false} onSelect={() => {}} />,
    )
    expect(screen.getByText('Airtel Money')).toBeInTheDocument()
    unmount()
    render(<NetworkField phone="0955 000 111" operator="" operatorTouched={false} onSelect={() => {}} />)
    expect(screen.getByText('Zamtel Kwacha')).toBeInTheDocument()
  })

  it('falls back to a manual dropdown when the prefix is unrecognised', () => {
    setup({ phone: '0900 000 000' })
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('lets the payer override the detected network via Change', () => {
    const { onSelect } = setup({ phone: '0966 123 456' })
    fireEvent.click(screen.getByRole('button', { name: /change/i }))
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'airtel' } })
    expect(onSelect).toHaveBeenCalledWith('airtel')
  })
})
