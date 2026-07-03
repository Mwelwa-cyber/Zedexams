import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import { useSchoolProfileForm } from '../lib/useSchoolProfileForm'
import { uploadBrandingAsset, deleteBrandingAsset } from '../lib/uploadBrandingAsset'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import OptionCards from '../components/fields/OptionCards'
import UploadField from '../components/fields/UploadField'
import { useSettingsSave } from '../lib/useSettingsSave'

// Document branding: the images placed onto exports (logo / letterhead — the
// teacher signature lives on the Teaching Identity panel), the footer line, and
// the default export format. Uploads save immediately; footer + format go
// through the Save bar.
export default function BrandingPanel() {
  const { userProfile, currentUser, updateProfileFields } = useAuth()
  const school = useSchoolProfileForm()
  const prefs = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const [exportFormat, setExportFormat] = useState(prefs.advanced.defaultDownloadFormat)
  const { run, saving, saved, error } = useSettingsSave()

  const dirty = useMemo(
    () => school.dirty || exportFormat !== prefs.advanced.defaultDownloadFormat,
    [school.dirty, exportFormat, prefs.advanced.defaultDownloadFormat],
  )

  const onSave = () =>
    run(async () => {
      if (school.dirty) await school.save()
      if (exportFormat !== prefs.advanced.defaultDownloadFormat) {
        const latest = normalizeTeacherPreferences(userProfile?.teacherPreferences)
        await updateProfileFields({
          teacherPreferences: {
            ...latest,
            advanced: { ...latest.advanced, defaultDownloadFormat: exportFormat },
          },
        })
      }
    })

  const makeUpload = (kind, urlKey, pathKey) => ({
    onUpload: async (file) => {
      const { url, path } = await uploadBrandingAsset(currentUser.uid, kind, file)
      await school.saveFields({ [urlKey]: url, [pathKey]: path })
    },
    onRemove: async () => {
      await deleteBrandingAsset(currentUser.uid, kind)
      await school.saveFields({ [urlKey]: '', [pathKey]: '' })
    },
  })

  return (
    <SettingsDetailShell
      rowId="branding"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Images</h2>
        <p className="tset-section__hint">
          Uploaded images are placed onto your generated documents. PNG with a
          transparent background works best for logos and letterheads.
        </p>
        <div style={{ display: 'grid', gap: 18 }}>
          <UploadField
            title="School logo"
            hint="Printed in the header of papers and plans."
            url={school.form.schoolLogoUrl}
            {...makeUpload('schoolLogo', 'schoolLogoUrl', 'schoolLogoPath')}
          />
          <UploadField
            title="Letterhead"
            hint="A full-width banner used at the top of formal documents."
            url={school.form.letterheadUrl}
            {...makeUpload('letterhead', 'letterheadUrl', 'letterheadPath')}
          />
        </div>
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Footer</h2>
        <div className="tset-grid">
          <FieldRow
            label="Document footer"
            htmlFor="br-footer"
            full
            help="A line printed at the bottom of generated documents (optional)."
          >
            <input
              id="br-footer"
              className="studio-input"
              type="text"
              value={school.form.footerText}
              onChange={(e) => school.patch({ footerText: e.target.value })}
              placeholder="e.g. Twatasha Primary School — Sciences Department"
              maxLength={300}
              disabled={school.loading}
            />
          </FieldRow>
        </div>
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Default export format</h2>
        <OptionCards
          label="Default export format"
          value={exportFormat}
          onChange={setExportFormat}
          options={[
            { value: 'pdf', title: 'PDF', hint: 'Print-ready, layout locked.' },
            { value: 'docx', title: 'Word', hint: 'Editable in Microsoft Word.' },
            { value: 'both', title: 'Both', hint: 'Offer PDF and Word every time.' },
          ]}
        />
      </section>
    </SettingsDetailShell>
  )
}
