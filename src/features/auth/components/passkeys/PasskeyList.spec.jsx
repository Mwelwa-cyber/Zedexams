import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PasskeyList from './PasskeyList.jsx'

const noop = () => {}

function passkey(overrides = {}) {
  return {
    id: 'credAAAAAAAAAAAAAAAA',
    name: 'Samsung phone',
    deviceType: 'multiDevice',
    backedUp: true,
    transports: ['internal'],
    createdAtMs: 1700000000000,
    lastUsedAtMs: null,
    status: 'active',
    ...overrides,
  }
}

describe('PasskeyList', () => {
  it('renders one credential as one row', () => {
    render(<PasskeyList passkeys={[passkey()]} onRename={noop} onRemove={noop} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('renders two credentials with IDENTICAL names as two rows (no dedup by name/email)', () => {
    // One account may hold several passkeys that look alike — the unique
    // credential id is the row key, never the friendly name.
    render(
      <PasskeyList
        passkeys={[
          passkey({ id: 'credAAAAAAAAAAAAAAAA' }),
          passkey({ id: 'credBBBBBBBBBBBBBBBB' }),
        ]}
        onRename={noop}
        onRemove={noop}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // Both rows expose independent remove actions addressed by name.
    expect(screen.getAllByRole('button', { name: 'Remove passkey Samsung phone' })).toHaveLength(2)
  })

  it('shows the empty state when there are no passkeys', () => {
    render(<PasskeyList passkeys={[]} onRename={noop} onRemove={noop} />)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(/No passkeys yet/)).toBeInTheDocument()
  })
})
