import { OPERATORS, detectOperator, looksLikeZambianPhone } from '../../../utils/lenco'
import { Check } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'

/**
 * Network display for the mobile-money checkout. The payer never tells us their
 * network — it is read straight off the number they type (ZICTA prefixes:
 * MTN 096/076, Airtel 097/077, Zamtel 095/075) by `detectOperator`, the same
 * function the pay button's guard and the charge request use, so what is shown
 * here is exactly what is sent.
 *
 * There is deliberately no dropdown and no "Change": a number whose prefix maps
 * to no supported network gets an error, not a guess, and the pay button stays
 * disabled (`detectOperator` returns '' and the caller gates on it).
 */
export default function NetworkField({ phone }) {
  const detectedId = detectOperator(phone)
  const detected = OPERATORS.find((op) => op.id === detectedId)
  // A complete Zambian number whose prefix is not a supported network.
  const unsupported = !detected && looksLikeZambianPhone(phone)

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
        Network
      </label>

      {detected ? (
        <div className="flex items-center rounded-xl border-2 border-green-200 bg-green-50 px-3 py-2.5">
          <span className="flex items-center gap-2 font-bold text-gray-800">
            <Icon as={Check} size="xs" strokeWidth={2.6} className="text-green-600" />
            {detected.label}
            <span className="text-xs font-bold uppercase tracking-wide text-green-700">· detected</span>
          </span>
        </div>
      ) : unsupported ? (
        <p className="rounded-xl border-2 border-dashed border-amber-300 px-3 py-2.5 text-sm text-amber-700" role="alert">
          We could not detect Airtel, MTN or Zamtel from this number. Check the number and try again.
        </p>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-gray-200 px-3 py-2.5 text-sm text-gray-400">
          We&apos;ll detect your network automatically from your number.
        </div>
      )}
    </div>
  )
}
