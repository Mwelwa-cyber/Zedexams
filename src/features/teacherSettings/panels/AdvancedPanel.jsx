import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import SettingsDetailShell from '../components/SettingsDetailShell'
import Icon from '../../../components/ui/Icon'
import {
  Settings,
  ChevronRight,
  Save,
  Signal,
  Zap,
  Download,
} from '../../../components/ui/icons'

// Power-user options. These are presented HONESTLY as coming soon: the
// toggles that used to live here (autosave / offline mode / performance mode /
// default download format) were saved to teacherPreferences.advanced but
// nothing consumed them yet — a switch that controls nothing is worse than a
// roadmap. The storage shape is kept (teacherSettingsCore normalizer), so
// wiring each one later won't need a migration.
const COMING_SOON = [
  { icon: Save, title: 'Autosave drafts', desc: 'Keep studio work-in-progress saved automatically' },
  { icon: Signal, title: 'Offline mode', desc: 'Prefer cached content when your connection drops' },
  { icon: Zap, title: 'Performance mode', desc: 'Reduce visual effects on older devices' },
  { icon: Download, title: 'Default download format', desc: 'Always export as PDF, Word, or both' },
]

export default function AdvancedPanel() {
  const { isAdminOnly } = useAuth()

  return (
    <SettingsDetailShell rowId="advanced">
      <section className="tset-group">
        <p className="teacher-dashboard-eyebrow">Coming soon</p>
        <div className="tset-card">
          {COMING_SOON.map((item) => (
            <div key={item.title} className="tset-row tset-row--static">
              <span className="tset-row__badge tset-row__badge--slate">
                <Icon as={item.icon} size="sm" />
              </span>
              <span className="tset-row__text">
                <p className="tset-row__title" style={{ color: 'var(--zt-text-muted)' }}>{item.title}</p>
                <p className="tset-row__desc">{item.desc}</p>
              </span>
              <span className="tset-row__soon">Soon</span>
            </div>
          ))}
        </div>
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
