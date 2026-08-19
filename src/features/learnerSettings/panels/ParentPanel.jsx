// Parent / Guardian panel — contact details for the parent/guardian (autosaved
// to learnerSettings.parent) plus the real invite/share flow, which is owned
// entirely by ParentShareManager (mint link, copy, WhatsApp hand-off, revoke).

import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, Field, TextInput, SelectField, Note } from '../components/ui'
import { ParentShareManager, FamilyCodePanel, GuardianLinkPanel } from '../../parentPortal'
import { normalizeParentContact, RELATIONSHIP_OPTIONS } from '../lib/learnerPrefs'

// Headerless body — composed by MyAccountPanel; default keeps the Panel wrapper.
export function ParentBody() {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()

  const pc = normalizeParentContact(userProfile?.learnerSettings?.parent)

  const [form, setForm] = useState({ name: '', phone: '', email: '' })

  // Seed the free-text fields once the profile arrives (keyed on uid so our own
  // save round-trips don't clobber in-progress typing).
  useEffect(() => {
    if (!userProfile) return
    const seed = normalizeParentContact(userProfile.learnerSettings?.parent)
    setForm({ name: seed.name, phone: seed.phone, email: seed.email })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, userProfile?.uid])

  // Commit the whole normalized object so what we write reads back unchanged.
  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    const current = normalizeParentContact(userProfile?.learnerSettings?.parent)
    commit({ 'learnerSettings.parent': { ...current, [key]: value } })
  }

  const setRelationship = (value) => {
    const current = normalizeParentContact(userProfile?.learnerSettings?.parent)
    commit({ 'learnerSettings.parent': { ...current, relationship: value } })
  }

  return (
    <>
      <Section title="Parent details" hint="Who should we reach if you need help — or to share your progress.">
        <div className="lset-grid">
          <Field label="Parent / guardian name" htmlFor="lset-parent-name">
            <TextInput
              id="lset-parent-name"
              value={form.name}
              onChange={(v) => setField('name', v)}
              placeholder="e.g. Mrs. Banda"
              autoComplete="name"
            />
          </Field>
          <SelectField
            label="Relationship"
            value={pc.relationship}
            onChange={setRelationship}
            options={RELATIONSHIP_OPTIONS}
          />
          <Field label="Parent phone" hint="Mobile number (optional)" htmlFor="lset-parent-phone">
            <TextInput
              id="lset-parent-phone"
              type="tel"
              value={form.phone}
              onChange={(v) => setField('phone', v)}
              placeholder="e.g. 0977 123456"
              autoComplete="tel"
            />
          </Field>
          <Field label="Parent email" hint="Used for the weekly digest (optional)" htmlFor="lset-parent-email">
            <TextInput
              id="lset-parent-email"
              type="email"
              value={form.email}
              onChange={(v) => setField('email', v)}
              placeholder="e.g. parent@example.com"
              autoComplete="email"
            />
          </Field>
        </div>
        <Note>These details help us reach your parent or guardian and personalise the digest we send them.</Note>
      </Section>

      {/* Who is linked comes FIRST, above the code that creates a link.
          A child arriving at this screen because somebody typed their code
          needs to answer that before they are offered another one — and
          the ordering is also the honest one: what is true about your
          account now, then the thing that would change it. */}
      <Section title="Your grown-ups" hint="Who is linked to your account, and exactly what they can see.">
        <GuardianLinkPanel />
      </Section>

      <Section title="Connect a parent account" hint="Give your parent a family code so they can sign in and follow your progress from their own account.">
        <FamilyCodePanel />
      </Section>

      <Section title="Share your progress" hint="Send a read-only link so your parent can follow your results — never your password.">
        <Note tone="accent">
          Once connected, your parent can see: Results · Homework updates · Attendance ·
          Progress reports · School announcements.
        </Note>
        <ParentShareManager />
      </Section>
    </>
  )
}

export default function ParentPanel({ section }) {
  return (
    <Panel section={section}>
      <ParentBody />
    </Panel>
  )
}
