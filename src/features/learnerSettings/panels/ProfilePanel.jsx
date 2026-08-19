// Profile panel — avatar studio + personal details. Text fields keep local
// state (so typing is smooth) and autosave via the SaveContext debounce;
// discrete fields commit straight through.

import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, Field, TextInput, SelectField } from '../components/ui'
import AvatarStudio from '../components/AvatarStudio'
import { formatLongDate } from '../../../utils/ageAnswerCore'
import {
  GRADE_NUMBERS,
  GENDER_OPTIONS,
  LANGUAGE_OPTIONS,
  COUNTRY_OPTIONS,
} from '../lib/learnerPrefs'

/**
 * The account's date of birth, in words.
 *
 * An account created before the age screen has none, and so does a profile
 * `bootstrapUserProfile` recovered. Those say "Not set" rather than rendering
 * an empty box that reads as a field waiting to be filled in — the learner
 * cannot fill it in, and pretending otherwise is the same trap the editable
 * duplicate was.
 */
function formatDob(dob) {
  return formatLongDate(dob) || 'Not set'
}

// Headerless body — composed by MyAccountPanel (the "My Account" detail view)
// alongside the parent + account bodies. The default export keeps the standalone
// Panel wrapper for any direct use.
export function ProfileBody({ pushToast }) {
  const { userProfile, currentUser } = useAuth()
  const { commit } = useSettingsSave()

  const [form, setForm] = useState({
    displayName: '', preferredName: '', school: '', className: '',
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
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, userProfile?.uid])

  const setText = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    commit({ [key]: value })
  }

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
          {/* Read-only, and the reason is the whole age gate.
              `dob` is the single value the guardian-consent gate reads from —
              a learner who could change it could age themselves out of the
              restricted experience from their own settings page, which is the
              one outcome the neutral age screen exists to prevent.
              firestore.rules refuses the write regardless, so an editable
              field here would be a control that silently does nothing.

              It used to be worse than that: this field wrote `dateOfBirth`, a
              SECOND birthday on the same document that the gate never read. A
              child who corrected it reasonably believed they had changed their
              date of birth and had changed nothing. That field is gone and is
              blocklisted in the rules. */}
          <Field
            label="Date of birth"
            hint="Ask a grown-up or contact support to change this"
            htmlFor="lset-dob"
          >
            <TextInput id="lset-dob" value={formatDob(userProfile?.dob)} disabled />
          </Field>
          <SelectField
            label="Gender"
            value={userProfile?.gender ?? ''}
            onChange={(v) => commit({ gender: v })}
            options={GENDER_OPTIONS}
          />
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
