/**
 * ShareWithParent — one button that opens WhatsApp with a message ready.
 *
 * The learner picks their parent from their own contacts and presses Send.
 * No number is stored and the server sends nothing (see utils/parentShare).
 *
 * On the web this is a plain link to wa.me, so it works with no script and
 * is never caught by a popup blocker. In the Android app a wa.me link does
 * not leave the WebView reliably, so it goes through the native share sheet,
 * which lists WhatsApp.
 */
import { isNativePlatform } from '../../utils/runtime.js'
import { whatsappShareUrl } from '../utils/parentShare.js'

export default function ShareWithParent({
  message,
  label = 'Send to my parent on WhatsApp',
  onShare,
  className = '',
  style,
}) {
  async function handleClick(event) {
    try { onShare?.() } catch { /* a click handler must never block the share */ }
    if (!isNativePlatform()) return
    event.preventDefault()
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ text: message, dialogTitle: 'Send to my parent' })
    } catch {
      // Cancelled, or no share sheet: nothing to recover, nothing was sent.
    }
  }

  return (
    <a
      href={whatsappShareUrl(message)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      data-testid="share-with-parent"
      className={className || 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-green-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-green-700'}
      style={style}
    >
      <span aria-hidden="true">💬</span> {label}
    </a>
  )
}
