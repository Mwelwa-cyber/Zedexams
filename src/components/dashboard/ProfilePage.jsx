/**
 * ProfilePage — Learner / Teacher profile & settings
 *
 * Allows users to view and update:
 *   - Display name
 *   - School name
 *   - Grade (learners only)
 * Also shows:
 *   - Subscription / access status
 *   - Account summary (email, role, member since)
 *   - Quick stats (quizzes, badges)
 */
import { useState, useEffect } from 'react'
import { useNavigate }         from 'react-router-dom'
import { useAuth }             from '../../contexts/AuthContext'
import { useFirestore }        from '../../hooks/useFirestore'
import { useBadges }           from '../../hooks/useBadges'
import { useSubscription }     from '../../hooks/useSubscription'
import { getRoleLandingPath }  from '../../utils/navigation'
import { daysUntilExpiry }     from '../../utils/subscriptionConfig'

// ── helpers ────────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function RoleChip({ role }) {
  const map = {
    admin:   { label: 'Admin',   cls: 'bg-green-100 text-green-700'  },
    teacher: { label: 'Teacher', cls: 'bg-blue-100  text-blue-700'   },
    learner: { label: 'Learner', cls: 'bg-gray-100  text-gray-700'   },
  }
  const r = map[role] ?? map.learner
  return (
    <span className={`text-xs font-black px-2.5 py-1 rounded-full ${r.cls}`}>
      {r.label}
    </span>
  )
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-black theme-text-muted uppercase tracking-widest mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { currentUser, userProfile, updateProfileFields, logout } = useAuth()
  const { getUserResults }                                         = useFirestore()
  const { earned: earnedBadges }                                   = useBadges(currentUser?.uid)
  const { accessBadge, isPremium, planName }                       = useSubscription()
  const navigate                                                   = useNavigate()

  // form state
  const [displayName, setDisplayName] = useState('')
  const [school, setSchool]           = useState('')
  const [grade, setGrade]             = useState('4')

  // ui state
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState('')
  const [quizCount, setQuizCount] = useState(0)
  const [loading, setLoading]   = useState(true)

  const isLearner = userProfile?.role === 'learner'
  const daysLeft  = daysUntilExpiry(userProfile)
  const homePath = getRoleLandingPath(userProfile)
  const homeLabel = userProfile?.role === 'admin'
    ? 'Back to Admin'
    : userProfile?.role === 'teacher'
      ? 'Back to Teacher'
      : 'Back to Dashboard'

  // populate form from profile
  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName ?? '')
      setSchool(userProfile.school ?? '')
      setGrade(userProfile.grade ?? '4')
    }
  }, [userProfile])

  // load quiz count
  useEffect(() => {
    if (!currentUser) return
    getUserResults(currentUser.uid, 100).then(res => {
      setQuizCount(res.length)
      setLoading(false)
    })
  }, [currentUser])

  async function handleSave(e) {
    e.preventDefault()
    if (!displayName.trim()) { setError('Name cannot be empty.'); return }
    setError('')
    setSaving(true)
    try {
      const fields = { displayName: displayName.trim(), school: school.trim() }
      if (isLearner) fields.grade = grade
      await updateProfileFields(fields)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save. Please try again.')
    } finally { setSaving(false) }
  }

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const initials = (userProfile?.displayName ?? '?').slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen theme-bg pb-28">
      {/* ── Page Header ───────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 px-4 pt-8 pb-16">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate(homePath)}
            className="flex items-center gap-1.5 text-blue-200 text-sm font-bold mb-5 hover:text-white transition-colors min-h-0 p-0 bg-transparent shadow-none"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            {homeLabel}
          </button>

          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-white text-2xl font-black flex-shrink-0 backdrop-blur-sm border border-white/30">
              {initials}
            </div>

            <div className="min-w-0">
              <h1 className="text-white text-xl font-black leading-tight truncate">
                {userProfile?.displayName ?? 'My Profile'}
              </h1>
              <p className="text-blue-200 text-sm mt-0.5 truncate">{currentUser?.email}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <RoleChip role={userProfile?.role} />
                <span className={`text-xs font-black px-2.5 py-1 rounded-full ${
                  accessBadge.color === 'green'  ? 'bg-green-100 text-green-700'   :
                  accessBadge.color === 'blue'   ? 'bg-blue-100  text-blue-700'    :
                  accessBadge.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-white/20 text-white'
                }`}>
                  {accessBadge.icon} {accessBadge.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Cards (overlap the header) ────────────────────────── */}
      <div className="max-w-lg mx-auto px-4 -mt-8 space-y-4">

        {/* Stats strip */}
        <div className="theme-card rounded-2xl border theme-border shadow-sm grid grid-cols-3 divide-x divide-gray-100">
          {[
            { icon: '✏️', value: loading ? '…' : quizCount, label: 'Quizzes' },
            { icon: '🏆', value: earnedBadges.length,        label: 'Badges'  },
            { icon: '📅', value: fmtDate(userProfile?.createdAt), label: 'Joined' },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center py-4 px-2 gap-0.5">
              <span className="text-xl leading-none">{s.icon}</span>
              <span className="text-base font-black theme-text leading-none mt-1">{s.value}</span>
              <span className="text-xs theme-text-muted font-bold">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Subscription status */}
        <div className={`theme-card rounded-2xl border theme-border p-4 flex items-start gap-3 ${
          isPremium ? 'border-yellow-300 bg-yellow-50' : ''
        }`}>
          <span className="text-2xl flex-shrink-0">{isPremium ? '⭐' : '🔓'}</span>
          <div className="flex-1 min-w-0">
            <p className={`font-black text-sm ${isPremium ? 'text-yellow-800' : 'theme-text'}`}>
              {isPremium ? `${planName} Plan` : 'Free / Demo Access'}
            </p>
            <p className={`text-xs mt-0.5 ${isPremium ? 'text-yellow-700' : 'theme-text-muted'}`}>
              {isPremium
                ? daysLeft !== null
                  ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`
                  : 'Active subscription'
                : 'Upgrade to unlock all quizzes, papers & exam mode'}
            </p>
          </div>
          {!isPremium && (
            <button
              onClick={() => navigate(homePath)}
              className="flex-shrink-0 bg-green-600 hover:bg-green-700 text-white text-xs font-black px-3 py-1.5 rounded-xl transition-colors min-h-0 shadow-none"
            >
              Upgrade
            </button>
          )}
        </div>

        {/* Edit profile form */}
        <div className="theme-card rounded-2xl border theme-border p-5">
          <h2 className="font-black theme-text text-base mb-4">Edit Profile</h2>

          <form onSubmit={handleSave} className="space-y-4">
            <Field label="Full Name" htmlFor="profile-display-name">
              <input
                id="profile-display-name"
                name="displayName"
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                className="w-full border-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 transition-colors theme-input"
              />
            </Field>

            <Field label="School" htmlFor="profile-school">
              <input
                id="profile-school"
                name="school"
                type="text"
                value={school}
                onChange={e => setSchool(e.target.value)}
                placeholder="e.g. Lusaka Academy"
                autoComplete="organization"
                className="w-full border-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 transition-colors theme-input"
              />
            </Field>

            {isLearner && (
              <Field label="Grade" htmlFor="profile-grade">
                <select
                  id="profile-grade"
                  name="grade"
                  value={grade}
                  onChange={e => setGrade(e.target.value)}
                  className="w-full border-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 transition-colors theme-input"
                >
                  <option value="4">Grade 4</option>
                  <option value="5">Grade 5</option>
                  <option value="6">Grade 6</option>
                </select>
              </Field>
            )}

            <Field label="Email" htmlFor="profile-email">
              <div className="w-full border-2 rounded-xl px-4 py-3 text-sm theme-text-muted theme-bg-subtle border-transparent select-none">
                {currentUser?.email}
              </div>
            </Field>

            {error && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
            )}
            {saved && (
              <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                ✅ Profile saved successfully!
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-sm py-3.5 rounded-2xl shadow-md transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Account actions */}
        <div className="theme-card rounded-2xl border theme-border p-4">
          <h2 className="font-black theme-text text-base mb-3">Account</h2>
          <div className="space-y-1">
            <button
              onClick={handleLogout}
              className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-colors min-h-0 bg-transparent shadow-none"
            >
              🚪 Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
