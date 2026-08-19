/**
 * ParentAccount — /family/account. The parent's own profile, the alerts
 * they receive, their children, and the safety/help rows.
 *
 * The alert toggles write to the parent's own notification preferences
 * through the existing shared service — they are the guardian's
 * settings, not a child's, so nothing here goes through the guardian
 * controls path.
 */
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { Avatar, ParentHeader } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

const CHILDLINE = '116'

export default function ParentAccount() {
  const { userProfile, currentUser, logout } = useAuth()
  const navigate = useNavigate()
  const { children } = useGuardianChildren()

  async function signOut() {
    await logout()
    navigate('/login')
  }

  const childCount = children.length

  return (
    <>
      <SeoHelmet title="Account · ZedExams" noIndex />
      <ParentHeader />

      <div className="lhx-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <Avatar name={userProfile?.displayName} index={2} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 900, fontSize: 17 }}>{userProfile?.displayName || 'Parent'}</p>
          <p className="lhx-set-desc">
            {[currentUser?.email, childCount ? `${childCount} ${childCount === 1 ? 'child' : 'children'}` : null]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <h2 className="lhx-set-head">Plan &amp; billing</h2>
      <div className="lhx-set-group">
        <Link className="lhx-set-row lhx-set-tap" to="/family/plan">
          <span className="lhx-set-ic" aria-hidden="true">💳</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Subscription</span>
            <span className="lhx-set-desc">Plans, passes and what they cover</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
        <Link className="lhx-set-row lhx-set-tap" to="/family/account/billing">
          <span className="lhx-set-ic" aria-hidden="true">🧾</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Payments and receipts</span>
            <span className="lhx-set-desc">What you have paid, and for whom</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
      </div>

      <h2 className="lhx-set-head">Alerts you receive</h2>
      <div className="lhx-set-group">
        <Link className="lhx-set-row lhx-set-tap" to="/family/account/alerts">
          <span className="lhx-set-ic" aria-hidden="true">🔔</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Email and push alerts</span>
            <span className="lhx-set-desc">
              Weekly report, exam reminders, approval requests
            </span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
      </div>

      <h2 className="lhx-set-head">Children</h2>
      <div className="lhx-set-group">
        <Link className="lhx-set-row lhx-set-tap" to="/family/children">
          <span className="lhx-set-ic" aria-hidden="true">👪</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Manage children</span>
            <span className="lhx-set-desc">Progress, permissions and linking</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
        {/* Family sharing was built (invite a second guardian, owner vs
            can-view-and-approve) and reachable only from one child's
            detail screen, so a guardian who wanted to add their partner
            had to guess that it lived behind a child. It belongs on the
            account, where the rest of the household settings are. */}
        <Link className="lhx-set-row lhx-set-tap" to="/family/sharing">
          <span className="lhx-set-ic" aria-hidden="true">🤝</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Family sharing</span>
            <span className="lhx-set-desc">
              Invite another guardian. Billing and deletion stay with the owner.
            </span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
        {/* /child-safety promises a guardian can see, change and withdraw
            their consent. This is where that promise is kept in-product. */}
        <Link className="lhx-set-row lhx-set-tap" to="/family/account/consent">
          <span className="lhx-set-ic" aria-hidden="true">📝</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Guardian consent</span>
            <span className="lhx-set-desc">
              What you have approved for each child, and how to withdraw it
            </span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
      </div>

      <h2 className="lhx-set-head">Safety &amp; account</h2>
      <div className="lhx-set-group">
        <a className="lhx-set-row lhx-set-tap" href={`tel:${CHILDLINE}`}>
          <span className="lhx-set-ic" aria-hidden="true">☎️</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Get help</span>
            <span className="lhx-set-desc">Childline Zambia · {CHILDLINE}</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </a>
        {/* The one link out of /family/*, and deliberately so: this is the
            PUBLISHED child-safety standards document, the same URL named
            in the Play Console declaration, and it renders in the neutral
            legal layout — no learner navigation, no "signed in as"
            heading. A second copy inside the family shell would be a fork
            of a document a regulator reads back to you. */}
        <Link className="lhx-set-row lhx-set-tap" to="/child-safety">
          <span className="lhx-set-ic" aria-hidden="true">🛡️</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">How we keep children safe</span>
            <span className="lhx-set-desc">No child-to-child chat, and what we do collect</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
        {/* Was a bare mailto, on the reasoning that there was no help page
            to send a parent to. There is one now — /family/help, in this
            shell — carrying WhatsApp, the same email address, the Childline
            number and the questions guardians actually ask. That completes
            the rule the rest of this page already holds to: every row
            resolves to a /family/* route. */}
        <Link className="lhx-set-row lhx-set-tap" to="/family/help">
          <span className="lhx-set-ic" aria-hidden="true">❓</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Help &amp; support</span>
            <span className="lhx-set-desc">WhatsApp, email, and common questions</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
        <button type="button" className="lhx-set-row lhx-set-tap lhx-set-danger" onClick={signOut}>
          <span className="lhx-set-ic" aria-hidden="true">↩︎</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Sign out</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
      </div>

      <p className="lhx-set-footer">ZedExams · Parent 🇿🇲</p>
      <div style={{ height: 20 }} />
    </>
  )
}
