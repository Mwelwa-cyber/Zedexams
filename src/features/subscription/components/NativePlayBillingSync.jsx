import { useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'

// Native-only, renders nothing. Kicks the Google Play restore-on-open sync
// once a user is signed in — mounted from App.jsx behind isNativePlatform()
// so the web bundle never loads the billing plugin. The 3s delay keeps the
// Play Billing connection off the app-boot network burst (Firestore
// snapshot + auth + first route all land in the first seconds).
export default function NativePlayBillingSync() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid || null

  useEffect(() => {
    if (!uid) return undefined
    const timer = setTimeout(() => {
      import('../../../utils/playBillingRestore')
        .then((m) => m.maybeRestorePlayPurchases(uid))
        .catch(() => {})
    }, 3000)
    return () => clearTimeout(timer)
  }, [uid])

  return null
}
