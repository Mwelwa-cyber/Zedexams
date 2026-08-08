import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  BookOpen,
  Bug,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  FileText,
  Lightbulb,
  Mail,
  MessageCircle,
  MessageSquare,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import ContactDialog from '../../marketing/ContactDialog'
import FeedbackDialog from '../../feedback/FeedbackDialog'
import SeoHelmet from '../../seo/SeoHelmet'
import TopHeader from './TopHeader'
import useIsMobile from './useIsMobile'
import ensureDashboardFonts from './dashboardFonts'
import './dashboardV2.css'

ensureDashboardFonts()

// Same public support line the marketing page uses (Bonga answers inbound
// WhatsApp) — keep in sync with CONTACT_WHATSAPP_HREF in Marketing.jsx.
const WHATSAPP_HREF = 'https://wa.me/260977740465'

const FAQS = [
  {
    id: 'create',
    q: 'How do I create a lesson plan, test paper or homework activity?',
    a: 'Open the studio from the sidebar (or the Quick Create tiles on your dashboard), fill in the grade, subject and topic, and generate. You can edit every section before saving to your library.',
  },
  {
    id: 'export',
    q: 'How do I download my documents as PDF or Word?',
    a: 'Open any saved document from My Library — the export buttons (PDF / Word) are at the top of the document view. Test papers export from the Assessment Paper Studio with the same buttons.',
  },
  {
    id: 'library',
    q: 'Where are my saved documents?',
    a: 'Everything you create is saved to My Library (sidebar → Manage → My Library). Use the search box on the dashboard or the library filters to find a document.',
  },
  {
    id: 'free-plan',
    q: 'What can I do on the Free plan?',
    a: 'Free teachers get the Lesson Plan Studio; the other studios show read-only samples so you can see what they produce. Upgrading unlocks every studio and export.',
  },
  {
    id: 'pay',
    q: 'How do I upgrade or pay?',
    a: 'Go to Subscription in the sidebar. You can pay with MTN, Airtel or Zamtel mobile money, or a bank card — all in Kwacha. On the Android app you can also subscribe through Google Play.',
  },
  {
    id: 'teaching-profile',
    q: 'How do I change my grade or subject?',
    a: 'Your Teaching Profile drives what the dashboard and studios pre-fill. Change it under Settings → Teaching profile.',
  },
  {
    id: 'register',
    q: 'How do I mark attendance or manage my class register?',
    a: 'The Class Register lives under My Classes; daily attendance marking, the term grid and official A4 register printing are in its Attendance tab.',
  },
]

function FaqItem({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tdv2-faq">
      <button
        type="button"
        className="tdv2-faq-q"
        aria-expanded={open}
        aria-controls={`tdv2-faq-${item.id}`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={17} strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronRight size={17} strokeWidth={2} aria-hidden="true" />
        )}
        {item.q}
      </button>
      {open ? (
        <p className="tdv2-faq-a" id={`tdv2-faq-${item.id}`}>{item.a}</p>
      ) : null}
    </div>
  )
}

/**
 * Teacher Help & Support — /teacher/help. Every action works: the contact /
 * report forms write to contactMessages (triaged by the Echo support agent),
 * suggestions go to the feedback inbox, and WhatsApp/email are the real
 * support channels the marketing site advertises.
 *
 * Page content only — the sidebar, mobile chrome and logout come from
 * TeacherLayout, which this route renders inside.
 */
