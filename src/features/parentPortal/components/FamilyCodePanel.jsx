import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  createFamilyInviteCode,
  revokeFamilyInviteCode,
  listMyFamilyCodes,
} from '../services/familyPortal'
import { reportClientError } from '../../../utils/clientErrorReporting'
import Button from '../../../shared/components/Button'

/**
 * FamilyCodePanel — the learner mints, shows and turns off the code a
 * parent types to link themselves.
 *
 * The "linked parents" list USED to live here too, with a Remove button
 * that deleted the link document. Both moved to GuardianLinkPanel, and the
 * split is not cosmetic: this panel is about a credential the child hands
 * out, that one is about the people who hold it and what they can see.
 * Mixing them meant the child's answer to "who can see my results?" was a
 * row saying "A parent account" underneath a code they were being
 * encouraged to share.
 *
 * ── What a family code is now ────────────────────────────────────────
 *
 * Single-use, 48 hours, and typing it does NOT link anybody — it asks the
 * child to confirm. So the copy here says "expires soon" rather than
 * implying a standing code, and there is no revoke-in-a-panic path to
 * design around: a code that has been used is already spent.
 *
 * The code document's own `revokedAt` / `usedAt` / `expiresAt` are the
 * source of truth. `isCodeActive` mirrors familyPortalCore.familyCodeStatus
 * — including its fail-closed reading of a MISSING expiry, because a panel
 * that showed a code as live that the callable would refuse is how a child
 * reads a dead code down a phone line to their parent.
 */
function isCodeActive(codeDoc, nowMs) {
  if (!codeDoc || codeDoc.revokedAt || codeDoc.usedAt) return false
  const expMs = codeDoc.expiresAt?.toMillis ? codeDoc.expiresAt.toMillis() : codeDoc.expiresAtMs
  if (typeof expMs !== 'number' || Number.isNaN(expMs)) return false
  return expMs >= nowMs
}

/** "Expires in 5 hours" — the countdown that makes a 48-hour code legible. */
function expiryHint(codeDoc, nowMs) {
  const expMs = codeDoc?.expiresAt?.toMillis ? codeDoc.expiresAt.toMillis() : codeDoc?.expiresAtMs
  if (typeof expMs !== 'number') return null
  const hours = Math.max(0, Math.ceil((expMs - nowMs) / 3_600_000))
  return hours <= 1 ? 'Expires in less than an hour' : `Expires in ${hours} hours`
}

export default function FamilyCodePanel() {
  const { currentUser } = useAuth()
  const [activeCode, setActiveCode] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!currentUser?.uid) return
    try {
      const codes = await listMyFamilyCodes(currentUser.uid)
      setActiveCode(codes.find((c) => isCodeActive(c, Date.now())) || null)
    } catch (err) {
      reportClientError(err, 'family.learnerPanelLoad')
    } finally {
      setLoading(false)
    }
  }, [currentUser?.uid])

  useEffect(() => { load() }, [load])

  async function handleGenerate() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await createFamilyInviteCode()
      await load()
    } catch (err) {
      setError(err?.message || 'Could not create a code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke() {
    if (busy || !activeCode?.code) return
    setBusy(true)
    setError('')
    try {
      await revokeFamilyInviteCode(activeCode.code)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not turn off the code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="theme-card rounded-2xl border theme-border p-4">
      <h2 className="text-sm font-black theme-text">Family code</h2>
      <p className="mt-0.5 text-xs theme-text-muted">
        Give this code to a parent or guardian so they can follow your progress.
        It works once, and we will ask you to say yes before they can see
        anything.
      </p>

      {loading ? (
        <p className="mt-3 text-xs theme-text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-3">
            {activeCode ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl theme-bg-subtle px-3 py-3">
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider theme-text-muted">
                    Your family code
                  </p>
                  <p className="font-mono text-lg font-black tracking-[0.3em] theme-text">
                    {activeCode.code}
                  </p>
                  <p className="text-[11px] theme-text-muted">{expiryHint(activeCode, Date.now())}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={busy}>
                  New code
                </Button>
                <Button variant="ghost" size="sm" onClick={handleRevoke} disabled={busy}>
                  Turn off
                </Button>
              </div>
            ) : (
              <Button variant="primary" size="sm" onClick={handleGenerate} disabled={busy}>
                {busy ? 'Creating…' : 'Create a family code'}
              </Button>
            )}
          </div>

          {error && (
            <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
              ⚠️ {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
