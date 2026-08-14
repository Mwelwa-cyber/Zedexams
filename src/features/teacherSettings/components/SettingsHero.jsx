import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useTeacherUsage } from '../../../hooks/useTeacherUsage'
import { getTimeGreeting } from '../../../utils/teacherDashboardIntel'
import { resolveTeacherPlan, PLAN_LABELS } from '../../../utils/teacherPlans'
import { teachingCounts } from '../../../utils/teacherDefaults'
import { normalizeTeacherProfile } from '../../../utils/teacherSettingsCore'
import { useTeachingProfile } from '../lib/useTeachingProfile'
import Icon from '../../../shared/components/Icon'
import { Home, PencilLine } from '../../../shared/components/icons'
import heroDesk from '../../../assets/teacher/hero-desk.webp'

// "Member since" from the profile's Firestore Timestamp (or the auth
// metadata as fallback). Blank when neither parses — the line just hides.
function memberSince(userProfile, currentUser) {
  const raw = userProfile?.createdAt
  let d = null
  if (raw?.toDate) d = raw.toDate()
  else if (raw?.seconds) d = new Date(raw.seconds * 1000)
  else if (typeof raw === 'string' || typeof raw === 'number') d = new Date(raw)
  if (!d || Number.isNaN(d.getTime())) {
    const t = currentUser?.metadata?.creationTime
    d = t ? new Date(t) : null
  }
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// The settings hero: navy dashboard-gradient card with the teacher's photo,
// greeting, school + member-since, three small stats (classes / subjects /
// lesson plans) and an Edit profile button. Same illustration + gradient
// recipe as the dashboard hero. Deliberately no charts or gauges.
export default function SettingsHero() {
  const { userProfile, currentUser } = useAuth()
  const usage = useTeacherUsage(currentUser?.uid)
  // Classes / Subjects come from the Teaching Profile assignments (single
  // source of truth); the hook degrades to an empty list on any read error,
  // so teachingCounts falls back to the legacy flat teaching field.
  const { assignments } = useTeachingProfile()

  const displayName = userProfile?.displayName || ''
  const firstName = displayName.split(' ')[0] || 'Teacher'
  const greeting = getTimeGreeting(Date.now(), firstName)
  const plan = resolveTeacherPlan(userProfile)
  const planLabel = plan === 'free' ? 'Free plan' : `${PLAN_LABELS[plan] || 'Pro'} Teacher`
  const profile = normalizeTeacherProfile(userProfile?.teacherProfile)
  const counts = teachingCounts(userProfile, assignments)
  const plansUsed = usage?.data?.used?.plans ?? null
  const school = userProfile?.school || ''
  const since = memberSince(userProfile, currentUser)
  const initial = (displayName || 'T').trim().charAt(0).toUpperCase()

  const stats = [
    { label: 'Classes', value: counts.classes },
    { label: 'Subjects', value: counts.subjects },
    { label: 'Lesson Plans', value: plansUsed ?? '—' },
  ]

  return (
    <section className={`teacher-hero teacher-hero--${greeting.part} tset-hero`} aria-label="Your profile summary">
      <img className="teacher-hero__illus" src={heroDesk} alt="" aria-hidden="true" loading="lazy" />
      {profile.photoUrl ? (
        <img className="tset-hero__photo" src={profile.photoUrl} alt={displayName || 'Teacher photo'} style={{ position: 'relative', zIndex: 1 }} />
      ) : (
        <span className="tset-hero__photo-fallback" style={{ position: 'relative', zIndex: 1 }} aria-hidden="true">
          {initial}
        </span>
      )}
      <div className="teacher-hero__content tset-hero__info">
        <h1 className="tset-hero__greeting">
          <span>{greeting.text}! 👋</span>
          <span className={`tset-hero__plan${plan === 'free' ? ' tset-hero__plan--free' : ''}`}>{planLabel}</span>
        </h1>
        {school && (
          <p className="tset-hero__meta">
            <Icon as={Home} size="sm" aria-hidden="true" />
            <span>{school}</span>
          </p>
        )}
        {since && <p className="tset-hero__meta-sub">Member since {since}</p>}
      </div>
      <div className="tset-hero__side">
        <div className="tset-hero__stats">
          {stats.map((s) => (
            <div key={s.label} className="tset-hero__stat">
              <span className="tset-hero__stat-value">{s.value}</span>
              <span className="tset-hero__stat-label">{s.label}</span>
            </div>
          ))}
        </div>
        <Link to="/settings/profile" className="tset-hero__edit">
          <Icon as={PencilLine} size="sm" aria-hidden="true" />
          Edit profile
        </Link>
      </div>
    </section>
  )
}
