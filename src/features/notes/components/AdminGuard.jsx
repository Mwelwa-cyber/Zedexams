// src/features/notes/components/AdminGuard.jsx
//
// Wraps any admin-only Notes Studio route. Reads role from the AuthContext
// (which mirrors the Firestore `users/{uid}.role` field). No custom claims.
// While AuthContext is still loading the profile, shows a spinner.

import { Navigate } from 'react-router-dom'
import { Loader2 } from '../../../shared/components/icons'
import { useAuth } from '../../../contexts/AuthContext'

export function AdminGuard({ children }) {
  const { currentUser, userProfile, loading, isAdmin } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  if (!currentUser) return <Navigate to="/login" replace />
  if (!userProfile || !isAdmin) return <Navigate to="/" replace />

  return children
}
