import { usePwaUpdate } from '../../hooks/usePwaUpdate'

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
      className="fixed bottom-4 right-4 z-50 max-w-sm theme-card theme-border rounded-radius-md border p-4 shadow-elev-md flex items-center gap-3 sm:gap-4"
    >
      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm flex items-center gap-2">
          <span aria-hidden="true">✨</span>
          New version available
        </p>
        <p className="theme-text-muted text-xs mt-1 leading-snug">
          Refresh to load the latest changes. Your progress will be saved.
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={update}
          className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-bold shadow-sm hover:opacity-90"
        >
          Update
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full theme-text-muted hover:theme-text px-3 py-1.5 text-xs font-bold"
        >
          Later
        </button>
      </div>
    </div>
  )
}
