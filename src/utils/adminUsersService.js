import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db, auth } from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const setUserStatusCallable = httpsCallable(functions, 'adminSetUserStatus')
const setUserRoleCallable = httpsCallable(functions, 'adminSetUserRole')

/**
 * adminSetUserStatus — soft-suspend or restore a user account.
 *
 * Calls the Cloud Function so the audit trail captures the actor
 * (callable functions verify the caller is an admin via custom claims +
 * Firestore role lookup). On environments without the function deployed
 * yet, we fall back to a direct Firestore write so the existing admin
 * panel keeps working.
 */
export async function adminSetUserStatus({ uid, status, reason = '' }) {
  if (!uid) throw new Error('uid is required')
  if (!['active', 'suspended', 'deleted'].includes(status)) {
    throw new Error(`Invalid status: ${status}`)
  }
  try {
    await setUserStatusCallable({ uid, status, reason })
  } catch (err) {
    if (err?.code === 'functions/not-found') {
      // Fallback: direct write. Firestore rules still gate this to admins.
      const fields = {
        status,
        suspendedAt: status === 'suspended' ? serverTimestamp() : null,
        suspendedBy: status === 'suspended' ? (auth.currentUser?.uid || null) : null,
        suspendReason: status === 'suspended' ? reason : '',
        deletedAt: status === 'deleted' ? serverTimestamp() : null,
        deletedBy: status === 'deleted' ? (auth.currentUser?.uid || null) : null,
      }
      await updateDoc(doc(db, 'users', uid), fields)
      return
    }
    throw err
  }
}

export async function adminSetUserRole({ uid, role }) {
  if (!uid) throw new Error('uid is required')
  if (!['learner', 'teacher', 'admin'].includes(role)) {
    throw new Error(`Invalid role: ${role}`)
  }
  try {
    await setUserRoleCallable({ uid, role })
  } catch (err) {
    if (err?.code === 'functions/not-found') {
      await updateDoc(doc(db, 'users', uid), { role })
      return
    }
    throw err
  }
}
