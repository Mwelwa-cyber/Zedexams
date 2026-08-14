// One registered passkey row: icon, name, device hints, dates, and the
// rename/remove actions. Actions are visible buttons (not a hover-only
// overflow menu) with ≥48px touch targets so they work on shared school
// tablets and with keyboard/screen-reader navigation.
import { Smartphone, Laptop, KeyRound, PencilLine, Trash2 } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'

function iconFor(passkey) {
  const transports = passkey.transports || []
  const external = transports.some((t) => ['usb', 'nfc', 'ble'].includes(t))
  if (external && !transports.includes('internal')) return KeyRound
  if (transports.includes('internal') || passkey.deviceType === 'multiDevice') return Smartphone
  return Laptop
}

function fmtDate(ms) {
  if (!ms) return null
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return null
  }
}

export default function PasskeyListItem({ passkey, onRename, onRemove, busy }) {
  const created = fmtDate(passkey.createdAtMs)
  const lastUsed = fmtDate(passkey.lastUsedAtMs)
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-700" aria-hidden="true">
        <Icon as={iconFor(passkey)} size="md" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-gray-900">{passkey.name}</span>
        <span className="block text-[12px] text-gray-500">
          {created ? `Added ${created}` : 'Added recently'}
          {' · '}
          {lastUsed ? `Last used ${lastUsed}` : 'Not used yet'}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRename}
          disabled={busy}
          aria-label={`Rename passkey ${passkey.name}`}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50 bg-transparent shadow-none p-0 min-h-0"
        >
          <Icon as={PencilLine} size="sm" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove passkey ${passkey.name}`}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 bg-transparent shadow-none p-0 min-h-0"
        >
          <Icon as={Trash2} size="sm" aria-hidden="true" />
        </button>
      </span>
    </li>
  )
}
