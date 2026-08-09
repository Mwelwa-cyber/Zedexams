import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import PageHeader from '../../../components/ui/PageHeader'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Icon from '../../../components/ui/Icon'
import { ArrowLeft } from '../../../components/ui/icons'
import UserStatusBadge from '../components/UserStatusBadge'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import { adminSetUserStatus, adminSetUserRole } from '../../../utils/adminUsersService'
import { useToast } from '../../../components/ui/Toast'

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
  const { currentUser } = useAuth()
  const toast = useToast()
  const isSelf = !!currentUser?.uid && currentUser.uid === userId
  const [profile, setProfile] = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Status/role changes confirm through ConfirmDialog instead of
  // window.confirm/prompt. pendingStatus is 'suspended' | 'deleted';
  // restoring to active applies directly (it reverses the other two).
  const [pendingStatus, setPendingStatus] = useState(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [pendingRole, setPendingRole] = useState(null)

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

  function changeStatus(target) {
    if (isSelf) {
      toast.error("You can't change your own account status from here.")
      return
    }
    if (target === 'active') {
      applyStatus('active', '')
      return
    }
    setSuspendReason('')
    setPendingStatus(target)
  }

  async function applyStatus(target, reason) {
    setBusy(true)
    try {
      await adminSetUserStatus({ uid: userId, status: target, reason })
      setProfile(p => ({ ...p, status: target, suspendReason: reason }))
      setPendingStatus(null)
    } catch (e) {
      toast.error(`Could not update status: ${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  function changeRole(target) {
    if (isSelf) {
      toast.error("You can't change your own role from here.")
      return
    }
    setPendingRole(target)
  }

  async function applyRole(target) {
    setBusy(true)
    try {
      await adminSetUserRole({ uid: userId, role: target })
      setProfile(p => ({ ...p, role: target }))
      setPendingRole(null)
    } catch (e) {
      toast.error(`Could not update role: ${e.message || e}`)
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
          {isSelf && (
            <p className="text-xs font-bold theme-text-muted bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This is your own account. Status and role changes are disabled here — ask another admin if you need them.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {status !== 'suspended' ? (
              <Button variant="secondary" onClick={() => changeStatus('suspended')} disabled={busy || isSelf}>Suspend account</Button>
            ) : (
              <Button variant="primary" onClick={() => changeStatus('active')} disabled={busy || isSelf}>Restore account</Button>
            )}
            {status !== 'deleted' && (
              <Button variant="secondary" onClick={() => changeStatus('deleted')} disabled={busy || isSelf}>Soft delete</Button>
            )}
          </div>
          <div className="theme-border border-t pt-3">
            <p className="text-xs font-black uppercase tracking-wider theme-text-muted mb-2">Change role</p>
            <div className="flex flex-wrap gap-2">
              {['learner', 'teacher', 'admin'].map(r => (
                <button
                  key={r}
                  onClick={() => changeRole(r)}
                  disabled={busy || isSelf || profile.role === r}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-colors disabled:opacity-50 ${
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

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        title={pendingStatus === 'suspended' ? 'Suspend this account?' : 'Soft-delete this account?'}
        message={pendingStatus === 'suspended' ? (
          <div className="space-y-3">
            <p>
              <strong className="theme-text">{profile.displayName || profile.email || 'This user'}</strong> loses
              access immediately. You can restore the account later.
            </p>
            <label className="block">
              <span className="block text-xs font-black theme-text-muted mb-1">Reason (optional, logged in the audit trail)</span>
              <input
                type="text"
                value={suspendReason}
                onChange={e => setSuspendReason(e.target.value)}
                placeholder="e.g. payment dispute, abuse report"
                className="theme-input w-full rounded-xl border theme-border px-3 py-2 text-sm"
              />
            </label>
          </div>
        ) : (
          <>
            <strong className="theme-text">{profile.displayName || profile.email || 'This user'}</strong> loses
            access immediately. The record stays for audit; restore by setting the account active again.
          </>
        )}
        confirmLabel={pendingStatus === 'suspended' ? 'Suspend' : 'Soft delete'}
        variant="danger"
        loading={busy}
        onConfirm={() => applyStatus(pendingStatus, pendingStatus === 'suspended' ? suspendReason.trim() : '')}
        onCancel={() => setPendingStatus(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingRole)}
        title={`Change role to ${pendingRole}?`}
        message="This affects what the user can do across the platform."
        confirmLabel="Change role"
        variant={pendingRole === 'admin' || profile.role === 'admin' ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={() => applyRole(pendingRole)}
        onCancel={() => setPendingRole(null)}
      />
    </div>
  )
}
