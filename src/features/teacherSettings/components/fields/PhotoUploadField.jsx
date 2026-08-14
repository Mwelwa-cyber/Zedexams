import { useRef, useState } from 'react'
import { useAuth } from '../../../../contexts/AuthContext'
import { normalizeTeacherProfile } from '../../../../utils/teacherSettingsCore'
import { uploadBrandingAsset, deleteBrandingAssetByPath } from '../../lib/uploadBrandingAsset'
import Icon from '../../../../shared/components/Icon'
import { Camera } from '../../../../shared/components/icons'

// Profile photo uploader. Saves immediately on pick (independent of the
// panel's Save button): uploads a versioned object under user-branding/{uid}/
// and writes teacherProfile.photoUrl merged over the latest stored map.
export default function PhotoUploadField() {
  const { userProfile, currentUser, updateProfileFields } = useAuth()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const profile = normalizeTeacherProfile(userProfile?.teacherProfile)

  // Uploads take seconds; the profile may change mid-flight (panel save,
  // another tab). Merge over the profile as of WRITE time, not pick time.
  const profileRef = useRef(userProfile)
  profileRef.current = userProfile

  const writeProfile = (fields) =>
    updateProfileFields({
      teacherProfile: normalizeTeacherProfile({
        ...profileRef.current?.teacherProfile,
        ...fields,
      }),
    })

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !currentUser) return
    setBusy(true)
    setError('')
    try {
      const previousPath = normalizeTeacherProfile(profileRef.current?.teacherProfile).photoPath
      const { url, path } = await uploadBrandingAsset(currentUser.uid, 'photo', file)
      await writeProfile({ photoUrl: url, photoPath: path })
      // Old photo versions aren't referenced anywhere else — reclaim now.
      await deleteBrandingAssetByPath(previousPath).catch(() => null)
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
      const currentPath = normalizeTeacherProfile(profileRef.current?.teacherProfile).photoPath
      await writeProfile({ photoUrl: '', photoPath: '' })
      await deleteBrandingAssetByPath(currentPath)
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
