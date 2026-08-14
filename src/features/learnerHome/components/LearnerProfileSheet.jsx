/**
 * LearnerProfileSheet — the profile menu opened from the header avatar
 * (Profile is not in the bottom navigation by design). Bottom sheet on
 * mobile, anchored card on wider screens. Focus is trapped simply by
 * focusing the sheet on open and restoring the trigger on close.
 */
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, User } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import CharacterAvatar from '../../../shared/components/CharacterAvatar'
import LearnerIcon from './LearnerIcon'
import { capture } from '../../../utils/analytics'

const MENU = [
  { icon: 'user', label: 'My Profile', to: '/profile' },
  { icon: 'progress', label: 'My Progress', to: '/my-results' },
  { icon: 'achievement', label: 'Achievements', to: '/my-badges' },
  { icon: 'bookmark', label: 'Saved papers', to: '/papers?filter=bookmarked' },
  { icon: 'download', label: 'Downloads & offline', to: '/offline' },
  { icon: 'timetable', label: 'My calendar', to: '/calendar' },
]

const SETTINGS = [
  { icon: 'notes', label: 'Theme & settings', to: '/settings' },
  { icon: 'learn', label: 'Help & support', to: '/settings?section=help' },
]

export default function LearnerProfileSheet({ open, onClose, returnFocusRef }) {
  const navigate = useNavigate()
  const { userProfile, logout } = useAuth()
  const sheetRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    capture('profile_opened')
    // Capture the trigger node now — the ref may have changed by cleanup.
    const trigger = returnFocusRef?.current
    sheetRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      trigger?.focus?.()
    }
  }, [open, onClose, returnFocusRef])

  if (!open) return null

  const go = (to) => { onClose(); navigate(to) }
  const handleLogout = async () => {
    onClose()
    try { await logout() } catch { /* signed-out state handles itself */ }
    navigate('/login')
  }

  const gradeLabel = userProfile?.grade ? `Grade ${userProfile.grade}` : 'Grade not set'

  return (
    <>
      <div className="lhx-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className="lhx-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Profile menu"
        tabIndex={-1}
      >
        <div className="lhx-sheet-grab" aria-hidden="true" />
        <div className="lhx-sheet-user">
          <span className="lhx-avatar-btn" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {userProfile?.avatarCharacter ? (
              <CharacterAvatar characterId={userProfile.avatarCharacter} className="w-full h-full" />
            ) : (
              <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--lhx-purple-deep)' }}>
                {(userProfile?.displayName || 'Z').charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div>
            <p className="lhx-sheet-name">{userProfile?.displayName || 'Learner'}</p>
            <p className="lhx-sheet-sub">{gradeLabel} · CBC</p>
          </div>
        </div>
        <div className="lhx-sheet-list">
          {MENU.map((item) => (
            <button key={item.label} type="button" className="lhx-sheet-item" onClick={() => go(item.to)}>
              {item.icon === 'user'
                ? <User size={20} aria-hidden="true" />
                : <LearnerIcon name={item.icon} size={20} className="lhx-sheet-ic" />}
              {item.label}
            </button>
          ))}
          <div className="lhx-sheet-divider" role="separator" />
          {SETTINGS.map((item) => (
            <button key={item.label} type="button" className="lhx-sheet-item" onClick={() => go(item.to)}>
              <LearnerIcon name={item.icon} size={20} className="lhx-sheet-ic" />
              {item.label}
            </button>
          ))}
          <div className="lhx-sheet-divider" role="separator" />
          <button type="button" className="lhx-sheet-item is-danger" onClick={handleLogout}>
            <LogOut size={20} aria-hidden="true" />
            Log out
          </button>
        </div>
      </div>
    </>
  )
}
