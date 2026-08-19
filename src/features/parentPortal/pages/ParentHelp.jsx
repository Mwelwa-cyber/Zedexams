/**
 * ParentHelp — /family/help. The parent's own help surface, in the
 * family shell.
 *
 * The Account page reached help through a bare `mailto:`, with a comment
 * saying there was "no public help page to send a parent to". There is
 * one for teachers (/teacher/help) and there was none here, so a
 * guardian's only route out of a problem was composing an email in
 * whatever app their phone opens.
 *
 * Everything on this page is a channel that exists today. There is no
 * ticket form, because nothing would receive a ticket — a contact form
 * that posts nowhere is worse than an email address.
 */
import { Link } from 'react-router-dom'
import { BackRow } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

// Kept in step with HelpSupportPage.jsx and Marketing.jsx.
const WHATSAPP_HREF = 'https://wa.me/260977740465'
const SUPPORT_EMAIL = 'support@zedexams.com'
const CHILDLINE = '116'

const FAQ = [
  {
    q: 'How do I add my child?',
    a: 'Your child opens their own ZedExams app, goes to Settings → Guardian and reads you their family code. You type it on the Children tab. The code is single-use and short-lived, and your child confirms the link on their side before you can see anything.',
  },
  {
    q: 'Why can I not see my child’s answers?',
    a: 'You see how they are getting on — subjects, topics to work on, whether they have been practising. You do not see the contents of what they type, and neither do other learners. That is deliberate.',
  },
  {
    q: 'I paid, but my child is still locked.',
    a: 'Payments credit the child’s account, not yours, so check you picked the right child at checkout. If the payment shows under Account → Payments and their account is still locked, email us with the receipt number and we will fix it.',
  },
  {
    q: 'How do I stop the Sunday email?',
    a: 'Account → Alerts you receive → Weekly report. It stops immediately; nothing else changes.',
  },
]

function Row({ icon, title, desc, href, to }) {
  const inner = (
    <>
      <span className="lhx-set-ic" aria-hidden="true">{icon}</span>
      <span className="lhx-set-txt">
        <span className="lhx-set-title">{title}</span>
        <span className="lhx-set-desc">{desc}</span>
      </span>
      <span className="lhx-set-chev" aria-hidden="true">›</span>
    </>
  )
  if (to) return <Link className="lhx-set-row lhx-set-tap" to={to}>{inner}</Link>
  return (
    <a
      className="lhx-set-row lhx-set-tap"
      href={href}
      {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {inner}
    </a>
  )
}

export default function ParentHelp() {
  return (
    <>
      <SeoHelmet title="Help & support · ZedExams" noIndex />
      <BackRow title="Help &amp; support" subtitle="For guardians" to="/family/account" />

      <h2 className="lhx-set-head">Talk to us</h2>
      <div className="lhx-set-group">
        <Row
          icon="💬"
          title="WhatsApp"
          desc="Usually the fastest — weekdays, Zambian hours"
          href={WHATSAPP_HREF}
        />
        <Row
          icon="✉️"
          title="Email us"
          desc={SUPPORT_EMAIL}
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('ZedExams — parent account')}`}
        />
      </div>

      <h2 className="lhx-set-head">If a child is at risk</h2>
      <div className="lhx-set-group">
        <Row
          icon="☎️"
          title="Childline Zambia"
          desc={`Free, 24 hours · ${CHILDLINE}`}
          href={`tel:${CHILDLINE}`}
        />
        <Row
          icon="🛡️"
          title="How we keep children safe"
          desc="What we collect, and what we never do"
          href="/child-safety"
        />
      </div>

      <h2 className="lhx-set-head">Common questions</h2>
      <div className="lhx-set-group">
        {FAQ.map((item) => (
          <details className="pax-faq" key={item.q}>
            <summary className="pax-faq-q">{item.q}</summary>
            <p className="pax-faq-a">{item.a}</p>
          </details>
        ))}
      </div>

      <div style={{ height: 20 }} />
    </>
  )
}
