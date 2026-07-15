import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import useRemoteAssignmentAdoption from './useRemoteAssignmentAdoption'
import { REMOTE_ACTIVE_ASSIGNMENT_EVENT } from '../utils/activeAssignmentSyncCore'

function Harness({ uid, currentId, onAdopt }) {
  useRemoteAssignmentAdoption(uid, currentId, onAdopt)
  return null
}

function fireRemote(detail) {
  act(() => {
    window.dispatchEvent(new CustomEvent(REMOTE_ACTIVE_ASSIGNMENT_EVENT, { detail }))
  })
}

function fireStorage(key, newValue) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
  })
}

const SEED = { curriculum: 'cbc', grade: 'G5', subject: 'english' }

describe('useRemoteAssignmentAdoption', () => {
  it('delivers a validated remote change once, with id + seed + source', () => {
    const onAdopt = vi.fn()
    render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    fireRemote({ uid: 'u1', id: 'a2', seed: SEED })
    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(onAdopt).toHaveBeenCalledWith({ id: 'a2', seed: SEED, source: 'remote' })
  })

  it('dedupes: an id the dashboard already shows never re-fires', () => {
    const onAdopt = vi.fn()
    const { rerender } = render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    fireRemote({ uid: 'u1', id: 'a1', seed: SEED })
    expect(onAdopt).not.toHaveBeenCalled()
    // After the dashboard adopts a2, a repeat event for a2 is also silent.
    rerender(<Harness uid="u1" currentId="a2" onAdopt={onAdopt} />)
    fireRemote({ uid: 'u1', id: 'a2', seed: SEED })
    expect(onAdopt).not.toHaveBeenCalled()
  })

  it('ignores events for another user, with no id, or with junk detail', () => {
    const onAdopt = vi.fn()
    render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    fireRemote({ uid: 'someone-else', id: 'a2', seed: SEED })
    fireRemote({ uid: 'u1', seed: SEED })
    fireRemote(null)
    expect(onAdopt).not.toHaveBeenCalled()
  })

  it('does nothing while signed out (null uid)', () => {
    const onAdopt = vi.fn()
    render(<Harness uid={null} currentId="" onAdopt={onAdopt} />)
    fireRemote({ uid: 'u1', id: 'a2', seed: SEED })
    expect(onAdopt).not.toHaveBeenCalled()
  })

  it('removes its listeners on unmount', () => {
    const onAdopt = vi.fn()
    const { unmount } = render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    unmount()
    fireRemote({ uid: 'u1', id: 'a2', seed: SEED })
    fireStorage('zedexams:prep-assignment:u1', 'a2')
    expect(onAdopt).not.toHaveBeenCalled()
  })

  // ── same-device cross-tab path (storage events) ──────────────────────────
  it('delivers another tab\'s pick as a cross-tab change (no seed)', () => {
    const onAdopt = vi.fn()
    render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    fireStorage('zedexams:prep-assignment:u1', 'a2')
    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(onAdopt).toHaveBeenCalledWith({ id: 'a2', seed: null, source: 'cross-tab' })
  })

  it('cross-tab dedupe: same id, other keys, and key removal are all silent', () => {
    const onAdopt = vi.fn()
    render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    fireStorage('zedexams:prep-assignment:u1', 'a1') // same as shown
    fireStorage('zedexams:prep-assignment:someone-else', 'a2') // another uid's key
    fireStorage('zedexams:active-seed:u1', '{"grade":"G5"}') // unrelated key
    fireStorage('zedexams:prep-assignment:u1', null) // key removed — never clear
    fireStorage('zedexams:prep-assignment:u1', '   ') // malformed/blank value
    expect(onAdopt).not.toHaveBeenCalled()
  })

  it('one change never processes twice when both paths report it', () => {
    const onAdopt = vi.fn()
    const { rerender } = render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    fireStorage('zedexams:prep-assignment:u1', 'a2')
    expect(onAdopt).toHaveBeenCalledTimes(1)
    // The dashboard adopts a2 (rerender with the new current id); the
    // Firestore echo for the same change then compares equal and is dropped.
    rerender(<Harness uid="u1" currentId="a2" onAdopt={onAdopt} />)
    fireRemote({ uid: 'u1', id: 'a2', seed: SEED })
    expect(onAdopt).toHaveBeenCalledTimes(1)
  })
})
