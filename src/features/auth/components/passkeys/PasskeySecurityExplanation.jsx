// Shared security copy for every passkey surface — the explanation and the
// shared-device warning are a product requirement (teachers + learners often
// share school tablets), so they render together and prominently.
import { ShieldCheck, AlertTriangle } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'

export default function PasskeySecurityExplanation() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2.5 rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-3">
        <Icon as={ShieldCheck} size="sm" className="mt-0.5 shrink-0 text-green-700" aria-hidden="true" />
        <p className="text-[13px] leading-snug text-gray-700">
          Passkeys let you sign in using your fingerprint, face, PIN, or device
          screen lock. ZedExams never receives or stores your biometric
          information — it stays on your device.
        </p>
      </div>
      <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
        <Icon as={AlertTriangle} size="sm" className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="text-[13px] leading-snug text-amber-900">
          <strong className="font-semibold">Only add a passkey on a device you personally control.</strong>{' '}
          Do not add one on a shared school or public device.
        </p>
      </div>
    </div>
  )
}
