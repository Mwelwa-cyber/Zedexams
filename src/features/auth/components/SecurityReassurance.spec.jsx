import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SecurityReassurance from './SecurityReassurance.jsx'

describe('SecurityReassurance', () => {
  it('renders the three trust items', () => {
    render(<SecurityReassurance />)
    expect(screen.getByText('Secure')).toBeInTheDocument()
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Trusted')).toBeInTheDocument()
    expect(screen.getByText('Your data is protected')).toBeInTheDocument()
    expect(screen.getByText('Built for teachers and learners')).toBeInTheDocument()
  })

  it('keeps the privacy claim narrow — never an absolute "we store nothing"', () => {
    render(<SecurityReassurance />)
    expect(screen.getByText('Your details stay private')).toBeInTheDocument()
    expect(screen.queryByText(/never store any data/i)).not.toBeInTheDocument()
  })
})
