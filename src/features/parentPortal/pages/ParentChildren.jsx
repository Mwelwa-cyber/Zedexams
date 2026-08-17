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
 */
import { useState } from 'react'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { redeemFamilyInviteCode } from '../services/familyPortal'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { sortChildren } from '../lib/parentAppView'
import ChildCard from '../components/ChildCard'
import { Empty, ErrorRetry, ListSkeleton, ParentHeader } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function ParentChildren() {
  const { loading, error, children, reload } = useGuardianChildren()
  const [code, setCode] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [linked, setLinked] = useState('')

  async function submit(e) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed || linking) return
    setLinking(true)
    setLinkError('')
    setLinked('')
    try {
      const child = await redeemFamilyInviteCode(trimmed)
      setLinked(child.learnerDisplayName || 'your child')
      setCode('')
      await reload()
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

      <h2 className="lhx-set-head">Add a child</h2>
      <form className="lhx-card" style={{ padding: 15 }} onSubmit={submit}>
        <label className="lhx-set-title" htmlFor="pax-code">Their family code</label>
        <p className="lhx-set-desc" style={{ marginBottom: 10 }}>
          Your child finds this in their app under Settings → Guardian. It is
          eight characters and expires after 60 days.
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
        {linked && <p className="pax-note" role="status">Linked {linked} ✓</p>}
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
