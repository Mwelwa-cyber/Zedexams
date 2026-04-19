/**
 * Admin Waitlist service.
 *
 * Reads/writes the `waitlist` Firestore collection for admin-only consumption.
 * Rules enforce:
 *   - anyone can create (public signup)
 *   - only admin can read/delete/update
 *   - admin updates limited to contacted/notes/contactedAt fields
 */

import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query,
  serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { db } from '../firebase/config'

const PAGE_SIZE = 200

/**
 * List waitlist entries, newest first.
 * Optional filters applied client-side (cheap at this size).
 */
export async function listWaitlist(opts = {}) {
  const { contactedOnly = null, grade, subject } = opts
  const q = query(
    collection(db, 'waitlist'),
    orderBy('createdAt', 'desc'),
    limit(PAGE_SIZE),
  )
  let snap
  try {
    snap = await getDocs(q)
  } catch (err) {
    console.error('listWaitlist failed', err)
    throw new Error(
      err?.code === 'failed-precondition' ?
        'The waitlist index is still being built. Try again in a minute.' :
        'Could not load the waitlist. Check admin permissions.',
    )
  }
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  return rows.filter((r) => {
    if (contactedOnly === true && !r.contacted) return false
    if (contactedOnly === false && r.contacted) return false
    if (grade && r.grade !== grade) return false
    if (subject && r.subject !== subject) return false
    return true
  })
}

/** Toggle contacted state on a single entry. */
export async function setContacted(entryId, contacted = true) {
  if (!entryId) return false
  try {
    await updateDoc(doc(db, 'waitlist', entryId), {
      contacted: Boolean(contacted),
      contactedAt: contacted ? serverTimestamp() : null,
    })
    return true
  } catch (err) {
    console.error('setContacted failed', err)
    return false
  }
}

/** Update the private notes field on an entry. */
export async function updateNotes(entryId, notes) {
  if (!entryId) return false
  try {
    await updateDoc(doc(db, 'waitlist', entryId), {
      notes: String(notes || '').slice(0, 500),
    })
    return true
  } catch (err) {
    console.error('updateNotes failed', err)
    return false
  }
}

/** Delete an entry (spam, test data, etc). Admin-only. */
export async function deleteEntry(entryId) {
  if (!entryId) return false
  try {
    await deleteDoc(doc(db, 'waitlist', entryId))
    return true
  } catch (err) {
    console.error('deleteEntry failed', err)
    return false
  }
}

/** Count summary for the admin dashboard. */
export async function getWaitlistSummary() {
  try {
    const rows = await listWaitlist()
    const total = rows.length
    const contacted = rows.filter((r) => r.contacted).length
    const uncontacted = total - contacted
    // "New since yesterday" — anything created in last 24h
    const since = Date.now() - 24 * 60 * 60 * 1000
    const recent = rows.filter((r) => {
      const ts = r.createdAt?.toMillis?.() || r.createdAt?.seconds * 1000 || 0
      return ts >= since
    }).length
    return { total, contacted, uncontacted, recent }
  } catch (err) {
    return { total: 0, contacted: 0, uncontacted: 0, recent: 0 }
  }
}

/**
 * Convert a list of entries into a CSV string. Triggers a browser download.
 */
export function exportWaitlistCsv(rows, filename = 'zedexams-waitlist.csv') {
  if (!rows?.length) return

  const headers = [
    'email', 'fullName', 'schoolName', 'role', 'grade', 'subject',
    'source', 'contacted', 'contactedAt', 'createdAt', 'notes',
  ]

  const escape = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' && typeof v.toDate === 'function' ?
      v.toDate().toISOString() : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ]

  const csv = lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function formatDate(ts) {
  if (!ts) return ''
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / (1000 * 60))
  if (diffMin < 60) return diffMin <= 1 ? 'just now' : `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-ZM', { year: 'numeric', month: 'short', day: 'numeric' })
}
