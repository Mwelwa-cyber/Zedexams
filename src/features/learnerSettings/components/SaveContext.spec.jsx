// SaveContext — autosave status + undo lifecycle.
//
// Regression focus: the sticky bar keeps showing "Undo" through the
// "All changes saved" linger, so the undo snapshot must survive until the bar
// settles back to idle. Clearing it the moment a save landed left a visible
// Undo button that silently did nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const updateProfileFields = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    userProfile: { id: 'u1', displayName: 'Old Name' },
    updateProfileFields,
  }),
}))

import { SettingsSaveProvider, useSettingsSave } from './SaveContext'

function Harness() {
  const { status, canUndo, commit, undo } = useSettingsSave()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="can-undo">{String(canUndo)}</span>
      <button type="button" onClick={() => commit({ displayName: 'New Name' })}>edit</button>
      <button type="button" onClick={undo}>undo</button>
    </div>
  )
}

function renderHarness() {
  return render(
    <SettingsSaveProvider>
      <Harness />
    </SettingsSaveProvider>,
  )
}

// Run the debounce (750ms) + resolve the mocked write so status lands on 'saved'.
async function editAndSave() {
  fireEvent.click(screen.getByText('edit'))
  await act(async () => {
    vi.advanceTimersByTime(800)
  })
}

describe('SettingsSaveProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    updateProfileFields.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces a commit into one write and reports saved', async () => {
    renderHarness()
    expect(screen.getByTestId('status').textContent).toBe('idle')

    await editAndSave()

    expect(updateProfileFields).toHaveBeenCalledTimes(1)
    expect(updateProfileFields).toHaveBeenCalledWith({ displayName: 'New Name' })
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('can-undo').textContent).toBe('true')
  })

  it('undo still reverts during the "All changes saved" linger', async () => {
    renderHarness()
    await editAndSave()
    expect(screen.getByTestId('status').textContent).toBe('saved')

    // The bar still offers Undo here — clicking it must write the old value
    // back, not silently no-op.
    await act(async () => {
      fireEvent.click(screen.getByText('undo'))
    })

    expect(updateProfileFields).toHaveBeenCalledTimes(2)
    expect(updateProfileFields).toHaveBeenLastCalledWith({ displayName: 'Old Name' })
    expect(screen.getByTestId('can-undo').textContent).toBe('false')
  })

  it('ends the undo burst once the bar settles back to idle', async () => {
    renderHarness()
    await editAndSave()

    await act(async () => {
      vi.advanceTimersByTime(2000) // SAVED_LINGER_MS
    })
    expect(screen.getByTestId('status').textContent).toBe('idle')
    expect(screen.getByTestId('can-undo').textContent).toBe('false')

    // With the burst over, undo has nothing to revert — no extra write.
    await act(async () => {
      fireEvent.click(screen.getByText('undo'))
    })
    expect(updateProfileFields).toHaveBeenCalledTimes(1)
  })
})
