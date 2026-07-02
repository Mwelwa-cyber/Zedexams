import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import SettingsDetailShell from '../components/SettingsDetailShell'
import ToggleRow from '../components/fields/ToggleRow'
import OptionCards from '../components/fields/OptionCards'
import Icon from '../../../components/ui/Icon'
import { Settings, ChevronRight } from '../../../components/ui/icons'
import { useSettingsSave } from '../lib/useSettingsSave'

function editable(prefs) {
  return { ...prefs.advanced }
}

// Power-user options. The download format here is the same preference the
// Branding panel exposes (one source of truth:
// teacherPreferences.advanced.defaultDownloadFormat).
export default function AdvancedPanel() {
  const { userProfile, updateProfileFields, isAdminOnly } = useAuth()
  const source = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const [form, setForm] = useState(() => editable(source))
  const { run, saving, saved, error } = useSettingsSave()

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(editable(source)),
    [form, source],
  )

  const onSave = () =>
    run(async () => {
      const latest = normalizeTeacherPreferences(userProfile?.teacherPreferences)
      await updateProfileFields({
        teacherPreferences: { ...latest, advanced: { ...latest.advanced, ...form } },
      })
    })

  return (
    <SettingsDetailShell
      rowId="advanced"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Working</h2>
        <ToggleRow
          title="Autosave drafts"
          hint="Keep work-in-progress saved automatically in the studios that support it."
          checked={form.autosave}
          onChange={(autosave) => setForm((f) => ({ ...f, autosave }))}
        />
        <ToggleRow
          title="Offline mode"
          hint="Prefer cached content when your connection is slow or drops."
          checked={form.offlineMode}
          onChange={(offlineMode) => setForm((f) => ({ ...f, offlineMode }))}
        />
        <ToggleRow
          title="Performance mode"
          hint="Reduce visual effects for smoother scrolling on older devices."
          checked={form.performanceMode}
          onChange={(performanceMode) => setForm((f) => ({ ...f, performanceMode }))}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Downloads</h2>
        <OptionCards
          label="Default download format"
          value={form.defaultDownloadFormat}
          onChange={(defaultDownloadFormat) => setForm((f) => ({ ...f, defaultDownloadFormat }))}
          options={[
            { value: 'pdf', title: 'PDF', hint: 'Print-ready, layout locked.' },
            { value: 'docx', title: 'Word', hint: 'Editable in Microsoft Word.' },
            { value: 'both', title: 'Both', hint: 'Offer PDF and Word every time.' },
          ]}
        />
      </section>

      {isAdminOnly && (
        <section className="tset-card" style={{ marginBottom: 16 }}>
          <Link to="/admin" className="tset-row">
            <span className="tset-row__badge tset-row__badge--slate">
              <Icon as={Settings} size="sm" />
            </span>
            <span className="tset-row__text">
              <p className="tset-row__title">Developer options</p>
              <p className="tset-row__desc">Platform administration, logs and agent operations</p>
            </span>
            <ChevronRight size={16} className="tset-row__chevron" />
          </Link>
        </section>
      )}
    </SettingsDetailShell>
  )
}
