/**
 * ParentHome — /family. The guardian's dashboard: what needs them, how
 * each child is doing, and the way into the week's reports.
 *
 * Children are ordered by who needs attention first (see sortChildren) —
 * a parent opening the app should not have to read past the child who is
 * fine to find the one who is not.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { listGuardianApprovals } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { firstNameOf, greetingFor, sortChildren } from '../lib/parentAppView'
import ApprovalFeed from '../components/ApprovalFeed'
import ChildCard from '../components/ChildCard'
import { Empty, ErrorRetry, ListSkeleton, ParentHeader } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function ParentHome() {
  const { userProfile } = useAuth()
  const online = useNetworkStatus()
  const { loading, error, children, reload } = useGuardianChildren()
  const [approvals, setApprovals] = useState([])

  const loadApprovals = useCallback(async () => {
    try {
      setApprovals(await listGuardianApprovals())
    } catch (err) {
      // A failed approvals read must not take the dashboard down with
      // it: the children list is the more important half, and an empty
      // feed reads the same as "nothing pending" either way. It is
      // reported so a silent failure is still visible to us.
      reportClientError(err, 'parentApp.listGuardianApprovals')
    }
  }, [])

  useEffect(() => { loadApprovals() }, [loadApprovals])

  const firstName = firstNameOf(userProfile?.displayName) || 'there'
  const greeting = greetingFor(new Date().getHours())
  const ordered = sortChildren(children)

  return (
    <>
      <SeoHelmet title="Family · ZedExams" noIndex />
      <ParentHeader />

      <h1 className="pax-greet">{greeting}, <em>{firstName}</em> 👋</h1>
      <p className="pax-greet-sub">
        {children.length === 0 ?
          'Link a child to see how they are getting on.' :
          'Here is how your children are doing.'}
      </p>

      <ApprovalFeed
        approvals={approvals}
        onChange={loadApprovals}
        disabled={online === false}
      />

      <div className="lhx-section-head">
        <h2 className="lhx-section-title">Your children</h2>
        <Link className="lhx-see-all" to="/family/children">Manage</Link>
      </div>

      {loading ? (
        <ListSkeleton rows={2} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={reload} />
      ) : ordered.length === 0 ? (
        <Empty icon="👪">
          No children linked yet. Ask your child for their family code from
          Settings → Guardian, or invite them from the Children tab.
        </Empty>
      ) : (
        ordered.map((child, i) => (
          <ChildCard key={child.childUid} child={child} index={i} />
        ))
      )}

      {ordered.length > 0 && (
        <>
          <div className="lhx-section-head">
            <h2 className="lhx-section-title">This week</h2>
          </div>
          <Link className="pax-rep-item" to="/family/reports">
            <span className="pax-rep-icon" aria-hidden="true">📈</span>
            <span className="pax-rep-main">
              <span className="pax-rep-title">Weekly progress reports</span>
              <span className="pax-rep-sub">
                What went well, where to focus, and what to try next
              </span>
            </span>
            <span className="lhx-set-chev" aria-hidden="true">›</span>
          </Link>
        </>
      )}

      <div style={{ height: 20 }} />
    </>
  )
}
