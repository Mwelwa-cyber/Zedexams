import { render, screen } from '@testing-library/react'
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
  render(<NetworkField phone="" {...props} />)
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
      <NetworkField phone="0977 000 111" />,
    )
    expect(screen.getByText('Airtel Money')).toBeInTheDocument()
    unmount()
    render(<NetworkField phone="0955 000 111" />)
    expect(screen.getByText('Zamtel Kwacha')).toBeInTheDocument()
  })

  it('shows an error, not a dropdown, when the prefix is unrecognised', () => {
    setup({ phone: '0900 000 000' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toMatch(/could not detect/i)
  })

  it('offers no way to override the detected network', () => {
    setup({ phone: '0966 123 456' })
    expect(screen.queryByRole('button', { name: /change/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
