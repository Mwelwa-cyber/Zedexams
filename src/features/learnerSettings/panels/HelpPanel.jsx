// Help & Support — the prototype's view-help: a searchable FAQ, the contact
// rows (shared ContactDialog → contactMessages), the Childline Zambia 116
// safety row, and a rate-us button. Nothing here is a dead end: every row
// navigates, opens the contact form, dials, or links to an existing page.
//
// Two honesty rules shape the content:
// - Every FAQ answer describes what the app ACTUALLY does today — the
//   prototype's answers mention XP and full offline packs this build doesn't
//   have yet, so those claims are absent until they exist.
// - The rate-us button renders on the Android build only, where arriving via
//   the Play Store is what guarantees the listing exists to be rated. On the
//   web there is no store page to send anyone to.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import { isNativePlatform } from '../../../utils/runtime'
import { ContactDialog } from '../../marketing'
import { Panel, Section, Note, LinkRow } from '../components/ui'
import {
  Info, Mail, AlertTriangle, Lightbulb, ShieldCheck, DocumentTextIcon,
  Sparkles, Search, Smartphone, StarIcon,
} from '../../../shared/components/icons'

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.zedexams.android'

// Question + answer pairs, searched over both. Answers state only what the
// product does today (streaks and badges are real; grade filtering is real;
// offline is Firestore's cache + queued writes, not downloadable packs).
export const FAQS = [
  {
    q: 'How do points and streaks work?',
    a: 'You earn points from the daily quiz and games, and the leaderboard shows how you rank. Play every day to keep your streak — miss a day and it resets, but your badges always stay.',
  },
  {
    q: 'How do I unlock Premium?',
    a: 'Tap any locked feature and choose “Ask my guardian to unlock” — your grown-up gets the request and can pay with MTN, Airtel or Zamtel mobile money, or a card. Adults can also open Settings → Go Premium.',
  },
  {
    q: 'Is ZedExams safe for children?',
    a: 'Yes. There is no chatting anywhere on ZedExams — not between learners, and not with a bot — and guardians stay in charge of Premium.',
  },
  {
    q: 'Does it work when my connection drops?',
    a: 'Pages and notes you’ve already opened keep working, and anything you finish is saved and syncs when you’re back online. Payments need the internet.',
  },
  {
    q: 'Why do I only see my grade?',
    a: 'ZedExams shows your grade’s lessons, papers, quizzes and games so you practise exactly what your exams cover. If your grade is wrong, change it in Settings → Learning.',
  },
]

/** Case-insensitive AND-match of whitespace tokens over question + answer. */
export function filterFaqs(query, faqs = FAQS) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return faqs
  return faqs.filter((f) => {
    const hay = `${f.q} ${f.a}`.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
}

export default function HelpPanel({ section }) {
  const navigate = useNavigate()
  const { settings } = usePlatformSettings()
  const supportEmail = settings?.supportEmail || 'support@zedexams.com'
  const [contact, setContact] = useState(null) // null | source string
  const [query, setQuery] = useState('')

  const faqs = useMemo(() => filterFaqs(query), [query])

  return (
    <Panel section={section}>
      <Note tone="accent">
        We're here to help. Reach us in-app below, or email{' '}
        <strong><a className="lset-link" href={`mailto:${supportEmail}`}>{supportEmail}</a></strong> any time.
      </Note>

      <Section title="Popular questions">
        <div className="lset-search" style={{ marginBottom: 12 }}>
          <span className="lset-search__icon"><Search size={16} aria-hidden="true" /></span>
          <input
            type="search"
            placeholder="Search help…"
            aria-label="Search help"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {faqs.length === 0 ? (
          <Note>
            No answers match that — try another word, or message support below and
            we'll help directly.
          </Note>
        ) : (
          faqs.map((f) => (
            <details key={f.q} className="lset-faq">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))
        )}
      </Section>

      <Section title="Still need help?">
        <div className="lset-linklist">
          <LinkRow icon={Mail} title="Message support" hint="We usually reply within a day" onClick={() => setContact('settings-contact')} />
          <LinkRow icon={AlertTriangle} title="Report a problem" hint="Tell us what went wrong" onClick={() => setContact('settings-report')} />
          <LinkRow icon={Lightbulb} title="Suggest a feature" hint="Share an idea" onClick={() => setContact('settings-feature')} />
        </div>
      </Section>

      <Section title="Get help now" hint="If something is worrying you, you can always talk to someone.">
        <div className="lset-linklist">
          <LinkRow
            icon={Smartphone}
            title="Childline Zambia"
            hint="Call 116 — free and private"
            href="tel:116"
          />
        </div>
      </Section>

      {isNativePlatform() && (
        <Section title="Enjoying ZedExams?">
          <LinkRow
            icon={StarIcon}
            title="Rate us on Google Play"
            hint="It helps other learners find us"
            href={PLAY_STORE_URL}
          />
        </Section>
      )}

      <Section title="About ZedExams">
        <div className="lset-linklist">
          <LinkRow icon={Sparkles} title="About ZedExams" hint="Our mission and team" onClick={() => navigate('/company')} />
          <LinkRow icon={Info} title="Pricing & plans" hint="What Premium costs and covers" onClick={() => navigate('/pricing')} />
          <LinkRow icon={ShieldCheck} title="Privacy Policy" onClick={() => navigate('/privacy')} />
          <LinkRow icon={DocumentTextIcon} title="Terms of Service" onClick={() => navigate('/terms')} />
        </div>
      </Section>

      <ContactDialog open={!!contact} source={contact || 'settings-help'} onClose={() => setContact(null)} />
    </Panel>
  )
}
