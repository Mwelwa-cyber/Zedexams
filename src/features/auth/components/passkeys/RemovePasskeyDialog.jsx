import { useState } from 'react'
import ConfirmDialog from '../../../../shared/components/ConfirmDialog'
import { removePasskey, mapPasskeyError } from '../../../../services/passkeyService'

export default function RemovePasskeyDialog({ passkey, onClose, onRemoved, onError }) {
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      await removePasskey(passkey.id)
      onRemoved(passkey)
    } catch (err) {
      onError(mapPasskeyError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open
      title="Remove this passkey?"
      message={
        <>
          This device will no longer be able to use{' '}
          <strong className="font-semibold">{passkey.name}</strong> to sign in
          to ZedExams. You can add it again later.
        </>
      }
      confirmLabel="Remove passkey"
      cancelLabel="Cancel"
      variant="danger"
      loading={busy}
      onConfirm={handleConfirm}
      onCancel={() => { if (!busy) onClose() }}
    />
  )
}
