import SettingsRow from './SettingsRow'

// One settings section: eyebrow label + a single rounded white card holding
// its rows (Apple-Settings grouped-list feel).
export default function SettingsGroup({ section }) {
  return (
    <section className="tset-group" aria-label={section.label}>
      <p className="teacher-dashboard-eyebrow">{section.label}</p>
      <div className="tset-card">
        {section.rows.map((row) => (
          <SettingsRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  )
}
