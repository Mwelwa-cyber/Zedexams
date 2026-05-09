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
import { getFunctions, httpsCallable } from 'firebase/functions'
import app                     from '../../firebase/config'
import { useAuth }             from '../../contexts/AuthContext'
import { useFirestore }        from '../../hooks/useFirestore'
import { useBadges }           from '../../hooks/useBadges'
import { useSubscription }     from '../../hooks/useSubscription'
import { getRoleLandingPath }  from '../../utils/navigation'
import { daysUntilExpiry }     from '../../utils/subscriptionConfig'
import UpgradeModal            from '../subscription/UpgradeModal'
import Button                  from '../ui/Button'
import Icon                    from '../ui/Icon'
import SeoHelmet               from '../seo/SeoHelmet'
import { CalendarDays, CheckCircleIcon, LockClosedIcon, LogOut, PencilLine, Sparkles, TrophyIcon } from '../ui/icons'

// Single shared callable instance for the cancel/reactivate flow.
// Defined at module scope so a re-render of ProfilePage doesn't churn
// a new httpsCallable each time.
const fns = getFunctions(app, 'us-central1')
const setSubscriptionCancellationCallable =
  httpsCallable(fns, 'setSubscriptionCancellation')

// ── helpers ────────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return 'New'
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return 'New'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function RoleChip({ role }) {
  const map = {
    admin:   { label: 'Admin',   cls: 'bg-white/25 text-white'  },
    teacher: { label: 'Teacher', cls: 'bg-white/25 text-white'  },
    learner: { label: 'Learner', cls: 'bg-white/20 text-white'  },
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
  const [showUpgrade, setShowUpgrade] = useState(false)

  // Audit D4 — self-serve cancellation flow.
  // Two states for the confirmation step ('cancel' or 'reactivate'),
  // plus a busy flag so the buttons can't double-fire while the
  // callable is in flight.
  const [confirmAction, setConfirmAction] = useState(null) // 'cancel' | 'reactivate' | null
  const [cancelBusy, setCancelBusy]       = useState(false)
  const [cancelError, setCancelError]     = useState('')
  const cancelAtPeriodEnd = Boolean(userProfile?.cancelAtPeriodEnd)

  const isLearner = userProfile?.role === 'learner'
  const isAdmin   = userProfile?.role === 'admin'
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

  // Audit D4 — self-serve cancellation toggle.
  // The Cloud Function writes the flag with the admin SDK; the
  // userProfile snapshot in AuthContext picks up the change via
  // onSnapshot, so the UI flips without an extra read here.
  async function handleSubscriptionCancellationToggle(cancel) {
    setCancelBusy(true)
    setCancelError('')
    try {
      await setSubscriptionCancellationCallable({ cancel })
      setConfirmAction(null)
    } catch (err) {
      // Surface the Cloud Function error message — it'll typically be
      // "No active subscription to cancel" if the user somehow got here
      // without premium, or a network message if MoMo is mid-flight.
      const message = err?.message?.replace(/^[A-Z]+:\s*/, '') ||
        'Could not update subscription. Please try again.'
      setCancelError(message)
    } finally {
      setCancelBusy(false)
    }
  }

  const initials = (userProfile?.displayName ?? '?').slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen theme-bg pb-28">
      <SeoHelmet title="Profile" path="/profile" noIndex />
      {/* ── Page Header ───────────────────────────────────────── */}
      <div className="theme-hero px-4 pt-8 pb-16" data-bg-gradient="true">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate(homePath)}
            className="flex items-center gap-1.5 text-white/70 text-sm font-bold mb-5 hover:text-white transition-colors min-h-0 p-0 bg-transparent shadow-none"
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
              <p className="text-white/70 text-sm mt-0.5 truncate">{currentUser?.email}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <RoleChip role={userProfile?.role} />
                <span className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full ${
                  accessBadge.color === 'green'  ? 'bg-green-100 text-green-700'   :
                  accessBadge.color === 'blue'   ? 'bg-blue-100  text-blue-700'    :
                  accessBadge.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-white/20 text-white'
                }`}>
                  <Icon as={Sparkles} size="xs" strokeWidth={2.1} /> {accessBadge.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Cards (overlap the header) ────────────────────────── */}
      <div className="max-w-lg mx-auto px-4 -mt-8 space-y-4">

        {/* Stats strip */}
        <div className="theme-card rounded-2xl border theme-border shadow-sm grid grid-cols-3 divide-x divide-[var(--border)]">
          {[
            { icon: PencilLine, value: loading ? '...' : quizCount, label: 'Quizzes' },
            { icon: TrophyIcon, value: earnedBadges.length,        label: 'Badges'  },
            { icon: CalendarDays, value: fmtDate(userProfile?.createdAt), label: 'Joined' },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center py-4 px-2 gap-0.5">
              <Icon as={s.icon} size="lg" strokeWidth={2.1} className="theme-accent-text" />
              <span className="text-base font-black theme-text leading-none mt-1">{s.value}</span>
              <span className="text-xs theme-text-muted font-bold">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Subscription status — hidden for admins, who have full access by role */}
        {!isAdmin && (
          <div className={`theme-card rounded-2xl border theme-border p-4 ${
            isPremium ? 'border-yellow-300 bg-yellow-50' : ''
          }`}>
            <div className="flex items-start gap-3">
              <Icon as={isPremium ? Sparkles : LockClosedIcon} size="lg" strokeWidth={2.1} className={`flex-shrink-0 ${isPremium ? 'text-yellow-700' : 'theme-text-muted'}`} />
              <div className="flex-1 min-w-0">
                <p className={`font-black text-sm ${isPremium ? 'text-yellow-800' : 'theme-text'}`}>
                  {isPremium ? `${planName} Plan` : 'Free / Demo Access'}
                  {/* Audit D4 — cancellation badge. Tells the user at a
                      glance the plan won't auto-renew (and gives them
                      somewhere to undo from). */}
                  {isPremium && cancelAtPeriodEnd && (
                    <span className="ml-2 inline-flex items-center text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full align-middle">
                      Cancellation scheduled
                    </span>
                  )}
                </p>
                <p className={`text-xs mt-0.5 ${isPremium ? 'text-yellow-700' : 'theme-text-muted'}`}>
                  {isPremium
                    ? cancelAtPeriodEnd
                      ? daysLeft !== null
                        ? `Plan ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — you keep full access until then.`
                        : 'Plan will end at expiry — full access until then.'
                      : daysLeft !== null
                        ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`
                        : 'Active subscription'
                    : 'Upgrade to unlock all quizzes & exam mode'}
                </p>
              </div>
              {!isPremium && (
                <Button variant="primary" size="sm" onClick={() => setShowUpgrade(true)} className="flex-shrink-0">
                  Upgrade
                </Button>
              )}
            </div>

            {/* Audit D4 — cancel / reactivate row. Inline confirmation
                step instead of a separate modal so the entire interaction
                stays inside the subscription card. */}
            {isPremium && (
              <div className="mt-3 pt-3 border-t border-current/10 flex flex-col gap-2">
                {confirmAction === 'cancel' && (
                  <div className="text-xs theme-text-muted">
                    <p className="font-bold text-yellow-800 mb-2">Cancel your subscription?</p>
                    <p className="leading-snug mb-3">
                      You&apos;ll keep full access until your plan ends
                      {daysLeft !== null ? ` in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : ''}
                      . We won&apos;t prompt you to renew. You can change your mind any time before then.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSubscriptionCancellationToggle(true)}
                        disabled={cancelBusy}
                        className="bg-rose-600 hover:bg-rose-700"
                      >
                        {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setConfirmAction(null); setCancelError('') }}
                        disabled={cancelBusy}
                      >
                        Keep my plan
                      </Button>
                    </div>
                  </div>
                )}
                {confirmAction === 'reactivate' && (
                  <div className="text-xs theme-text-muted">
                    <p className="font-bold text-yellow-800 mb-2">Reactivate your subscription?</p>
                    <p className="leading-snug mb-3">
                      We&apos;ll clear the cancellation flag and you&apos;ll keep your plan as normal.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSubscriptionCancellationToggle(false)}
                        disabled={cancelBusy}
                      >
                        {cancelBusy ? 'Reactivating…' : 'Yes, reactivate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setConfirmAction(null); setCancelError('') }}
                        disabled={cancelBusy}
                      >
                        Not now
                      </Button>
                    </div>
                  </div>
                )}
                {!confirmAction && (
                  <div className="flex justify-end">
                    {cancelAtPeriodEnd ? (
                      <button
                        type="button"
                        onClick={() => setConfirmAction('reactivate')}
                        className="text-xs font-bold theme-accent-text hover:underline"
                      >
                        Reactivate plan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmAction('cancel')}
                        className="text-xs font-bold text-rose-700 hover:underline"
                      >
                        Cancel subscription
                      </button>
                    )}
                  </div>
                )}
                {cancelError && (
                  <p role="alert" className="text-xs font-bold text-rose-700">{cancelError}</p>
                )}
              </div>
            )}
          </div>
        )}

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
              <p className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <Icon as={CheckCircleIcon} size="sm" strokeWidth={2.1} /> Profile saved successfully!
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth loading={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
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
              <Icon as={LogOut} size="sm" strokeWidth={2.1} /> Sign Out
            </button>
          </div>
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}
