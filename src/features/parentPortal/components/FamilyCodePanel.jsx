import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  createFamilyInviteCode,
  revokeFamilyInviteCode,
  listMyFamilyCodes,
  listMyLinkedParents,
  requestGuardianUnlink,
  respondToFamilyLink,
} from '../services/familyPortal'
import { reportClientError } from '../../../utils/clientErrorReporting'
import Button from '../../../shared/components/Button'

/**
 * FamilyCodePanel — learner-side control (mounted in learner settings). Lets a
 * learner generate a family code to give a parent, see the current code, rotate
 * or turn it off, and see + remove the parents currently linked to them.
 *
 * The code doc's own `revokedAt` / `expiresAt` are the source of truth; this
 * panel just surfaces the newest active code.
 *
 * ── The confirmation step lives here ────────────────────────────────
 *
 * Redeeming a code no longer makes anybody a guardian: it creates a
 * PENDING link, and this panel is where the child answers "is this your
 * grown-up?". That is deliberately on the CHILD's screen and not only in
 * a notification — the notification can be missed, dismissed or arrive on
 * a phone the child does not have, and the request has to be findable
 * afterwards by the person it is about.
 *
 * Nothing happens until they answer. A pending row is inert everywhere
 * else in the product (see functions/familyPortalCore.js isLinkActive), so
 * ignoring it is a safe outcome rather than a slow yes.
 */
function isCodeActive(codeDoc, nowMs) {
  if (!codeDoc || codeDoc.revokedAt) return false
  const expMs = codeDoc.expiresAt?.toMillis ? codeDoc.expiresAt.toMillis() : codeDoc.expiresAtMs
  if (typeof expMs === 'number' && expMs < nowMs) return false
  return true
}

/**
 * Links created before the confirmation step carry no `status`, and are
 * shown as confirmed guardians. Mirrors `isLinkActive` server-side, and
 * for the same reason — see its docblock. Kept as a one-line local rather
 * than imported from `functions/` because this file is a React component
 * and that package is CommonJS.
 */
function linkState(link) {
  if (!link?.status) return 'active'
  return link.status
}

export default function FamilyCodePanel() {
  const { currentUser } = useAuth()
  const [activeCode, setActiveCode] = useState(null)
  const [parents, setParents] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!currentUser?.uid) return
    try {
      const [codes, linked] = await Promise.all([
        listMyFamilyCodes(currentUser.uid),
        listMyLinkedParents(currentUser.uid),
      ])
      setActiveCode(codes.find((c) => isCodeActive(c, Date.now())) || null)
      setParents(linked)
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

  async function handleRespond(linkId, decision) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await respondToFamilyLink(linkId, decision)
      await load()
    } catch (err) {
      reportClientError(err, 'family.respondToFamilyLink')
      setError(err?.message || 'Could not save that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // ── A child ASKS; a child does not remove ──────────────────────────
  //
  // This used to delete the link document straight from the client. It
  // cannot, for two reasons that arrived together: `firestore.rules` now
  // denies every client write to `parentLinks` (so the delete would fail
  // at runtime), and the rule behind that is the point rather than an
  // obstacle — a child who can quietly drop supervision is a child who
  // can be TALKED INTO dropping it, by the person the supervision exists
  // to notice.
  //
  // So the ask is recorded, the guardian and support are told, and a
  // human decides. What pays for the delay is Childline 116, which needs
  // no guardian's permission and is one tap away on the Guardian panel
  // below. A child refusing a guardian they never confirmed is a
  // different thing and is still immediate — that is the decline button
  // on a pending row.
  async function handleAskToRemoveParent(parentUid) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await requestGuardianUnlink(parentUid)
      setNotice(res?.message || 'We have told your grown-up. Nobody has been removed yet.')
    } catch (err) {
      setError(err?.message || 'Could not send that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const pending = parents.filter((p) => linkState(p) === 'pending')
  const confirmed = parents.filter((p) => linkState(p) === 'active')

  return (
    <section className="theme-card rounded-2xl border theme-border p-4">
      <h2 className="text-sm font-black theme-text">Family &amp; parents</h2>
      <p className="mt-0.5 text-xs theme-text-muted">
        Share a family code so a parent or guardian can follow your progress. The
        code works once and lasts 2 days — you can make a new one any time, and
        nobody can see anything until you say yes.
      </p>

      {loading ? (
        <p className="mt-3 text-xs theme-text-muted">Loading…</p>
      ) : (
        <>
          {/* Current code */}
          <div className="mt-3">
            {activeCode ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl theme-bg-subtle px-3 py-3">
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider theme-text-muted">Your family code</p>
                  <p className="font-mono text-lg font-black tracking-[0.3em] theme-text">{activeCode.code}</p>
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

          {/* Somebody has used a code and is waiting on this child.
              Deliberately ABOVE the confirmed list: it is the only thing
              on this panel that needs an answer. */}
          {pending.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-black text-amber-900">
                {pending.length === 1 ?
                  'Someone wants to be your guardian' :
                  `${pending.length} people want to be your guardian`}
              </p>
              <ul className="mt-2 space-y-2">
                {pending.map((p) => (
                  <li key={p.id} className="rounded-lg bg-white/70 px-3 py-2">
                    <p className="text-sm font-bold text-amber-900">
                      {p.parentDisplayName || 'Someone'} wants to be your guardian
                      {p.parentEmail ? ` (${p.parentEmail})` : ''} — is this your grown-up?
                    </p>
                    <p className="mt-0.5 text-xs font-bold text-amber-800">
                      If you say yes they can see how you are getting on and change
                      what you can use. If you do not know them, say no.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleRespond(p.id, 'accept')}
                        disabled={busy}
                      >
                        Yes, that is my grown-up
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRespond(p.id, 'decline')}
                        disabled={busy}
                      >
                        No
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Confirmed guardians */}
          {confirmed.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider theme-text-muted">
                Linked parents ({confirmed.length})
              </p>
              <ul className="space-y-2">
                {confirmed.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-lg theme-bg-subtle px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold theme-text">
                      {p.parentDisplayName || 'A parent account'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAskToRemoveParent(p.parentUid)}
                      disabled={busy}
                      className="text-xs font-black text-rose-700 underline decoration-dotted disabled:opacity-50"
                    >
                      Ask to remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notice && (
            <p className="mt-2 rounded-lg border theme-border theme-bg-subtle px-3 py-2 text-xs font-bold theme-text">
              {notice}
            </p>
          )}

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
