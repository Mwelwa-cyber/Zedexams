import { useRef, useState } from 'react'
import { useAuth } from '../../../../contexts/AuthContext'
import { normalizeTeacherProfile } from '../../../../utils/teacherSettingsCore'
import { uploadBrandingAsset, deleteBrandingAsset } from '../../lib/uploadBrandingAsset'
import Icon from '../../../../components/ui/Icon'
import { Camera } from '../../../../components/ui/icons'

// Profile photo uploader. Saves immediately on pick (independent of the
// panel's Save button): uploads to user-branding/{uid}/profile-photo.jpg and
// writes teacherProfile.photoUrl merged over the latest stored map.
export default function PhotoUploadField() {
  const { userProfile, currentUser, updateProfileFields } = useAuth()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const profile = normalizeTeacherProfile(userProfile?.teacherProfile)

  const writeProfile = (fields) =>
    updateProfileFields({
      teacherProfile: normalizeTeacherProfile({ ...userProfile?.teacherProfile, ...fields }),
    })

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !currentUser) return
    setBusy(true)
    setError('')
    try {
      const { url, path } = await uploadBrandingAsset(currentUser.uid, 'photo', file)
      await writeProfile({ photoUrl: url, photoPath: path })
    } catch (err) {
      console.error('Photo upload failed:', err)
      setError(err?.message || 'Upload failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async () => {
    if (!currentUser) return
    setBusy(true)
    setError('')
    try {
      await deleteBrandingAsset(currentUser.uid, 'photo')
      await writeProfile({ photoUrl: '', photoPath: '' })
    } catch (err) {
      console.error('Photo remove failed:', err)
      setError('Could not remove the photo — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tset-upload">
      <span className="tset-upload__preview tset-upload__preview--round">
        {profile.photoUrl ? (
          <img src={profile.photoUrl} alt="Your profile photo" />
        ) : (
          <Icon as={Camera} size="md" aria-hidden="true" />
        )}
      </span>
      <div className="tset-upload__body">
        <p className="tset-row__title" style={{ margin: 0 }}>Profile photo</p>
        <p className="tset-help" style={{ margin: '2px 0 0' }}>
          JPG, PNG or WebP. Shown on your dashboard and settings.
        </p>
        {error && <p className="tset-help" style={{ color: '#b91c1c' }}>{error}</p>}
        <div className="tset-upload__actions">
          <button
            type="button"
            className="tset-btn tset-btn--sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Working…' : profile.photoUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {profile.photoUrl && (
            <button type="button" className="tset-btn tset-btn--danger tset-btn--sm" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPick} />
    </div>
  )
}
