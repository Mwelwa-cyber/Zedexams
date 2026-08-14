import { Link } from 'react-router-dom'
import Icon from '../../../shared/components/Icon'
import { ArrowLeft } from '../../../shared/components/icons'
import { ALL_SETTINGS_ROWS } from '../settingsSections'

// Chrome shared by every detail panel: back link to the hub, the row's badge
// + title + description, the panel body, and (when the panel saves) a sticky
// save bar. On mobile the panel is its own route, so browser-back works and
// the back link gives the iOS-style pop.
//
// Props:
//   rowId     id from settingsSections (drives badge/title/desc)
//   title     optional override
//   children  panel body
//   saveBar   optional { onSave, saving, saved, error, disabled, label }
export default function SettingsDetailShell({ rowId, title, children, saveBar }) {
  const row = ALL_SETTINGS_ROWS.find((r) => r.id === rowId)
  return (
    <div className="tset-detail">
      <Link to="/settings" className="tset-back">
        <Icon as={ArrowLeft} size="sm" aria-hidden="true" />
        Settings
      </Link>
      {row && (
        <header className="tset-detail__head">
          <span className={`tset-row__badge tset-row__badge--${row.tone}`}>
            <Icon as={row.icon} size="md" />
          </span>
          <div>
            <h1 className="tset-detail__title">{title || row.title}</h1>
            <p className="tset-detail__desc">{row.desc}</p>
          </div>
        </header>
      )}
      {children}
      {saveBar && (
        <div className="tset-savebar">
          {saveBar.error ? (
            <p className="tset-savebar__status tset-savebar__status--error">{saveBar.error}</p>
          ) : saveBar.saved ? (
            <p className="tset-savebar__status tset-savebar__status--saved">Saved ✓</p>
          ) : (
            <p className="tset-savebar__status">
              {saveBar.saving ? 'Saving…' : saveBar.dirty ? 'Unsaved changes' : ' '}
            </p>
          )}
          <button
            type="button"
            className="tset-btn"
            onClick={saveBar.onSave}
            disabled={saveBar.saving || saveBar.disabled}
          >
            {saveBar.saving ? 'Saving…' : saveBar.label || 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
