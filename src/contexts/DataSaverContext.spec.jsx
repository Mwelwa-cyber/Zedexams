/**
 * Behavioural tests for DataSaverContext.
 *
 * Data Saver mode is a global toggle for learners on limited mobile data —
 * it persists to localStorage and drives a body class (`data-saver`) that
 * CSS keys off to suppress images/animations. These lock the default,
 * persistence, restore-on-load, and body-class wiring. No Firebase.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { DataSaverProvider, useDataSaver } from './DataSaverContext'

const LS_KEY = 'examprep:dataSaver'

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
})

function DataSaverProbe() {
  const { dataSaver, toggleDataSaver } = useDataSaver()
  return (
    <div>
      <span data-testid="state">{String(dataSaver)}</span>
      <button onClick={toggleDataSaver}>toggle</button>
    </div>
  )
}

describe('DataSaverProvider', () => {
  it('defaults to off for a fresh visitor', () => {
    render(<DataSaverProvider><DataSaverProbe /></DataSaverProvider>)
    expect(screen.getByTestId('state').textContent).toBe('false')
    expect(document.body.classList.contains('data-saver')).toBe(false)
  })

  it('restores an ON preference from localStorage', () => {
    localStorage.setItem(LS_KEY, 'true')
    render(<DataSaverProvider><DataSaverProbe /></DataSaverProvider>)
    expect(screen.getByTestId('state').textContent).toBe('true')
    expect(document.body.classList.contains('data-saver')).toBe(true)
  })

  it('treats any non-"true" stored value as off', () => {
    localStorage.setItem(LS_KEY, 'yes')
    render(<DataSaverProvider><DataSaverProbe /></DataSaverProvider>)
    expect(screen.getByTestId('state').textContent).toBe('false')
  })

  it('toggle flips the state, persists it, and drives the body class', () => {
    render(<DataSaverProvider><DataSaverProbe /></DataSaverProvider>)

    act(() => { screen.getByText('toggle').click() })
    expect(screen.getByTestId('state').textContent).toBe('true')
    expect(localStorage.getItem(LS_KEY)).toBe('true')
    expect(document.body.classList.contains('data-saver')).toBe(true)

    act(() => { screen.getByText('toggle').click() })
    expect(screen.getByTestId('state').textContent).toBe('false')
    expect(localStorage.getItem(LS_KEY)).toBe('false')
    expect(document.body.classList.contains('data-saver')).toBe(false)
  })
})

describe('useDataSaver', () => {
  it('exposes the default shape when used without a provider', () => {
    // The context has a safe default value (no throw), so a bare consumer
    // still renders — assert that contract holds.
    function Bare() {
      const { dataSaver } = useDataSaver()
      return <span data-testid="bare">{String(dataSaver)}</span>
    }
    render(<Bare />)
    expect(screen.getByTestId('bare').textContent).toBe('false')
  })
})
