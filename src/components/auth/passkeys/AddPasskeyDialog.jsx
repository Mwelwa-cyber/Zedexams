// Add-a-passkey flow: an explicit two-step dialog. Step 1 shows the security
// explanation + shared-device warning with a clear "Not now" — a passkey is
// NEVER registered automatically after Google/password sign-in. Step 2 (after
// the OS authenticator succeeded) lets the user name the new passkey.
import { useRef, useState } from 'react'
import ResponsiveModal from '../../ui/ResponsiveModal'
import Button from '../../ui/Button'
import Icon from '../../ui/Icon'
import { Fingerprint, CheckCircleIcon as CheckCircle } from '../../ui/icons'
import PasskeySecurityExplanation from './PasskeySecurityExplanation'
import { registerPasskey, renamePasskey, mapPasskeyError } from '../../../services/passkeyService'

export default function AddPasskeyDialog({ onClose, onAdded }) {
  // 'confirm' → 'registering' (OS prompt is up) → 'name' (registered)
  const [step, setStep] = useState('confirm')
  const [passkey, setPasskey] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const nameInputRef = useRef(null)

  async function handleContinue() {
    setError('')
    setNotice('')
    setStep('registering')
    try {
      const created = await registerPasskey('')
      setPasskey(created)
      setName(created?.name || '')
      setStep('name')
    } catch (err) {
      const mapped = mapPasskeyError(err)
      if (mapped.cancelled) {
        setNotice('Passkey setup was cancelled. Nothing was added.')
      } else {
        setError(mapped.message)
      }
      setStep('confirm')
    }
  }

  async function handleSaveName(e) {
    e?.preventDefault?.()
    setSaving(true)
    try {
      const trimmed = name.trim()
      let finalName = passkey?.name
      if (trimmed && trimmed !== passkey?.name) {
        const res = await renamePasskey(passkey.id, trimmed)
        finalName = res?.name || trimmed
      }
      onAdded({ ...passkey, name: finalName })
    } catch {
      // The passkey itself is saved — a rename hiccup shouldn't strand the
      // dialog. Finish with the default name; they can rename from the list.
      onAdded(passkey)
    } finally {
      setSaving(false)
    }
  }

  const registered = step === 'name'

  return (
    <ResponsiveModal
      onClose={() => { if (registered) { handleSaveName() } else if (step !== 'registering') { onClose() } }}
      labelledBy="add-passkey-title"
      showClose={step === 'confirm'}
      initialFocusRef={registered ? nameInputRef : undefined}
      footer={
        registered ? (
          <div className="flex justify-end">
            <Button variant="primary" size="md" loading={saving} onClick={handleSaveName}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="md" onClick={onClose} disabled={step === 'registering'}>
              Not now
            </Button>
            <Button variant="primary" size="md" loading={step === 'registering'} onClick={handleContinue}>
              {step === 'registering' ? 'Waiting for your device…' : 'Continue'}
            </Button>
          </div>
        )
      }
    >
      <div className="px-5 pt-4 pb-5 sm:px-6 sm:pt-6">
        {registered ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-green-50 text-green-700" aria-hidden="true">
                <Icon as={CheckCircle} size="md" />
              </span>
              <h2 id="add-passkey-title" className="text-[18px] font-bold text-gray-900">
                Passkey added
              </h2>
            </div>
            <p className="text-[13px] text-gray-600">
              Give this passkey a name you&apos;ll recognise, like{' '}
              <em>Samsung phone</em>, <em>Personal laptop</em> or <em>Security key</em>.
            </p>
            <form onSubmit={handleSaveName} className="mt-3">
              <label htmlFor="passkey-name" className="mb-1.5 block text-[13px] font-medium text-gray-900">
                Passkey name
              </label>
              <input
                id="passkey-name"
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                className="h-[46px] w-full rounded-[10px] border-[1.5px] border-gray-300 px-3.5 text-sm text-gray-900 outline-none transition-colors focus:border-orange-600 focus:ring-[3px] focus:ring-black/5"
              />
            </form>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-50 text-orange-700" aria-hidden="true">
                <Icon as={Fingerprint} size="md" />
              </span>
              <h2 id="add-passkey-title" className="text-[18px] font-bold text-gray-900">
                Add a passkey
              </h2>
            </div>
            <p className="mb-3 text-[13px] text-gray-600">
              Your device will ask you to confirm with your fingerprint, face,
              PIN, or screen lock. That check happens on your device only.
            </p>
            <PasskeySecurityExplanation />
            {notice && (
              <p aria-live="polite" className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-600">
                {notice}
              </p>
            )}
            {error && (
              <p aria-live="polite" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </ResponsiveModal>
  )
}
