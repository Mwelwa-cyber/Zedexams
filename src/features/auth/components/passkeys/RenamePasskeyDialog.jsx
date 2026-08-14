import { useRef, useState } from 'react'
import ResponsiveModal from '../../../../shared/components/ResponsiveModal'
import Button from '../../../../shared/components/Button'
import { renamePasskey, mapPasskeyError } from '../../../../services/passkeyService'

export default function RenamePasskeyDialog({ passkey, onClose, onRenamed }) {
  const [name, setName] = useState(passkey?.name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  async function handleSubmit(e) {
    e?.preventDefault?.()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Please enter a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await renamePasskey(passkey.id, trimmed)
      onRenamed({ ...passkey, name: res?.name || trimmed })
    } catch (err) {
      setError(mapPasskeyError(err).message)
      setSaving(false)
    }
  }

  return (
    <ResponsiveModal
      onClose={() => { if (!saving) onClose() }}
      labelledBy="rename-passkey-title"
      initialFocusRef={inputRef}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="md" loading={saving} onClick={handleSubmit}>
            Save name
          </Button>
        </div>
      }
    >
      <div className="px-5 pt-4 pb-5 sm:px-6 sm:pt-6">
        <h2 id="rename-passkey-title" className="mb-3 text-[18px] font-bold text-gray-900">
          Rename passkey
        </h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="rename-passkey-input" className="mb-1.5 block text-[13px] font-medium text-gray-900">
            Passkey name
          </label>
          <input
            id="rename-passkey-input"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            className="h-[46px] w-full rounded-[10px] border-[1.5px] border-gray-300 px-3.5 text-sm text-gray-900 outline-none transition-colors focus:border-orange-600 focus:ring-[3px] focus:ring-black/5"
          />
        </form>
        {error && (
          <p aria-live="polite" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    </ResponsiveModal>
  )
}
