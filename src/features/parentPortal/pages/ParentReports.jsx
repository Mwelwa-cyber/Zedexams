/**
 * ParentReports — /family/reports. One report per child, per week.
 *
 * There is no archive of past weeks yet: reports are BUILT on request
 * from the child's last seven days rather than stored when the week
 * closes, so "last week" is not something we can render without
 * inventing it. The list therefore offers this week only, and says so.
 */
import useGuardianChildren from '../hooks/useGuardianChildren'
import { Link } from 'react-router-dom'
import { sortChildren, firstNameOf } from '../lib/parentAppView'
import { Empty, ErrorRetry, ListSkeleton, ParentHeader } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function ParentReports() {
  const { loading, error, children, reload } = useGuardianChildren()
  const ordered = sortChildren(children)

  return (
    <>
      <SeoHelmet title="Reports · ZedExams" noIndex />
      <ParentHeader />

      <div className="lhx-section-head">
        <h1 className="lhx-section-title">Weekly reports</h1>
      </div>

      {loading ? (
        <ListSkeleton rows={2} height={72} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={reload} />
      ) : ordered.length === 0 ? (
        <Empty icon="📈">
          Reports appear once you have linked a child.
        </Empty>
      ) : (
        ordered.map((child) => (
          <Link
            className="pax-rep-item"
            key={child.childUid}
            to={`/family/child/${child.childUid}/report`}
          >
            <span className="pax-rep-icon" aria-hidden="true">📈</span>
            <span className="pax-rep-main">
              <span className="pax-rep-title">
                {firstNameOf(child.displayName)} — this week
              </span>
              <span className="pax-rep-sub">
                What went well, where to focus, what to try next
              </span>
            </span>
            <span className="lhx-set-chev" aria-hidden="true">›</span>
          </Link>
        ))
      )}

      <p className="pax-note">
        📧 We also email you this report every Sunday. Turn it off in
        Account → Alerts.
        <br />
        Reports cover the last seven days — we do not keep an archive of
        earlier weeks yet.
      </p>
      <div style={{ height: 20 }} />
    </>
  )
}
