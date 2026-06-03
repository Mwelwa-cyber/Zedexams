import { usePwaUpdate } from '../../hooks/usePwaUpdate'
import Icon from './Icon'
import { RefreshCw, XMarkIcon } from './icons'

/**
 * UpdatePrompt — toast that appears in the bottom-right when a new
 * service worker is waiting (audit A1.2).
 *
 * The PWA SW is registered with `registerType: 'prompt'` (vite.config.js)
 * so a new build doesn't auto-claim open tabs — instead vite-plugin-pwa
 * fires `onNeedRefresh` and we ask the user. Auto-claiming would risk
 * tearing the page mid-quiz, mid-edit, or mid-payment, which is exactly
 * the kind of thing learners on flaky 3G can't tolerate.
 *
 * The toast is dismissible — pressing "Later" hides it for the session
 * but the next deploy will re-show. The user can also reload manually at
 * any time, which has the same effect as accepting.
 *
 * Mounted inside <App /> so it renders on every route, but inert (returns
 * null) until updateReady flips. Capacitor users never see this — the
 * hook short-circuits to no-op on native.
 */
export default function UpdatePrompt() {
  const { updateReady, update, dismiss } = usePwaUpdate()

  if (!updateReady) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="fixed inset-x-3 bottom-3 z-[90] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[360px] theme-card theme-border rounded-radius-md border p-4 shadow-elev-lg"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-sm bg-[color:var(--accent-bg)] text-[color:var(--accent)]">
          <Icon as={RefreshCw} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="theme-text text-sm font-black">New version available</p>
          <p className="theme-text-muted mt-1 text-xs leading-snug">
            Refresh when you are ready to load the latest ZedExams update.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={update}
              className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-bold shadow-sm transition hover:opacity-90 active:scale-[0.98]"
            >
              Refresh now
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full theme-text-muted px-3 py-1.5 text-xs font-bold transition hover:theme-text hover:theme-bg-subtle active:scale-[0.98]"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update prompt"
          className="-mr-1 -mt-1 rounded-full p-1.5 theme-text-muted transition hover:theme-text hover:theme-bg-subtle active:scale-[0.98]"
        >
          <Icon as={XMarkIcon} size="sm" />
        </button>
      </div>
    </div>
  )
}
