// Settings → Security → Passkeys — the one passkey manager, mounted inside
// each role's security panel (teacher tset, learner lset, admin settings).
// Styling is deliberately self-contained (plain Tailwind on neutral panels)
// so it renders correctly in all three shells.
//
// Hidden entirely while the platform flag
// settings/global.featureFlags.passkeyAuthenticationEnabled is off; on
// browsers without WebAuthn it shows an informational notice instead of the
// manager. All credential data comes from the listUserPasskeys callable —
// nothing passkey-related is read from Firestore or localStorage.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import Button from '../../ui/Button'
import Icon from '../../ui/Icon'
import { Fingerprint, Plus } from '../../ui/icons'
import PasskeyList from './PasskeyList'
import PasskeySecurityExplanation from './PasskeySecurityExplanation'
import PasskeyUnsupportedNotice from './PasskeyUnsupportedNotice'
import AddPasskeyDialog from './AddPasskeyDialog'
import RenamePasskeyDialog from './RenamePasskeyDialog'
import RemovePasskeyDialog from './RemovePasskeyDialog'
import {
  isPasskeySupported,
  listPasskeys,
  mapPasskeyError,
  MAX_PASSKEYS_PER_USER,
} from '../../../services/passkeyService'

export default function PasskeySection() {
  const { currentUser } = useAuth()
  const { settings } = usePlatformSettings()
  const enabled = settings?.featureFlags?.passkeyAuthenticationEnabled === true
  const supported = isPasskeySupported()

  const [passkeys, setPasskeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(null) // { kind: 'add' | 'rename' | 'remove', passkey? }

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listPasskeys()
      setPasskeys(data?.passkeys || [])
    } catch (err) {
      setError(mapPasskeyError(err).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled && supported && currentUser) refresh()
  }, [enabled, supported, currentUser, refresh])

  if (!enabled || !currentUser) return null

  // Removing the ONLY passkey is fine when a password/Google fallback exists
  // (every ZedExams account signs up with one); if the account somehow has no
  // other provider, block removal of the last passkey so the user can't lock
  // themselves out.
  const hasFallbackMethod = (currentUser.providerData || []).some(
    (p) => p?.providerId === 'password' || p?.providerId === 'google.com',
  )
  const atLimit = passkeys.length >= MAX_PASSKEYS_PER_USER

  const handleRemoveRequest = (passkey) => {
    if (!hasFallbackMethod && passkeys.length <= 1) {
      setError(
        'This passkey is your only way to sign in. Set up a password or Google sign-in before removing it.',
      )
      return
    }
    setDialog({ kind: 'remove', passkey })
  }

  return (
    <section aria-labelledby="passkeys-heading" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-50 text-orange-700" aria-hidden="true">
          <Icon as={Fingerprint} size="sm" />
        </span>
        <div>
          <h2 id="passkeys-heading" className="text-[15px] font-bold text-gray-900">Passkeys</h2>
          <p className="text-[12px] text-gray-500">
            Sign in with your fingerprint, face, PIN, or device screen lock.
          </p>
        </div>
      </div>

      {!supported ? (
        <PasskeyUnsupportedNotice />
      ) : (
        <>
          <PasskeySecurityExplanation />

          <div className="mt-4">
            {loading ? (
              <p className="py-3 text-[13px] text-gray-500" role="status">Loading your passkeys…</p>
            ) : (
              <PasskeyList
                passkeys={passkeys}
                busy={Boolean(dialog)}
                onRename={(p) => setDialog({ kind: 'rename', passkey: p })}
                onRemove={handleRemoveRequest}
              />
            )}
          </div>

          {error && (
            <p aria-live="polite" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700">
              {error}
            </p>
          )}

          <div className="mt-4">
            <Button
              variant="primary"
              size="md"
              onClick={() => { setError(''); setDialog({ kind: 'add' }) }}
              disabled={loading || atLimit}
              leadingIcon={<Icon as={Plus} size="sm" aria-hidden="true" />}
            >
              Add a passkey
            </Button>
            {atLimit && (
              <p className="mt-1.5 text-[12px] text-gray-500">
                You&apos;ve reached the limit of {MAX_PASSKEYS_PER_USER} passkeys. Remove one to add another.
              </p>
            )}
          </div>
        </>
      )}

      {dialog?.kind === 'add' && (
        <AddPasskeyDialog
          onClose={() => setDialog(null)}
          onAdded={() => { setDialog(null); refresh() }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenamePasskeyDialog
          passkey={dialog.passkey}
          onClose={() => setDialog(null)}
          onRenamed={(updated) => {
            setPasskeys((list) => list.map((p) => (p.id === updated.id ? updated : p)))
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemovePasskeyDialog
          passkey={dialog.passkey}
          onClose={() => setDialog(null)}
          onRemoved={(removed) => {
            setPasskeys((list) => list.filter((p) => p.id !== removed.id))
            setDialog(null)
          }}
          onError={(message) => { setError(message); setDialog(null) }}
        />
      )}
    </section>
  )
}
