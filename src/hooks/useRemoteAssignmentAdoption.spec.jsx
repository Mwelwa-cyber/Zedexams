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

const SEED = { curriculum: 'cbc', grade: 'G5', subject: 'english' }

describe('useRemoteAssignmentAdoption', () => {
  it('delivers a validated remote change once, with id + seed', () => {
    const onAdopt = vi.fn()
    render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    fireRemote({ uid: 'u1', id: 'a2', seed: SEED })
    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(onAdopt).toHaveBeenCalledWith({ id: 'a2', seed: SEED })
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

  it('removes its listener on unmount', () => {
    const onAdopt = vi.fn()
    const { unmount } = render(<Harness uid="u1" currentId="a1" onAdopt={onAdopt} />)
    unmount()
    fireRemote({ uid: 'u1', id: 'a2', seed: SEED })
    expect(onAdopt).not.toHaveBeenCalled()
  })
})
