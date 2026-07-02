import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherProfile } from '../../../utils/teacherSettingsCore'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import PhotoUploadField from '../components/fields/PhotoUploadField'
import { useSettingsSave } from '../lib/useSettingsSave'

// Fields this panel edits (photo is saved separately by PhotoUploadField the
// moment it uploads, so it never rides along with a stale form value).
function editable(profile) {
  return { phone: profile.phone, bio: profile.bio }
}

export default function ProfilePanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const source = normalizeTeacherProfile(userProfile?.teacherProfile)
  const [displayName, setDisplayName] = useState(() => userProfile?.displayName || '')
  const [form, setForm] = useState(() => editable(source))
  const { run, saving, saved, error } = useSettingsSave()

  const dirty = useMemo(
    () =>
      displayName !== (userProfile?.displayName || '') ||
      JSON.stringify(form) !== JSON.stringify(editable(source)),
    [displayName, form, source, userProfile],
  )

  const onSave = () =>
    run(async () => {
      const name = displayName.trim().slice(0, 100)
      await updateProfileFields({
        ...(name && name !== userProfile?.displayName ? { displayName: name } : {}),
        // Merge over the LATEST stored map so photo fields saved by the
        // uploader (or another tab) are never clobbered.
        teacherProfile: normalizeTeacherProfile({ ...userProfile?.teacherProfile, ...form }),
      })
    })

  return (
    <SettingsDetailShell
      rowId="profile"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Photo</h2>
        <PhotoUploadField />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Personal information</h2>
        <div className="tset-grid">
          <FieldRow label="Full name" htmlFor="pf-name">
            <input
              id="pf-name"
              className="studio-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Mahenga Mwelwa"
              maxLength={100}
            />
          </FieldRow>
          <FieldRow label="Email" htmlFor="pf-email" help="Your sign-in email can't be changed here.">
            <input
              id="pf-email"
              className="studio-input"
              type="email"
              value={userProfile?.email || ''}
              disabled
              style={{ opacity: 0.65 }}
            />
          </FieldRow>
          <FieldRow label="Phone" htmlFor="pf-phone" help="Used on documents that ask for a contact number.">
            <input
              id="pf-phone"
              className="studio-input"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="e.g. 097 1234567"
              maxLength={20}
            />
          </FieldRow>
          <FieldRow label="Biography" htmlFor="pf-bio" full help="A short introduction — shown nowhere publicly, kept for your records.">
            <textarea
              id="pf-bio"
              className="studio-input"
              rows={4}
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="A few sentences about you and your teaching."
              maxLength={1000}
            />
          </FieldRow>
        </div>
      </section>
    </SettingsDetailShell>
  )
}
