import { useAuth } from '../../../contexts/AuthContext'
import { useTeacherUsage, FEATURE_LABELS } from '../../../hooks/useTeacherUsage'
import { normalizeTeacherPreferences } from '../../../utils/teacherSettingsCore'
import SettingsDetailShell from '../components/SettingsDetailShell'
import ToggleRow from '../components/fields/ToggleRow'
import { useSettingsSave } from '../lib/useSettingsSave'

// What your AI assistant remembers about how you teach, plus a calm view of
// this month's usage (no gauges or charts — those stay on the Dashboard).
// The remember toggle saves immediately; there's nothing else to save here.
export default function AiMemoryPanel() {
  const { userProfile, currentUser, updateProfileFields } = useAuth()
  const usage = useTeacherUsage(currentUser?.uid)
  const prefs = normalizeTeacherPreferences(userProfile?.teacherPreferences)
  const { run, error } = useSettingsSave()

  const setRemember = (on) =>
    run(async () => {
      const latest = normalizeTeacherPreferences(userProfile?.teacherPreferences)
      await updateProfileFields({
        teacherPreferences: {
          ...latest,
          ai: { ...latest.ai, rememberLastUsed: on },
        },
      })
    })

  const data = usage?.data
  const usedRows = data
    ? Object.entries(data.used)
        .filter(([feature, count]) => count > 0 || (data.caps[feature] ?? 0) > 0)
        .map(([feature, count]) => ({
          feature,
          label: FEATURE_LABELS[feature] || feature,
          count,
          cap: data.caps[feature] ?? 0,
        }))
    : []
  const totalUsed = usedRows.reduce((sum, r) => sum + r.count, 0)

  return (
    <SettingsDetailShell rowId="memory">
      <section className="tset-section">
        <h2 className="tset-section__title">Memory</h2>
        <ToggleRow
          title="Remember my preferences"
          hint="Your assistant applies your saved teaching style, curriculum defaults and school context to every studio automatically."
          checked={prefs.ai.rememberLastUsed}
          onChange={setRemember}
        />
        {error && <p className="tset-help" style={{ color: '#b91c1c' }}>{error}</p>}
        <p className="tset-section__hint" style={{ margin: '10px 0 0' }}>
          What's remembered: your AI preferences, curriculum defaults, school details and
          branding. Edit any of them from Settings — nothing is learned silently.
        </p>
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">This month</h2>
        {!data ? (
          <p className="tset-section__hint" style={{ margin: 0 }}>Loading your usage…</p>
        ) : (
          <>
            <div className="tset-usage-row">
              <p className="tset-usage-row__label">Generations this month</p>
              <p className="tset-usage-row__value">{totalUsed}</p>
            </div>
            {usedRows
              .filter((r) => r.count > 0)
              .map((r) => (
                <div key={r.feature} className="tset-usage-row">
                  <p className="tset-usage-row__label">{r.label}</p>
                  <p className="tset-usage-row__value">
                    {r.count} {r.cap > 0 && r.cap < 90000 && <small>of {r.cap}</small>}
                  </p>
                </div>
              ))}
            {data.credits > 0 && (
              <div className="tset-usage-row">
                <p className="tset-usage-row__label">Top-up credits</p>
                <p className="tset-usage-row__value">{data.credits}</p>
              </div>
            )}
            <div className="tset-usage-row">
              <p className="tset-usage-row__label">Allowance resets in</p>
              <p className="tset-usage-row__value">
                {data.resetDays} <small>day{data.resetDays === 1 ? '' : 's'}</small>
              </p>
            </div>
          </>
        )}
      </section>
    </SettingsDetailShell>
  )
}
