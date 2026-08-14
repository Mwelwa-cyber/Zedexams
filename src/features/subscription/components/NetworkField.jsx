import { useState } from 'react'
import { OPERATORS, detectOperator, looksLikeZambianPhone, resolveOperator } from '../../../utils/lenco'
import { Check } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'

/**
 * Network picker for the mobile-money checkout. The payer should never have to
 * tell us their network — we read it straight off the number they type
 * (ZICTA prefixes: MTN 096/076, Airtel 097/077, Zamtel 095/075). The manual
 * dropdown only appears as a fallback when the prefix is unknown, or when the
 * payer taps "Change" to override the detected network.
 *
 * Controlled by the parent's checkout state so the value shown here matches
 * exactly what handlePay sends (both go through resolveOperator).
 */
export default function NetworkField({ phone, operator, operatorTouched, onSelect }) {
  const [manualOpen, setManualOpen] = useState(false)

  const auto = detectOperator(phone)
  const effectiveId = resolveOperator({ phone, operator, operatorTouched })
  const effective = OPERATORS.find((op) => op.id === effectiveId)
  const hasPhone = String(phone || '').trim().length > 0

  // Show the dropdown when: the payer overrode the detection, they tapped
  // "Change", or we have a number but couldn't recognise the network.
  const showManual = operatorTouched || manualOpen || (hasPhone && !auto)
  // A complete Zambian number whose prefix maps to no supported operator —
  // tell the payer plainly instead of leaving a silent dropdown.
  const unsupported = !operatorTouched && !manualOpen && looksLikeZambianPhone(phone) && !auto

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
        Network
      </label>

      {unsupported && (
        <p className="mb-1.5 text-xs text-amber-700" role="alert">
          We could not detect a supported mobile-money network from this number.
          Check the number, or choose your network below.
        </p>
      )}

      {showManual ? (
        <select
          value={effectiveId}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full border-2 border-gray-200 focus:border-[#B8860B] rounded-xl px-3 py-2.5 text-base focus:outline-none bg-white"
        >
          <option value="">Select your network…</option>
          {OPERATORS.map((op) => (
            <option key={op.id} value={op.id}>{op.label}</option>
          ))}
        </select>
      ) : effective ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-green-200 bg-green-50 px-3 py-2.5">
          <span className="flex items-center gap-2 font-bold text-gray-800">
            <Icon as={Check} size="xs" strokeWidth={2.6} className="text-green-600" />
            {effective.label}
            <span className="text-xs font-bold uppercase tracking-wide text-green-700">· detected</span>
          </span>
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="text-xs font-bold text-gray-500 underline hover:text-gray-700 min-h-0 p-0 bg-transparent shadow-none"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-gray-200 px-3 py-2.5 text-sm text-gray-400">
          We&apos;ll detect your network automatically from your number.
        </div>
      )}
    </div>
  )
}
