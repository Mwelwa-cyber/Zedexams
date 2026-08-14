// Teacher Settings — feature entry.
//
// Rendered by App.jsx's SettingsPage wrapper inside <TeacherLayout> (the
// sidebar/mobile chrome comes from the layout; the Settings nav item stays
// lit for every subpath). Routes:
//
//   /settings            → SettingsHome (hero + grouped rows)
//   /settings/<panel>    → one detail panel per settingsSections row
//   /settings?tab=<id>   → legacy deep link (e.g. AssessmentBlocks →
//                          ?tab=school) redirected to the nested path
//
// Panels are React.lazy so the hub chunk stays small — a teacher opening
// Settings only downloads the hub; each panel loads on first visit.

import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import PageLoader from '../../shared/components/PageLoader'
import SettingsHome from './SettingsHome'
import { LEGACY_TAB_TO_PATH } from './settingsSections'
import './teacherSettings.css'

const ProfilePanel = lazy(() => import('./panels/ProfilePanel'))
const SecurityPanel = lazy(() => import('./panels/SecurityPanel'))
const SchoolPanel = lazy(() => import('./panels/SchoolPanel'))
const BrandingPanel = lazy(() => import('./panels/BrandingPanel'))
const ResourcesPanel = lazy(() => import('./panels/ResourcesPanel'))
const TeachingProfilePanel = lazy(() => import('./panels/TeachingProfilePanel'))
const TimetablePanel = lazy(() => import('./panels/TimetablePanel'))
const CurriculumPanel = lazy(() => import('./panels/CurriculumPanel'))
const CalendarPanel = lazy(() => import('./panels/CalendarPanel'))
const AiPreferencesPanel = lazy(() => import('./panels/AiPreferencesPanel'))
const AiMemoryPanel = lazy(() => import('./panels/AiMemoryPanel'))
const SmartDefaultsPanel = lazy(() => import('./panels/SmartDefaultsPanel'))
const NotificationsPanel = lazy(() => import('./panels/NotificationsPanel'))
const AppearancePanel = lazy(() => import('./panels/AppearancePanel'))
const SubscriptionPanel = lazy(() => import('./panels/SubscriptionPanel'))
const AdvancedPanel = lazy(() => import('./panels/AdvancedPanel'))

// Index route: honour the legacy `?tab=` query (redirect into the nested
// path) or render the hub.
function HomeOrLegacyRedirect() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const path = tab ? LEGACY_TAB_TO_PATH[tab] : null
  if (path) return <Navigate to={`/settings/${path}`} replace />
  return <SettingsHome />
}

function Panel({ children }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

export default function TeacherSettings() {
  return (
    <div className="tset">
      <Routes>
        <Route index element={<HomeOrLegacyRedirect />} />
        {/* Me */}
        <Route path="profile" element={<Panel><ProfilePanel /></Panel>} />
        <Route path="security" element={<Panel><SecurityPanel /></Panel>} />
        {/* My School */}
        <Route path="school" element={<Panel><SchoolPanel /></Panel>} />
        <Route path="branding" element={<Panel><BrandingPanel /></Panel>} />
        <Route path="resources" element={<Panel><ResourcesPanel /></Panel>} />
        {/* My Teaching */}
        <Route path="teaching-profile" element={<Panel><TeachingProfilePanel /></Panel>} />
        {/* "Teaching" was merged into the Teaching Profile — redirect old links. */}
        <Route path="teaching" element={<Navigate to="/settings/teaching-profile" replace />} />
        <Route path="timetable" element={<Panel><TimetablePanel /></Panel>} />
        <Route path="curriculum" element={<Panel><CurriculumPanel /></Panel>} />
        <Route path="calendar" element={<Panel><CalendarPanel /></Panel>} />
        {/* My AI */}
        <Route path="ai" element={<Panel><AiPreferencesPanel /></Panel>} />
        <Route path="memory" element={<Panel><AiMemoryPanel /></Panel>} />
        <Route path="defaults" element={<Panel><SmartDefaultsPanel /></Panel>} />
        {/* My Account */}
        <Route path="notifications" element={<Panel><NotificationsPanel /></Panel>} />
        <Route path="appearance" element={<Panel><AppearancePanel /></Panel>} />
        <Route path="subscription" element={<Panel><SubscriptionPanel /></Panel>} />
        <Route path="advanced" element={<Panel><AdvancedPanel /></Panel>} />
        {/* Unknown subpath → hub */}
        <Route path="*" element={<Navigate to="/settings" replace />} />
      </Routes>
    </div>
  )
}
