// Profile panel — avatar studio + personal details. Text fields keep local
// state (so typing is smooth) and autosave via the SaveContext debounce;
// discrete fields commit straight through.

import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, Field, TextInput, SelectField } from '../components/ui'
import AvatarStudio from '../components/AvatarStudio'
import {
  GRADE_NUMBERS,
  GENDER_OPTIONS,
  LANGUAGE_OPTIONS,
  COUNTRY_OPTIONS,
} from '../lib/learnerPrefs'

// Headerless body — composed by MyAccountPanel (the "My Account" detail view)
// alongside the parent + account bodies. The default export keeps the standalone
// Panel wrapper for any direct use.
export function ProfileBody({ pushToast }) {
  const { userProfile, currentUser } = useAuth()
  const { commit } = useSettingsSave()

  const [form, setForm] = useState({
    displayName: '', preferredName: '', school: '', className: '', dateOfBirth: '',
  })

  // Initialise text fields once the profile arrives (keyed on uid so onSnapshot
  // updates from our own saves don't clobber in-progress typing).
  useEffect(() => {
    if (!userProfile) return
    setForm({
      displayName: userProfile.displayName ?? '',
      preferredName: userProfile.preferredName ?? '',
      school: userProfile.school ?? '',
      className: userProfile.className ?? '',
      dateOfBirth: userProfile.dateOfBirth ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, userProfile?.uid])

  const setText = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    commit({ [key]: value })
  }

  // Fails closed, deliberately, and by the same rule the pricing gate uses: a
  // learner is a minor unless `isMinor === false` positively says otherwise.
  // Not knowing must resolve to collecting LESS, not more.
  const isMinorLearner = (userProfile?.role ?? 'learner') === 'learner'
    && userProfile?.isMinor !== false

  return (
    <>
      <AvatarStudio profile={userProfile} commit={commit} pushToast={pushToast} />

      <Section title="Personal details" hint="Used across your dashboard, results and the parent view.">
        <div className="lset-grid">
          <Field label="Full name" htmlFor="lset-name">
            <TextInput
              id="lset-name"
              value={form.displayName}
              onChange={(v) => setText('displayName', v)}
              placeholder="Your full name"
              autoComplete="name"
            />
          </Field>
          <Field label="Preferred name" hint="What you'd like to be called (optional)" htmlFor="lset-preferred">
            <TextInput
              id="lset-preferred"
              value={form.preferredName}
              onChange={(v) => setText('preferredName', v)}
              placeholder="e.g. Chanda"
            />
          </Field>
          <Field label="School" htmlFor="lset-school">
            <TextInput
              id="lset-school"
              value={form.school}
              onChange={(v) => setText('school', v)}
              placeholder="e.g. Lusaka Academy"
              autoComplete="organization"
            />
          </Field>
          <Field label="Class" hint="Your stream or class (optional)" htmlFor="lset-class">
            <TextInput
              id="lset-class"
              value={form.className}
              onChange={(v) => setText('className', v)}
              placeholder="e.g. 7B"
            />
          </Field>
          <SelectField
            label="Grade"
            value={String(userProfile?.grade ?? GRADE_NUMBERS[0])}
            onChange={(v) => commit({ grade: Number(v) })}
            options={GRADE_NUMBERS.map((g) => ({ value: String(g), label: `Grade ${g}` }))}
          />
          {/* Date of birth is READ-ONLY, and that is a safety decision rather
              than a form-design one. Three things key off it — the age gate,
              whether a guardian's consent is required, and whether this
              account may be shown a price — and all three fail in the
              dangerous direction if a child can move it. A learner who edited
              their year of birth would be quoting themselves K50 and
              switching off the guardian requirement, by typing in a field
              marked "Optional".

              It is captured once at registration and changed only through
              support, where a human can ask why. Shown rather than hidden,
              because a child is entitled to see what we hold about them. */}
          <Field
            label="Date of birth"
            hint="Set when you signed up. Ask your grown-up or our team if it is wrong."
            htmlFor="lset-dob"
          >
            <TextInput id="lset-dob" type="date" value={form.dateOfBirth} disabled />
          </Field>
          {/* Gender is asked of adults only. We have no feature that reads it
              for a learner — it personalises nothing, filters nothing and
              appears on no screen — so collecting it from a child is data we
              hold for no reason, which is the one thing a minor's record must
              not contain. */}
          {!isMinorLearner && (
          <SelectField
            label="Gender"
            value={userProfile?.gender ?? ''}
            onChange={(v) => commit({ gender: v })}
            options={GENDER_OPTIONS}
          />
          )}
          <SelectField
            label="Preferred language"
            value={userProfile?.preferredLanguage ?? 'en'}
            onChange={(v) => commit({ preferredLanguage: v })}
            options={LANGUAGE_OPTIONS}
          />
          <SelectField
            label="Country"
            value={userProfile?.country ?? 'ZM'}
            onChange={(v) => commit({ country: v })}
            options={COUNTRY_OPTIONS}
          />
          <Field label="Email" hint="Change your sign-in email under Account." full htmlFor="lset-email">
            <TextInput id="lset-email" value={currentUser?.email ?? ''} disabled />
          </Field>
        </div>
      </Section>
    </>
  )
}

export default function ProfilePanel({ section, pushToast }) {
  return (
    <Panel section={section}>
      <ProfileBody pushToast={pushToast} />
    </Panel>
  )
}
