/**
 * invoices — read helpers for the audit D3 receipt surface.
 *
 * `invoices/{paymentId}` Firestore doc + `invoices/{uid}/{paymentId}.pdf`
 * Storage object are both written server-side. Clients read both:
 *   - List of doc rows for "My invoices".
 *   - Storage URL on demand when the user clicks Download.
 *
 * Storage URL resolution returns null when the rule blocks (signed-out
 * visitor, or someone else's invoice path). Caller falls back to a
 * "sign in to download" message.
 */

import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db, storage } from '../firebase/config'

const COLLECTION = 'invoices'
const fns = getFunctions(app, 'us-central1')
const resendInvoiceEmailCallable = httpsCallable(fns, 'resendInvoiceEmail')

/**
 * Re-send the receipt email for an existing invoice. Admin-or-owner
 * gated server-side. Returns `{ ok, emailedTo }` on success.
 */
export async function resendInvoiceEmail(invoiceId) {
  const result = await resendInvoiceEmailCallable({ invoiceId })
  return result.data
}

export async function listInvoicesForUser(uid, { limit = 50 } = {}) {
  const q = query(
    collection(db, COLLECTION),
    where('userId', '==', uid),
    orderBy('issuedAt', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function resolveInvoicePdfUrl(storagePath) {
  if (!storagePath) return null
  try {
    return await getDownloadURL(storageRef(storage, storagePath))
  } catch (err) {
    console.warn('[invoices] resolveInvoicePdfUrl failed', err)
    return null
  }
}
