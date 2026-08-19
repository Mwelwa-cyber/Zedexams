/**
 * FamilySharingPicker — /family/sharing. Which child's guardians?
 *
 * Co-guardianship is per CHILD, not per household: one parent can share
 * their eldest with a grandparent and keep the youngest to themselves,
 * and the invite email names the child it is about. So the sharing
 * screen needs a child, and reaching it from the account needed
 * somewhere to choose one.
 *
 * With exactly one child there is no choice to make, so this redirects
 * straight through — a picker with a single row is a screen that asks a
 * question with one answer.
 */

import { Link, Navigate } from 'react-router-dom'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { firstNameOf, sortChildren } from '../lib/parentAppView'
import { Avatar, BackRow, Empty, ErrorRetry, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function FamilySharingPicker() {
  const { loading, error, children, reload } = useGuardianChildren()
  const ordered = sortChildren(children)

  if (!loading && !error && ordered.length === 1) {
    return <Navigate to={`/family/sharing/${ordered[0].childUid}`} replace />
  }

  return (
    <>
      <SeoHelmet title="Family sharing · ZedExams" noIndex />
      <BackRow
        title="Family sharing"
        subtitle="Guardians are set per child"
        to="/family/account"
      />

      {loading ? (
        <ListSkeleton rows={2} height={72} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={reload} />
      ) : ordered.length === 0 ? (
        <Empty icon="🤝" action={{ label: 'Add a child', to: '/family/children' }}>
          Link a child first — then you can invite another guardian to help
          look after them.
        </Empty>
      ) : (
        <div className="lhx-set-group">
          {ordered.map((child, i) => (
            <Link
              className="lhx-set-row lhx-set-tap"
              key={child.childUid}
              to={`/family/sharing/${child.childUid}`}
            >
              <Avatar name={child.displayName} index={i} />
              <span className="lhx-set-txt">
                <span className="lhx-set-title" style={{ display: 'block' }}>
                  {firstNameOf(child.displayName) || 'Your child'}
                </span>
                <span className="lhx-set-desc" style={{ display: 'block' }}>
                  {child.guardianCount === 1 ?
                    'You are the only guardian' :
                    `${child.guardianCount} guardians`}
                </span>
              </span>
              <span className="lhx-set-chev" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      )}

      <p className="pax-note">
        Billing and account deletion always stay with the guardian who set the
        account up.
      </p>
      <div style={{ height: 20 }} />
    </>
  )
}