export default function HelpSupportPage() {
  const { settings } = usePlatformSettings()

  const supportEmail = settings?.supportEmail || 'support@zedexams.com'

  const [contactSource, setContactSource] = useState(null) // null | source string
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // Only decides which content container to use; the navigation around it is
  // the shell's at every width.
  const isMobile = useIsMobile()

  const channels = [
    {
      id: 'message',
      icon: Send,
      title: 'Send us a message',
      hint: 'Write to the support team from right here.',
      onClick: () => setContactSource('teacher-help-contact'),
    },
    {
      id: 'report',
      icon: Bug,
      title: 'Report a problem',
      hint: 'Something broken or looking wrong? Tell us.',
      onClick: () => setContactSource('teacher-help-report'),
    },
    {
      id: 'suggest',
      icon: Lightbulb,
      title: 'Suggest a feature',
      hint: 'Ideas land straight in our product inbox.',
      onClick: () => setFeedbackOpen(true),
    },
    {
      id: 'whatsapp',
      icon: MessageCircle,
      title: 'Chat on WhatsApp',
      hint: 'Message us on the ZedExams support line.',
      href: WHATSAPP_HREF,
    },
    {
      id: 'email',
      icon: Mail,
      title: 'Email support',
      hint: supportEmail,
      href: `mailto:${supportEmail}`,
    },
  ]

  return (
    <div className={isMobile ? 'tdv2m' : ''}>
      <SeoHelmet
        title="Help & Support | ZedExams Teachers"
        description="Get help with ZedExams teacher tools — contact support, report a problem, or browse FAQs."
        noIndex
      />

      <div className="tdv2-main">
        {!isMobile && <TopHeader termChip="" />}
        <main className={isMobile ? 'tdv2m-content' : 'tdv2-content'}>
          <section className="tdv2-card" aria-labelledby="tdv2-help-h">
            <h1 className="tdv2-help-title" id="tdv2-help-h">
              <CircleHelp size={26} strokeWidth={1.75} aria-hidden="true" />
              Help &amp; Support
            </h1>
            <p className="tdv2-help-sub">
              We’re here to help. Reach us in-app below, or email{' '}
              <a className="tdv2-help-mail" href={`mailto:${supportEmail}`}>{supportEmail}</a> any time.
            </p>

            <div className="tdv2-help-grid">
              {channels.map(({ id, icon: ChannelIcon, title, hint, onClick, href }) => {
                const inner = (
                  <>
                    <span className="tdv2-help-icon" aria-hidden="true">
                      <ChannelIcon size={20} strokeWidth={1.75} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="tdv2-help-item-title">{title}</span>
                      <span className="tdv2-help-item-hint">{hint}</span>
                    </span>
                  </>
                )
                return href ? (
                  <a key={id} className="tdv2-help-item" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                    {inner}
                  </a>
                ) : (
                  <button key={id} type="button" className="tdv2-help-item" onClick={onClick}>
                    {inner}
                  </button>
                )
              })}
            </div>
          </section>

          <div className="tdv2-row-2">
            <section className="tdv2-card" aria-labelledby="tdv2-faq-h">
              <div className="tdv2-card-head">
                <h2 className="tdv2-eyebrow" id="tdv2-faq-h">
                  <BookOpen size={17} strokeWidth={2} aria-hidden="true" />
                  Frequently asked questions
                </h2>
              </div>
              {FAQS.map((item) => <FaqItem key={item.id} item={item} />)}
            </section>

            <section className="tdv2-card" aria-labelledby="tdv2-help-links-h">
              <div className="tdv2-card-head">
                <h2 className="tdv2-eyebrow" id="tdv2-help-links-h">
                  <Sparkles size={17} strokeWidth={2} aria-hidden="true" />
                  More from ZedExams
                </h2>
              </div>
              <div className="tdv2-help-links">
                <Link className="tdv2-help-link" to="/teacher?tour=1">
                  <Compass size={17} strokeWidth={1.75} aria-hidden="true" />
                  Replay the dashboard tour
                </Link>
                <Link className="tdv2-help-link" to="/status">
                  <Activity size={17} strokeWidth={1.75} aria-hidden="true" />
                  System status
                </Link>
                <Link className="tdv2-help-link" to="/teacher/calendar">
                  <FileText size={17} strokeWidth={1.75} aria-hidden="true" />
                  School calendar (MoE terms)
                </Link>
                <Link className="tdv2-help-link" to="/company">
                  <MessageSquare size={17} strokeWidth={1.75} aria-hidden="true" />
                  About ZedExams
                </Link>
                <Link className="tdv2-help-link" to="/privacy">
                  <ShieldCheck size={17} strokeWidth={1.75} aria-hidden="true" />
                  Privacy Policy
                </Link>
                <Link className="tdv2-help-link" to="/terms">
                  <ScrollText size={17} strokeWidth={1.75} aria-hidden="true" />
                  Terms of Service
                </Link>
              </div>
            </section>
          </div>
        </main>
      </div>

      <ContactDialog
        open={!!contactSource}
        source={contactSource || 'teacher-help'}
        onClose={() => setContactSource(null)}
      />
      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        source="teacher-help"
      />
    </div>
  )
}
