// Privacy panel — data sharing & personalisation, profile visibility, and an
// honest "coming soon" account-safety block. Discrete controls read from the
// normalized privacy prefs and commit the whole object on change; the real
// analytics/cookie consent is delegated to <AnalyticsConsentToggle /> (which
// owns its own localStorage decision, so we never reimplement it).

import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, Toggle, OptionCards, Note } from '../components/ui'
import { normalizePrivacyPrefs, PROFILE_VISIBILITY_OPTIONS } from '../lib/learnerPrefs'
import AnalyticsConsentToggle from '../../../components/ui/AnalyticsConsentToggle'

// Headerless body — composed by PrivacySecurityPanel; default keeps the Panel.
export function PrivacyBody() {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()

  const pv = normalizePrivacyPrefs(userProfile?.learnerSettings?.privacy)

  const set = (key, value) => {
    commit({ 'learnerSettings.privacy': { ...pv, [key]: value } })
  }

  return (
    <>
      <Note tone="accent">
        You're in control of what you share. These settings only affect your own
        account, and you can change them any time.
      </Note>

      <Section title="Data & personalisation" hint="Decide how your activity is used to improve your experience.">
        <Toggle
          title="Data sharing preferences"
          hint="Share anonymised usage to improve ZedExams"
          checked={pv.dataSharing}
          onChange={(v) => set('dataSharing', v)}
        />
        <Toggle
          title="Personalised recommendations"
          hint="Use my activity to suggest quizzes and lessons"
          checked={pv.personalisedRecommendations}
          onChange={(v) => set('personalisedRecommendations', v)}
        />
      </Section>

      <Section title="Analytics" hint="Manage cookie & analytics consent.">
        <AnalyticsConsentToggle />
      </Section>

      <Section title="Profile visibility" hint="Who can see your name and badges on leaderboards and in classes.">
        <OptionCards
          options={PROFILE_VISIBILITY_OPTIONS}
          value={pv.profileVisibility}
          onChange={(v) => set('profileVisibility', v)}
        />
      </Section>

      <Section title="Safety" hint="Manage people and reports linked to your account.">
        <div className="lset-toggle">
          <div className="lset-toggle__text">
            <p className="lset-toggle__title">Blocked users</p>
            <p className="lset-toggle__hint">People you've blocked from contacting you</p>
          </div>
          <span className="lset-soon">Coming soon</span>
        </div>
        <div className="lset-toggle">
          <div className="lset-toggle__text">
            <p className="lset-toggle__title">Report history</p>
            <p className="lset-toggle__hint">Reports you've submitted and their status</p>
          </div>
          <span className="lset-soon">Coming soon</span>
        </div>
        <Note>
          If something ever feels wrong, you can always contact support and we'll
          help. These management screens are coming soon.
        </Note>
      </Section>
    </>
  )
}

export default function PrivacyPanel({ section }) {
  return (
    <Panel section={section}>
      <PrivacyBody />
    </Panel>
  )
}
