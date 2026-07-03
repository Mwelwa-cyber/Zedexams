import { useAuth } from '../../../contexts/AuthContext'
import { useSchoolProfileForm } from '../lib/useSchoolProfileForm'
import { uploadBrandingAsset, deleteBrandingAssetByPath } from '../lib/uploadBrandingAsset'
import SettingsDetailShell from '../components/SettingsDetailShell'
import SchoolProfileLoadError from '../components/SchoolProfileLoadError'
import FieldRow from '../components/fields/FieldRow'
import UploadField from '../components/fields/UploadField'
import { useSettingsSave } from '../lib/useSettingsSave'

// Document branding: the images placed onto exports (logo / letterhead) and
// the footer line. Uploads save immediately; the footer goes through the
// Save bar. (A "default export format" picker used to live here but
// controlled nothing — removed until exporters actually honour it.)
export default function BrandingPanel() {
  const { currentUser } = useAuth()
  const school = useSchoolProfileForm()
  const { run, saving, saved, error } = useSettingsSave()

  const blocked = school.loading || school.loadError
  const onSave = () => run(() => school.save())

  const makeUpload = (kind, urlKey, pathKey) => ({
    onUpload: async (file) => {
      const { url, path } = await uploadBrandingAsset(currentUser.uid, kind, file)
      // Old versions of a REPLACED asset are deliberately kept: saved papers
      // snapshot the download URL, and deleting the object would break their
      // exports. The whole prefix is swept on account deletion.
      await school.saveFields({ [urlKey]: url, [pathKey]: path })
    },
    onRemove: async () => {
      const currentPath = school.form[pathKey]
      await school.saveFields({ [urlKey]: '', [pathKey]: '' })
      // An explicit "Remove" means the teacher no longer wants the asset —
      // best-effort delete; papers that snapshot the URL keep rendering their
      // dashed placeholder if it 404s later.
      await deleteBrandingAssetByPath(currentPath).catch(() => null)
    },
  })

  return (
    <SettingsDetailShell
      rowId="branding"
      saveBar={{ onSave, saving, saved, error, dirty: school.dirty, disabled: !school.dirty || blocked }}
    >
      <SchoolProfileLoadError school={school} />

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
            disabled={blocked}
            {...makeUpload('schoolLogo', 'schoolLogoUrl', 'schoolLogoPath')}
          />
          <UploadField
            title="Letterhead"
            hint="A full-width banner used at the top of formal documents."
            url={school.form.letterheadUrl}
            disabled={blocked}
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
            help="A line printed at the bottom of generated papers (optional)."
          >
            <input
              id="br-footer"
              className="studio-input"
              type="text"
              value={school.form.footerText}
              onChange={(e) => school.patch({ footerText: e.target.value })}
              placeholder="e.g. Twatasha Primary School — Sciences Department"
              maxLength={300}
              disabled={blocked}
            />
          </FieldRow>
        </div>
      </section>
    </SettingsDetailShell>
  )
}
