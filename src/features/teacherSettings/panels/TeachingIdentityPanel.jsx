import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherProfile } from '../../../utils/teacherSettingsCore'
import { TEACHER_QUALIFICATIONS, TEACHING_LANGUAGES } from '../../../config/zambia'
import { useSchoolProfileForm } from '../lib/useSchoolProfileForm'
import { uploadBrandingAsset, deleteBrandingAsset } from '../lib/uploadBrandingAsset'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import SelectField from '../components/fields/SelectField'
import ChipMultiSelect from '../components/fields/ChipMultiSelect'
import UploadField from '../components/fields/UploadField'
import { useSettingsSave } from '../lib/useSettingsSave'

function editable(profile) {
  return {
    tsNumber: profile.tsNumber,
    qualification: profile.qualification,
    yearsExperience: profile.yearsExperience,
    languages: profile.languages,
  }
}

// Professional identity: TS number, qualification, experience, languages of
// instruction, and the signature that prints on generated documents. The
// signature image lives with the other document branding on
// schoolProfiles/{uid} (exporters read that doc) and saves immediately.
export default function TeachingIdentityPanel() {
  const { userProfile, currentUser, updateProfileFields } = useAuth()
  const source = normalizeTeacherProfile(userProfile?.teacherProfile)
  const [form, setForm] = useState(() => editable(source))
  const { run, saving, saved, error } = useSettingsSave()
  const school = useSchoolProfileForm()

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(editable(source)),
    [form, source],
  )

  const onSave = () =>
    run(async () => {
      await updateProfileFields({
        teacherProfile: normalizeTeacherProfile({ ...userProfile?.teacherProfile, ...form }),
      })
    })

  // Signature persists straight to schoolProfiles (merge) on upload/remove.
  const onSignatureUpload = async (file) => {
    const { url, path } = await uploadBrandingAsset(currentUser.uid, 'teacherSignature', file)
    await school.saveFields({ teacherSignatureUrl: url, teacherSignaturePath: path })
  }
  const onSignatureRemove = async () => {
    await deleteBrandingAsset(currentUser.uid, 'teacherSignature')
    await school.saveFields({ teacherSignatureUrl: '', teacherSignaturePath: '' })
  }

  return (
    <SettingsDetailShell
      rowId="identity"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Professional details</h2>
        <div className="tset-grid">
          <FieldRow label="Teacher registration number" htmlFor="ti-ts" help="Your TS / TCZ registration number.">
            <input
              id="ti-ts"
              className="studio-input"
              type="text"
              value={form.tsNumber}
              onChange={(e) => setForm((f) => ({ ...f, tsNumber: e.target.value }))}
              placeholder="e.g. TS 123456"
              maxLength={40}
            />
          </FieldRow>
          <FieldRow label="Qualification" htmlFor="ti-qual">
            <SelectField
              id="ti-qual"
              value={form.qualification}
              onChange={(qualification) => setForm((f) => ({ ...f, qualification }))}
              options={TEACHER_QUALIFICATIONS}
              placeholder="Select qualification…"
            />
          </FieldRow>
          <FieldRow label="Years of experience" htmlFor="ti-exp">
            <input
              id="ti-exp"
              className="studio-input"
              type="number"
              min={0}
              max={60}
              value={form.yearsExperience ?? ''}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  yearsExperience: e.target.value === '' ? null : Number(e.target.value),
                }))
              }
              placeholder="e.g. 8"
            />
          </FieldRow>
          <FieldRow label="Languages you teach in" htmlFor="ti-langs" full>
            <ChipMultiSelect
              id="ti-langs"
              values={form.languages}
              onChange={(languages) => setForm((f) => ({ ...f, languages }))}
              options={TEACHING_LANGUAGES}
              searchable={false}
              maxValues={8}
            />
          </FieldRow>
        </div>
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Signature</h2>
        <p className="tset-section__hint">
          Printed on lesson plans and papers where a teacher signature is required.
          A photo of your signature on white paper works well — the background is kept transparent.
        </p>
        <UploadField
          title="Teacher signature"
          hint="PNG with transparency recommended."
          url={school.form.teacherSignatureUrl}
          onUpload={onSignatureUpload}
          onRemove={onSignatureRemove}
        />
      </section>
    </SettingsDetailShell>
  )
}
