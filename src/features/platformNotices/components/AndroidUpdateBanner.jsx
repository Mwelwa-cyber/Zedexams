/**
 * AndroidUpdateBanner — Capacitor-only "a newer APK exists" strip.
 *
 * The web app auto-deploys but the Android APK only changes when a new
 * build is installed, so native users silently fall behind (stale
 * content, missing features — the classic "new content not showing in
 * the app" report). After building an APK, the admin sets the build
 * number gradle prints (versionCode, derived from the git commit count)
 * plus a download URL in /admin → Platform settings; every older
 * install then sees this banner.
 *
 * Web builds render null immediately — the Capacitor App plugin is only
 * imported once we know we're native.
 */

import { useEffect, useState } from 'react'
import { isNativePlatform } from '../../../utils/runtime'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'

const DISMISS_KEY = 'examprep:androidUpdateDismissed'

export default function AndroidUpdateBanner() {
  const { settings } = usePlatformSettings()
  const [installedBuild, setInstalledBuild] = useState(null)
  const [dismissedFor, setDismissedFor] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) || '' } catch { return '' }
  })

  const latestBuild = Number(settings.androidLatestBuild || 0)

  useEffect(() => {
    if (!isNativePlatform() || !latestBuild) return undefined
    let cancelled = false
    import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then((info) => {
        if (!cancelled) setInstalledBuild(Number(info?.build) || null)
      })
      .catch(() => { /* plugin unavailable — never block the app over a nudge */ })
    return () => { cancelled = true }
  }, [latestBuild])

  if (!isNativePlatform()) return null
  if (!latestBuild || !installedBuild || installedBuild >= latestBuild) return null
  if (dismissedFor === String(latestBuild)) return null

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(latestBuild)) } catch { /* ignore */ }
    setDismissedFor(String(latestBuild))
  }

  return (
    <div
      className="w-full px-4 py-2 text-sm font-bold flex items-center justify-between gap-3"
      style={{ background: '#fde68a', color: '#78350f' }}
    >
      <div className="flex-1 min-w-0">
        <span className="font-black">Update available</span>
        <span className="ml-2 opacity-90">
          {settings.androidUpdateMessage || 'A newer ZedExams app is out — new features and fixed content.'}
        </span>
        {settings.androidApkUrl && (
          <a
            href={settings.androidApkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 underline font-black"
          >
            Get the update
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="text-xs underline opacity-70 hover:opacity-100"
        aria-label="Dismiss update notice"
      >
        Dismiss
      </button>
    </div>
  )
}
