import SeoHelmet from '../../shared/components/SeoHelmet'
import SettingsHero from './components/SettingsHero'
import SettingsGroup from './components/SettingsGroup'
import TipStrip from './components/TipStrip'
import { SETTINGS_SECTIONS } from './settingsSections'

// The settings hub: hero + five grouped lists + tip strip. A calm surface —
// everything that measures or charts lives on the Dashboard, not here.
export default function SettingsHome() {
  return (
    <>
      <SeoHelmet title="Settings" noIndex />
      <header className="tset-header">
        <h1 className="tset-header__title">Settings</h1>
        <p className="tset-header__sub">Manage your account, teaching and preferences</p>
      </header>
      <SettingsHero />
      {SETTINGS_SECTIONS.map((section) => (
        <SettingsGroup key={section.id} section={section} />
      ))}
      <TipStrip />
    </>
  )
}
