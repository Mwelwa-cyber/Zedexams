/**
 * src/utils/playBillingRestore.js
 *
 * Restore-on-open for Google Play subscriptions. Called (native only, via
 * NativePlayBillingSync) once per signed-in uid per app cold start:
 * enumerates the Google account's owned subscription purchases and sends
 * them to verifyGooglePlayPurchase, which extends the grant on renewal,
 * completes any purchase whose verification was interrupted, and lapses a
 * Play-managed subscription Google reports expired. The users/{uid}
 * onSnapshot in AuthContext picks up any resulting change live — no
 * reload needed. Downgrades only ever happen server-side.
 */

import { capture } from './analytics'

const restoredUids = new Set()

export async function maybeRestorePlayPurchases(uid) {
  if (!uid || restoredUids.has(uid)) return
  restoredUids.add(uid)
  try {
    const { restorePlayPurchases, verifyPlayPurchases } = await import('./playBilling')
    const purchases = await restorePlayPurchases()
    if (!purchases.length) return
    await verifyPlayPurchases({ purchases, source: 'restore' })
  } catch (err) {
    // Let the next app open retry — a transient failure here must not
    // permanently skip this uid for the session.
    restoredUids.delete(uid)
    console.warn('[playBilling] restore-on-open failed', err)
    capture('play_restore_failed', {
      message: String(err?.message || err).slice(0, 120),
    })
  }
}
