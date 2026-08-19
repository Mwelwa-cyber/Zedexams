/**
 * ParentChildren — /family/children. The full list, plus the two ways to
 * add one.
 *
 * The existing family-code flow (a learner mints a code, the parent
 * redeems it) is kept as the primary path because it is built, tested
 * and live. The prototype's second door — "create a profile for a
 * younger child with a name and a PIN" — is NOT offered here, because
 * offering a button that cannot finish is worse than not offering it.
 * See the note in the card.
 *
 * ── Typing a code no longer links a child ───────────────────────────
 *
 * It sends a request. The child is asked "is this your grown-up?" and has
 * to say yes; until they do the link authorises nothing at all, so this
 * screen must not report success as "linked" — a parent told they are
 * connected and then shown an empty dashboard concludes the app is
 * broken, and the honest sentence ("waiting for them to confirm on their
 * phone") is also the one that tells them what to do next.
 *
 * Pending requests are read straight from `parentLinks` rather than from
 * `listGuardianChildren`, because that callable deliberately returns only
 * confirmed children — see functions/parentApp/index.js.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { listMyChildren, redeemFamilyInviteCode } from '../services/familyPortal'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { sortChildren } from '../lib/parentAppView'
import ChildCard from '../components/ChildCard'
import { Empty, ErrorRetry, ListSkeleton, ParentHeader } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function ParentChildren() {
  const { currentUser } = useAuth()
  const { loading, error, children, reload } = useGuardianChildren()
  const [code, setCode] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [requested, setRequested] = useState('')
  const [pending, setPending] = useState([])

  const loadPending = useCallback(async () => {
    if (!currentUser?.uid) return
    try {
      const links = await listMyChildren(currentUser.uid)
      setPending(links.filter((l) => l.status === 'pending'))
    } catch (err) {
      // A failed read here costs the "waiting to confirm" list and
      // nothing else, so it must not take the page down with it.
      reportClientError(err, 'parentApp.listPendingLinks')
    }
  }, [currentUser?.uid])

  useEffect(() => { loadPending() }, [loadPending])

  async function submit(e) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed || linking) return
    setLinking(true)
    setLinkError('')
    setRequested('')
    try {
      const result = await redeemFamilyInviteCode(trimmed)
      const name = result.learnerDisplayName || 'your child'
      // 'active' only when this parent was ALREADY a confirmed guardian
      // and simply re-entered a code — everything else waits on the child.
      setRequested(result.status === 'active' ?
        `${name} is linked ✓` :
        `Sent. ${name} needs to say yes on their own device — you will see them here once they do.`)
      setCode('')
      await Promise.all([reload(), loadPending()])
    } catch (err) {
      reportClientError(err, 'parentApp.redeemFamilyInviteCode')
      setLinkError(err?.message || 'Could not link that code. Please check it and try again.')
    } finally {
      setLinking(false)
    }
  }

  const ordered = sortChildren(children)

  return (
    <>
      <SeoHelmet title="Your children · ZedExams" noIndex />
      <ParentHeader />

      <div className="lhx-section-head">
        <h1 className="lhx-section-title">Your children</h1>
      </div>

      {loading ? (
        <ListSkeleton rows={2} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={reload} />
      ) : ordered.length === 0 ? (
        <Empty icon="👪">
          Nobody linked yet. Add your first child with their family code below.
        </Empty>
      ) : (
        ordered.map((child, i) => <ChildCard key={child.childUid} child={child} index={i} />)
      )}

      {pending.length > 0 && (
        <>
          <h2 className="lhx-set-head">Waiting to be confirmed</h2>
          <div className="lhx-set-group">
            {pending.map((link) => (
              <div className="lhx-set-row" key={link.id}>
                <span className="lhx-set-ic" aria-hidden="true">⏳</span>
                <span className="lhx-set-txt">
                  <span className="lhx-set-title" style={{ display: 'block' }}>
                    {link.learnerDisplayName || 'Your child'}
                  </span>
                  <span className="lhx-set-desc" style={{ display: 'block' }}>
                    They need to say yes in their own app, under Settings → Guardian.
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="lhx-set-head">Add a child</h2>
      <form className="lhx-card" style={{ padding: 15 }} onSubmit={submit}>
        <label className="lhx-set-title" htmlFor="pax-code">Their family code</label>
        <p className="lhx-set-desc" style={{ marginBottom: 10 }}>
          Your child finds this in their app under Settings → Guardian. It is
          eight characters, works once, and lasts 2 days. They will be asked to
          confirm it is you before you can see anything.
        </p>
        <input
          id="pax-code"
          className="pax-field"
          value={code}
          onChange={(e) => { setCode(e.target.value); setLinkError('') }}
          placeholder="e.g. K4M2P9RT"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          aria-invalid={linkError ? true : undefined}
        />
        <button type="submit" className="lhx-btn lhx-btn-primary lhx-btn-block" disabled={linking}>
          {linking ? 'Linking…' : 'Link this child'}
        </button>
        {linkError && <p className="lhx-error-text" role="alert">{linkError}</p>}
        {requested && <p className="pax-note" role="status">{requested}</p>}
      </form>

      <p className="pax-note">
        A child who is too young for their own account cannot be added yet —
        that profile type is still being built, and we would rather not offer
        a button that cannot finish.
      </p>

      <div style={{ height: 20 }} />
    </>
  )
}
