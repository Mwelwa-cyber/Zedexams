/**
 * accountService — which deletion outcomes drop the local session.
 *
 * The bug (PURGE-003): the sign-out lived only on the success path. The server
 * destroys the Auth user BEFORE it touches Firestore, so `purge-failed`,
 * `purge-unverified` and `purge-incomplete` all reject for an account that no
 * longer exists — and the client kept the user sitting on the dashboard of a
 * deleted account until their ID token happened to expire, up to an hour later.
 *
 * The condition tested here is the server's `details.irreversible` flag rather
 * than a list of reason strings, so a fourth post-destructive failure added to
 * the flow cannot leave this branch silently wrong. Its counterpart —
 * "every failure past the point of no return carries the flag, and every
 * failure before it does not" — is in accountDeletionFlow.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const signOut = vi.fn(async () => {})
const callable = vi.fn()

vi.mock('firebase/auth', () => ({
  signOut: (...args) => signOut(...args),
  EmailAuthProvider: { credential: vi.fn() },
  GoogleAuthProvider: vi.fn(),
  reauthenticateWithCredential: vi.fn(async () => {}),
  reauthenticateWithPopup: vi.fn(async () => {}),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => (...args) => callable(...args)),
}))
vi.mock('../firebase/config', () => ({
  default: {},
  auth: {
    currentUser: {
      uid: 'u1',
      providerData: [{ providerId: 'google.com' }],
      // Re-auth forces a refresh so the fresh auth_time reaches the callable.
      getIdToken: async () => 'token',
    },
  },
}))

const { deleteMyAccount } = await import('./accountService')

/** A callable rejection, shaped as firebase/functions delivers one. */
function callableError(details) {
  const err = new Error('Your sign-in has been removed…')
  err.code = 'functions/internal'
  err.details = details
  return err
}

describe('deleteMyAccount — dropping an orphaned session', () => {
  beforeEach(() => {
    signOut.mockClear()
    callable.mockReset()
  })

  it('signs out on success', async () => {
    callable.mockResolvedValue({ data: { success: true } })
    await deleteMyAccount()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it.each(['purge-failed', 'purge-unverified', 'purge-incomplete'])(
    'signs out when the deletion fails past the point of no return (%s)',
    async (reason) => {
      // The account is GONE by the time these reject. Staying signed in leaves
      // the user on a dashboard belonging to an account that no longer exists.
      callable.mockRejectedValue(callableError({ reason, irreversible: true }))
      await expect(deleteMyAccount()).rejects.toThrow()
      expect(signOut).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['tombstone-failed', 'revoke-failed', 'auth-delete-failed'])(
    'stays signed in when the account is still intact (%s)',
    async (reason) => {
      // These tell the user to try again. Signing them out is the one thing
      // that would stop them — they would have to log back in first, and a
      // password account re-authenticates before the retry can even start.
      callable.mockRejectedValue(callableError({ reason }))
      await expect(deleteMyAccount()).rejects.toThrow()
      expect(signOut).not.toHaveBeenCalled()
    },
  )

  it('stays signed in when the rejection carries no details at all', async () => {
    // A network failure, an App Check rejection, an older server. Nothing
    // asserts the account was destroyed, so nothing here may assume it was.
    callable.mockRejectedValue(new Error('network request failed'))
    await expect(deleteMyAccount()).rejects.toThrow()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does not treat a truthy-but-not-true flag as irreversible', async () => {
    // Explicit `=== true`. `details` crosses a serialization boundary, and
    // "the string 'false'" is truthy.
    callable.mockRejectedValue(callableError({ reason: 'odd', irreversible: 'false' }))
    await expect(deleteMyAccount()).rejects.toThrow()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('surfaces the original error even when the sign-out itself fails', async () => {
    // The user needs the server's sentence about what happened to their data.
    // Losing it to a failed local sign-out would replace the only explanation
    // they get with a meaningless one.
    signOut.mockRejectedValueOnce(new Error('no network'))
    callable.mockRejectedValue(callableError({ reason: 'purge-failed', irreversible: true }))
    await expect(deleteMyAccount()).rejects.toThrow('Your sign-in has been removed')
  })

  it('returns success even when the sign-out fails', async () => {
    signOut.mockRejectedValueOnce(new Error('no network'))
    callable.mockResolvedValue({ data: { success: true } })
    await expect(deleteMyAccount()).resolves.toEqual({ success: true })
  })
})
