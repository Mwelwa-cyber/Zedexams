import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import PageHeader from '../../ui/PageHeader'
import Card from '../../ui/Card'
import Button from '../../ui/Button'
import Icon from '../../ui/Icon'
import { ArrowLeft } from '../../ui/icons'
import UserStatusBadge from './UserStatusBadge'
import { adminSetUserStatus, adminSetUserRole } from '../../../utils/adminUsersService'

function fmt(ts) {
  if (!ts) return '—'
  try {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
    if (!d || Number.isNaN(d.getTime?.())) return '—'
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return '—' }
}

export default function AdminUserProfile() {
  const { userId } = useParams()
  const [profile, setProfile] = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const snap = await getDoc(doc(db, 'users', userId))
        if (cancelled) return
        if (!snap.exists()) {
          setError('User not found.')
          setLoading(false)
          return
        }
        setProfile({ id: snap.id, ...snap.data() })
        const rSnap = await getDocs(query(
          collection(db, 'results'),
          where('userId', '==', userId),
          orderBy('completedAt', 'desc'),
          limit(20),
        )).catch(() => null)
        if (cancelled) return
        setResults(rSnap?.docs?.map(d => ({ id: d.id, ...d.data() })) || [])
      } catch (e) {
        console.error('AdminUserProfile load:', e)
        if (!cancelled) setError('Could not load this user.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  async function changeStatus(target) {
    setBusy(true)
    try {
      const reason = target === 'suspended'
        ? (window.prompt('Optional reason for suspension:') || '')
        : ''
      await adminSetUserStatus({ uid: userId, status: target, reason })
      setProfile(p => ({ ...p, status: target, suspendReason: reason }))
    } catch (e) {
      window.alert(`Could not update status: ${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(target) {
    if (!window.confirm(`Change role to ${target}? This affects what the user can do across the platform.`)) return
    setBusy(true)
    try {
      await adminSetUserRole({ uid: userId, role: target })
      setProfile(p => ({ ...p, role: target }))
    } catch (e) {
      window.alert(`Could not update role: ${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="px-4 py-8 text-sm theme-text-muted">Loading…</p>
  if (error) return <p className="px-4 py-8 text-sm text-red-600">{error}</p>
  if (!profile) return null

  const status = profile.status || 'active'

  return (
    <div className="space-y-5">
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-sm font-bold theme-text-muted hover:theme-text">
        <Icon as={ArrowLeft} size="xs" />
        Back to users
      </Link>
      <PageHeader
        eyebrow="User profile"
        title={profile.displayName || profile.email || 'Unknown'}
        description={profile.email}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card variant="elevated" size="md" className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-3">
            <UserStatusBadge status={status} />
            <span className="text-xs font-bold theme-text-muted">Role: {profile.role || 'learner'}</span>
            {profile.grade && <span className="text-xs font-bold theme-text-muted">Grade {profile.grade}</span>}
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs theme-text-muted">School</dt><dd className="font-bold theme-text">{profile.school || '—'}</dd></div>
            <div><dt className="text-xs theme-text-muted">Plan</dt><dd className="font-bold theme-text">{profile.subscriptionPlan || profile.plan || 'free'}</dd></div>
            <div><dt className="text-xs theme-text-muted">Premium</dt><dd className="font-bold theme-text">{profile.isPremium ? 'Yes' : 'No'}</dd></div>
            <div><dt className="text-xs theme-text-muted">Joined</dt><dd className="font-bold theme-text">{fmt(profile.createdAt)}</dd></div>
            {profile.suspendedAt && (
              <div className="sm:col-span-2"><dt className="text-xs theme-text-muted">Suspended</dt><dd className="font-bold theme-text">{fmt(profile.suspendedAt)} — {profile.suspendReason || '(no reason)'}</dd></div>
            )}
          </dl>
        </Card>

        <Card variant="elevated" size="md" className="space-y-3">
          <h3 className="font-black theme-text">Admin actions</h3>
          <div className="flex flex-col gap-2">
            {status !== 'suspended' ? (
              <Button variant="secondary" onClick={() => changeStatus('suspended')} disabled={busy}>Suspend account</Button>
            ) : (
              <Button variant="primary" onClick={() => changeStatus('active')} disabled={busy}>Restore account</Button>
            )}
            {status !== 'deleted' && (
              <Button variant="secondary" onClick={() => changeStatus('deleted')} disabled={busy}>Soft delete</Button>
            )}
          </div>
          <div className="theme-border border-t pt-3">
            <p className="text-xs font-black uppercase tracking-wider theme-text-muted mb-2">Change role</p>
            <div className="flex flex-wrap gap-2">
              {['learner', 'teacher', 'admin'].map(r => (
                <button
                  key={r}
                  onClick={() => changeRole(r)}
                  disabled={busy || profile.role === r}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-colors ${
                    profile.role === r
                      ? 'theme-accent-bg theme-accent-text border-transparent'
                      : 'theme-bg-subtle theme-border theme-text hover:theme-accent-bg hover:theme-accent-text'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card variant="flat" size="md" className="!p-0 overflow-hidden">
        <div className="px-5 py-3 border-b theme-border">
          <h3 className="font-black theme-text">Recent results</h3>
        </div>
        {results.length === 0 ? (
          <p className="px-5 py-8 text-sm theme-text-muted text-center">No quiz attempts yet.</p>
        ) : (
          <div>
            {results.map(r => (
              <div key={r.id} className="border-b theme-border last:border-b-0 px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold theme-text truncate">{r.quizTitle || '(untitled quiz)'}</p>
                  <p className="text-xs theme-text-muted">{r.subject || '—'} · Grade {r.grade || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="font-black theme-text">{r.percentage ?? '—'}%</p>
                  <p className="text-xs theme-text-muted">{fmt(r.completedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
