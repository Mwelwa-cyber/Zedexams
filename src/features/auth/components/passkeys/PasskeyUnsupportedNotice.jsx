// Rendered in place of the passkey manager when the browser has no WebAuthn
// support — the settings page keeps working, this is informational only.
import { Info } from '../../../../components/ui/icons'
import Icon from '../../../../components/ui/Icon'

export default function PasskeyUnsupportedNotice() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-3">
      <Icon as={Info} size="sm" className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
      <p className="text-[13px] leading-snug text-gray-600">
        Passkeys are not supported on this browser. You can keep signing in
        with Google or your password.
      </p>
    </div>
  )
}
