import { usePlatformSettings } from '../../contexts/PlatformSettingsContext'
import { useAuth } from '../../contexts/AuthContext'

export default function MaintenanceBanner() {
  const { settings } = usePlatformSettings()
  const { isAdmin } = useAuth()
  if (!settings?.maintenanceMode) return null
  return (
    <div
      role="alert"
      className="w-full text-center text-sm font-bold px-4 py-2"
      style={{ background: '#fde68a', color: '#78350f' }}
    >
      <span>
        🛠 {settings.maintenanceMessage || 'We are doing some quick maintenance.'}
        {isAdmin && <span className="ml-2 opacity-80">(admin preview — toggle in /admin/settings)</span>}
      </span>
    </div>
  )
}
