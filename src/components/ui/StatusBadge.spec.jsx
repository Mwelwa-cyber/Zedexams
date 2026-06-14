import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from './StatusBadge.jsx'

describe('StatusBadge', () => {
  it('renders the known statuses with their label + colour class', () => {
    const cases = [
      { status: 'draft', label: /Draft/, cls: 'bg-gray-100' },
      { status: 'pending', label: /Pending Review/, cls: 'bg-yellow-100' },
      { status: 'published', label: /Published/, cls: 'bg-green-100' },
      { status: 'rejected', label: /Rejected/, cls: 'bg-red-100' },
    ]
    for (const { status, label, cls } of cases) {
      const { unmount } = render(<StatusBadge status={status} />)
      const el = screen.getByText(label)
      expect(el).toBeInTheDocument()
      expect(el).toHaveClass(cls)
      unmount()
    }
  })

  it('falls back to the raw status text for an unknown status', () => {
    render(<StatusBadge status="archived" />)
    expect(screen.getByText('archived')).toBeInTheDocument()
  })

  it('falls back to an em-dash when status is missing', () => {
    render(<StatusBadge />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
