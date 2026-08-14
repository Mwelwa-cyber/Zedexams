import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from './StatusBadge.jsx'

describe('StatusBadge', () => {
  // The classes are the SEMANTIC ones, not Tailwind's numbered scale: those
  // are a light-only palette, so the pills stayed light on Night wherever
  // they were rendered. The semantic tokens are redeclared per theme.
  it('renders the known statuses with their label + colour class', () => {
    const cases = [
      { status: 'draft', label: /Draft/, cls: 'theme-bg-subtle' },
      { status: 'pending', label: /Pending Review/, cls: 'bg-warning-subtle' },
      { status: 'published', label: /Published/, cls: 'bg-success-subtle' },
      { status: 'rejected', label: /Rejected/, cls: 'bg-danger-subtle' },
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
