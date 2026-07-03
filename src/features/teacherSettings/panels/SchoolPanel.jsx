import { useAuth } from '../../../contexts/AuthContext'
import { ZAMBIAN_PROVINCES, SCHOOL_TYPES } from '../../../config/zambia'
import { useSchoolProfileForm } from '../lib/useSchoolProfileForm'
import SettingsDetailShell from '../components/SettingsDetailShell'
import SchoolProfileLoadError from '../components/SchoolProfileLoadError'
import FieldRow from '../components/fields/FieldRow'
import SelectField from '../components/fields/SelectField'
import { useSettingsSave } from '../lib/useSettingsSave'

// School identity — everything a Zambian school puts on an official document
// header. Saved to schoolProfiles/{uid}; the school NAME is also dual-written
// to users/{uid}.school because the Lesson Plan Studio (and the sidebar/hero)
// prefill from the profile field.
export default function SchoolPanel() {
  const { userProfile, updateProfileFields } = useAuth()
  const school = useSchoolProfileForm()
  const { run, saving, saved, error } = useSettingsSave()

  const dirty = school.dirty || false
  const blocked = school.loading || school.loadError

  const onSave = () =>
    run(async () => {
      const payload = await school.save()
      const name = payload.schoolName
      if (name && name !== userProfile?.school) {
        await updateProfileFields({ school: name })
      }
    })

  const f = school.form
  const set = (key) => (value) => school.patch({ [key]: value })
  const setText = (key) => (e) => school.patch({ [key]: e.target.value })

  return (
    <SettingsDetailShell
      rowId="school"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty || blocked }}
    >
      <SchoolProfileLoadError school={school} />
      <section className="tset-section">
        <h2 className="tset-section__title">School details</h2>
        <p className="tset-section__hint">
          These automatically populate the header of every generated document —
          lesson plans, test papers, schemes and reports.
        </p>
        <div className="tset-grid">
          <FieldRow label="School name" htmlFor="sc-name" full>
            <input
              id="sc-name"
              className="studio-input"
              type="text"
              value={f.schoolName}
              onChange={setText('schoolName')}
              placeholder="e.g. Twatasha Primary School"
              maxLength={200}
              disabled={blocked}
            />
          </FieldRow>
          <FieldRow label="EMIS number" htmlFor="sc-emis" help="Your school's EMIS registration number.">
            <input
              id="sc-emis"
              className="studio-input"
              type="text"
              value={f.emisNumber}
              onChange={setText('emisNumber')}
              placeholder="e.g. 8012345"
              maxLength={40}
              disabled={blocked}
            />
          </FieldRow>
          <FieldRow label="School type" htmlFor="sc-type">
            <SelectField
              id="sc-type"
              value={f.schoolType}
              onChange={set('schoolType')}
              options={SCHOOL_TYPES}
              placeholder="Select type…"
              disabled={blocked}
            />
          </FieldRow>
          <FieldRow label="Province" htmlFor="sc-province">
            <SelectField
              id="sc-province"
              value={f.province}
              onChange={set('province')}
              options={ZAMBIAN_PROVINCES}
              placeholder="Select province…"
              disabled={blocked}
            />
          </FieldRow>
          <FieldRow label="District" htmlFor="sc-district">
            <input
              id="sc-district"
              className="studio-input"
              type="text"
              value={f.district}
              onChange={setText('district')}
              placeholder="e.g. Chongwe"
              maxLength={80}
              disabled={blocked}
            />
          </FieldRow>
          <FieldRow label="School address" htmlFor="sc-address" full>
            <input
              id="sc-address"
              className="studio-input"
              type="text"
              value={f.address}
              onChange={setText('address')}
              placeholder="e.g. Plot 5, Great East Road, Lusaka"
              maxLength={300}
              disabled={blocked}
            />
          </FieldRow>
          <FieldRow label="Department" htmlFor="sc-dept" help="Shown on departmental documents (if your school uses them).">
            <input
              id="sc-dept"
              className="studio-input"
              type="text"
              value={f.department}
              onChange={setText('department')}
              placeholder="e.g. Social Sciences"
              maxLength={80}
              disabled={blocked}
            />
          </FieldRow>
          <FieldRow label="School motto" htmlFor="sc-motto">
            <input
              id="sc-motto"
              className="studio-input"
              type="text"
              value={f.motto}
              onChange={setText('motto')}
              placeholder="e.g. Knowledge is Light"
              maxLength={160}
              disabled={blocked}
            />
          </FieldRow>
        </div>
      </section>
    </SettingsDetailShell>
  )
}
