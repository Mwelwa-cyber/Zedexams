// Help & Support — the detail view. Link rows to real destinations plus the
// shared ContactDialog (which writes to contactMessages) for Contact / Report /
// Feedback. Nothing here is a dead end: every row navigates, opens the contact
// form, or links to an existing page.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import { ContactDialog } from '../../marketing'
import { Panel, Section, Note, LinkRow } from '../components/ui'
import {
  Info, Mail, AlertTriangle, Lightbulb, ShieldCheck, DocumentTextIcon, Sparkles,
} from '../../../shared/components/icons'

export default function HelpPanel({ section }) {
  const navigate = useNavigate()
  const { settings } = usePlatformSettings()
  const supportEmail = settings?.supportEmail || 'support@zedexams.com'
  const [contact, setContact] = useState(null) // null | source string

  return (
    <Panel section={section}>
      <Note tone="accent">
        We're here to help. Reach us in-app below, or email{' '}
        <strong><a className="lset-link" href={`mailto:${supportEmail}`}>{supportEmail}</a></strong> any time.
      </Note>

      <Section title="Get help">
        <div className="lset-linklist">
          <LinkRow icon={Info} title="FAQs" hint="Answers to common questions" onClick={() => navigate('/pricing')} />
          <LinkRow icon={Mail} title="Contact support" hint="Message our team" onClick={() => setContact('settings-contact')} />
          <LinkRow icon={AlertTriangle} title="Report a problem" hint="Tell us what went wrong" onClick={() => setContact('settings-report')} />
          <LinkRow icon={Lightbulb} title="Suggest a feature" hint="Share an idea" onClick={() => setContact('settings-feature')} />
        </div>
      </Section>

      <Section title="About ZedExams">
        <div className="lset-linklist">
          <LinkRow icon={Sparkles} title="About ZedExams" hint="Our mission and team" onClick={() => navigate('/company')} />
          <LinkRow icon={ShieldCheck} title="Privacy Policy" onClick={() => navigate('/privacy')} />
          <LinkRow icon={DocumentTextIcon} title="Terms of Service" onClick={() => navigate('/terms')} />
        </div>
      </Section>

      <ContactDialog open={!!contact} source={contact || 'settings-help'} onClose={() => setContact(null)} />
    </Panel>
  )
}
