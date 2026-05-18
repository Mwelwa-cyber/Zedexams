// Floating diagnostics panel — only ever renders for admin / superAdmin
// accounts. Surfaces exactly why the account does (or does not) have full
// access so the platform owner can verify the super-admin grant at a glance.

import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import { isSuperAdmin } from '../../utils/permissions'

function Row({ label, value, ok }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="text-neutral-400">{label}</span>
      <span
        className={
          ok === true
            ? 'text-green-400 font-mono text-right break-all'
            : ok === false
              ? 'text-red-400 font-mono text-right break-all'
              : 'text-neutral-100 font-mono text-right break-all'
        }
      >
        {String(value)}
      </span>
    </div>
  )
}

export default function AdminDebugPanel() {
  const {
    currentUser,
    userProfile,
    isAdmin,
    isSuperAdmin: isSuperAdminFlag,
    isPremium,
    canAccessFullContent,
    canAccessLearnerPortal,
    userStatus,
    permissions,
  } = useAuth()
  const { accessLevel, accessBadge, planName } = useSubscription()
  const [open, setOpen] = useState(false)

  // Hard gate: never render for anyone who isn't an admin / super admin.
  if (!currentUser || !isSuperAdmin(userProfile)) return null

  const protectedAreas = [
    'Admin dashboard', 'Teacher dashboard', 'Learner dashboard preview',
    'Assessment Studio', 'Quiz editor', 'Daily exams', 'Games', 'Lessons',
    'Library', 'Planning Studio', 'User management', 'Reports', 'Settings',
  ]
  // With a correct admin/superAdmin role every protected area is reachable.
  const blocked = isAdmin ? [] : protectedAreas

  return (
    <div
      className="fixed bottom-4 left-4 z-[9999] font-sans"
      style={{ maxWidth: 360 }}
    >
      {open ? (
        <div className="rounded-2xl border border-neutral-700 bg-neutral-900/95 text-neutral-100 shadow-2xl backdrop-blur p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold">🛡️ Super Admin Debug</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-neutral-400 hover:text-white text-xs px-2 py-1"
            >
              ✕
            </button>
          </div>
          <div className="divide-y divide-neutral-800">
            <Row label="UID" value={currentUser.uid} />
            <Row label="email" value={currentUser.email || userProfile?.email || '—'} />
            <Row label="role" value={userProfile?.role || '(unset)'} ok={isAdmin} />
            <Row label="isSuperAdmin" value={isSuperAdminFlag} ok={isSuperAdminFlag} />
            <Row label="subscriptionPlan" value={userProfile?.subscriptionPlan || planName || 'free'} />
            <Row label="isPremium" value={isPremium} ok={isPremium} />
            <Row label="accessLevel" value={accessLevel} />
            <Row label="accessBadge" value={accessBadge?.label} />
            <Row label="status" value={userStatus} ok={userStatus === 'active'} />
            <Row label="fullContent" value={canAccessFullContent} ok={canAccessFullContent} />
            <Row label="learnerPortal" value={canAccessLearnerPortal} ok={canAccessLearnerPortal} />
          </div>
          <div className="mt-2 pt-2 border-t border-neutral-800">
            <div className="text-[11px] text-neutral-400 mb-1">Permissions detected</div>
            {Object.entries(permissions || {}).map(([k, v]) => (
              <Row key={k} label={k} value={v} ok={v === true} />
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-neutral-800">
            <div className="text-[11px] text-neutral-400 mb-1">
              Blocked routes / failed checks
            </div>
            {blocked.length === 0 ? (
              <div className="text-xs text-green-400 font-mono">
                None — full access ✓
              </div>
            ) : (
              <div className="text-xs text-red-400 font-mono break-words">
                {blocked.join(', ')}
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-neutral-700 bg-neutral-900/95 text-neutral-100 shadow-2xl backdrop-blur px-3 py-2 text-xs font-bold hover:bg-neutral-800"
        >
          🛡️ Admin Debug
        </button>
      )}
    </div>
  )
}
