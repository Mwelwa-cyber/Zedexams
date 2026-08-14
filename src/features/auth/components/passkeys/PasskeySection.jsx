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
import { useAuth } from '../../../../contexts/AuthContext'
import { usePlatformSettings } from '../../../../contexts/PlatformSettingsContext'
import Button from '../../../../shared/components/Button'
import Icon from '../../../../shared/components/Icon'
import { Fingerprint, Plus } from '../../../../shared/components/icons'
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
  canRegisterPasskeys,
  MAX_PASSKEYS_PER_USER,
} from '../../../../services/passkeyService'

export default function PasskeySection() {
  const { currentUser, userProfile } = useAuth()
  const { settings } = usePlatformSettings()
  const enabled = settings?.featureFlags?.passkeyAuthenticationEnabled === true
  const supported = isPasskeySupported()
  const role = userProfile?.role
  const isAdminAccount = role === 'admin' || role === 'superAdmin'
  // Server-enforced too — this only decides what UI to show, so users outside
  // the staged rollout never reach a dead-end OS prompt.
  const canRegister = canRegisterPasskeys({
    featureFlags: settings?.featureFlags,
    role,
    uid: currentUser?.uid,
  })

  const [passkeys, setPasskeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Neutral informational message (e.g. post-removal device-side cleanup).
  const [notice, setNotice] = useState('')
  const [showDuplicateHelp, setShowDuplicateHelp] = useState(false)
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

          {notice && (
            <p aria-live="polite" className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-700">
              {notice}
            </p>
          )}

          {error && (
            <p aria-live="polite" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700">
              {error}
            </p>
          )}

          {/* Device password managers keep their own copy of a passkey; a
              removed or superseded one can linger there and show as a second
              identical account row in the OS chooser. Help is opt-in via the
              link — not a permanent warning. */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowDuplicateHelp((v) => !v)}
              aria-expanded={showDuplicateHelp}
              className="text-[13px] font-medium text-orange-700 hover:underline bg-transparent shadow-none p-0 min-h-0"
            >
              Why do I see my account twice?
            </button>
            {showDuplicateHelp && (
              <p className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] leading-snug text-gray-600">
                One entry may be an older passkey saved in your phone&apos;s
                password manager — websites cannot remove those remotely. Test
                each entry before removing anything: the stale one will say it
                is no longer linked to a ZedExams account. To clean it up, open
                Google Password Manager, search for zedexams.com, and remove
                the old passkey that no longer works.
              </p>
            )}
          </div>

          {canRegister ? (
            <div className="mt-4">
              <Button
                variant="primary"
                size="md"
                onClick={() => { setError(''); setNotice(''); setDialog({ kind: 'add' }) }}
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
          ) : (
            <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-600">
              {isAdminAccount
                ? 'Administrator accounts sign in with email, password and an authenticator code, so passkeys are not available for admins.'
                : 'Adding new passkeys is not available for your account yet.'}
            </p>
          )}
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
            setNotice(
              'The passkey has been removed from ZedExams. It may still appear in your phone’s password manager until you delete it there.',
            )
            setDialog(null)
          }}
          onError={(message) => { setError(message); setDialog(null) }}
        />
      )}
    </section>
  )
}
