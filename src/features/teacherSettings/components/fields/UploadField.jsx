import { useRef, useState } from 'react'
import Icon from '../../../../shared/components/Icon'
import { ImageIcon } from '../../../../shared/components/icons'

// Generic branding-asset upload tile (logo / signature / letterhead).
// The OWNER of the Firestore field does the persistence: this component only
// picks the file and calls onUpload(file) / onRemove(), showing busy/error
// state. Preview keeps aspect (object-fit: contain) since these are documents
// marks, not avatars.
export default function UploadField({ title, hint, url, onUpload, onRemove, disabled = false }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const blocked = busy || disabled

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await onUpload(file)
    } catch (err) {
      console.error(`${title} upload failed:`, err)
      setError(err?.message || 'Upload failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await onRemove()
    } catch (err) {
      console.error(`${title} remove failed:`, err)
      setError('Could not remove — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tset-upload">
      <span className="tset-upload__preview tset-upload__preview--contain">
        {url ? <img src={url} alt={`${title} preview`} /> : <Icon as={ImageIcon} size="md" aria-hidden="true" />}
      </span>
      <div className="tset-upload__body">
        <p className="tset-row__title" style={{ margin: 0 }}>{title}</p>
        {hint && <p className="tset-help" style={{ margin: '2px 0 0' }}>{hint}</p>}
        {error && <p className="tset-help" style={{ color: '#b91c1c' }}>{error}</p>}
        <div className="tset-upload__actions">
          <button
            type="button"
            className="tset-btn tset-btn--ghost tset-btn--sm"
            disabled={blocked}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Working…' : url ? 'Change' : 'Upload'}
          </button>
          {url && (
            <button type="button" className="tset-btn tset-btn--danger tset-btn--sm" disabled={blocked} onClick={remove}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPick} />
    </div>
  )
}
