/**
 * LearnerHeader — logo row (notifications + avatar) and, on the home
 * page, the time-aware greeting with Grade · Curriculum · Term meta.
 * The avatar opens the profile sheet (Profile lives here, not in the
 * bottom navigation).
 */
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import CharacterAvatar from '../../../components/profile/CharacterAvatar'
import LearnerIcon from './LearnerIcon'
import LearnerProfileSheet from './LearnerProfileSheet'
import { getGreeting, firstNameOf } from '../lib/learnerHomeCore'

export default function LearnerHeader({ activeTerm, showGreeting = true, hasNotifications = false }) {
  const { userProfile } = useAuth()
  const [sheetOpen, setSheetOpen] = useState(false)
  const avatarRef = useRef(null)

  const firstName = firstNameOf(userProfile?.displayName)
  const greeting = getGreeting(new Date().getHours())
  const meta = [
    userProfile?.grade ? `Grade ${userProfile.grade}` : null,
    'CBC',
    activeTerm ? `Term ${activeTerm}` : null,
  ].filter(Boolean)

  return (
    <header className="lhx-header">
      <div className="lhx-header-row">
        <Link to="/dashboard" className="lhx-logo" aria-label="ZedExams home">
          <img src="/zedexams-logo.webp" alt="ZedExams" height="30" />
        </Link>
        <div className="lhx-header-actions">
          <Link to="/settings?section=notifications" className="lhx-iconbtn" aria-label="Notifications">
            <LearnerIcon name="notification" size={22} />
            {hasNotifications && <span className="lhx-badge-dot" aria-hidden="true" />}
          </Link>
          <button
            ref={avatarRef}
            type="button"
            className="lhx-avatar-btn"
            aria-label="Open profile menu"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
          >
            {userProfile?.avatarCharacter ? (
              <CharacterAvatar characterId={userProfile.avatarCharacter} className="w-full h-full" />
            ) : (
              <span
                aria-hidden="true"
                style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: 'var(--lhx-purple-deep)' }}
              >
                {(firstName || 'Z').charAt(0).toUpperCase()}
              </span>
            )}
          </button>
        </div>
      </div>
      {showGreeting && (
        <div>
          <h1 className="lhx-greeting">
            {greeting}{firstName ? `, ${firstName}!` : '!'}
          </h1>
          {meta.length > 0 && (
            <p className="lhx-header-meta">
              {meta.map((m, i) => (
                <span key={m}>
                  {i > 0 && <span className="lhx-dot" aria-hidden="true">·</span>}
                  {m}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      <LearnerProfileSheet open={sheetOpen} onClose={() => setSheetOpen(false)} returnFocusRef={avatarRef} />
    </header>
  )
}
