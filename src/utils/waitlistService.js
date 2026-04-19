/**
 * Waitlist capture — writes to Firestore `waitlist` collection.
 *
 * Unauthenticated visitors can submit one entry. Rules enforce strict field
 * validation. Admins read via the admin dashboard.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function clean(v, max) {
  return typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : ''
}

/**
 * @param {object} input
 *   email (required), fullName, schoolName, role, grade, subject, source
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function submitWaitlist(input = {}) {
  const email = clean(input.email, 254).toLowerCase()
  if (!email) return { ok: false, error: 'Please enter your email.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' }

  const payload = {
    email,
    createdAt: serverTimestamp(),
    ...(input.fullName && { fullName: clean(input.fullName, 120) }),
    ...(input.schoolName && { schoolName: clean(input.schoolName, 160) }),
    ...(input.role && { role: clean(input.role, 40) }),
    ...(input.grade && { grade: clean(input.grade, 20) }),
    ...(input.subject && { subject: clean(input.subject, 40) }),
    ...(input.source && { source: clean(input.source, 60) }),
    ...(typeof navigator !== 'undefined' && navigator.userAgent && {
      userAgent: String(navigator.userAgent).slice(0, 500),
    }),
  }

  try {
    await addDoc(collection(db, 'waitlist'), payload)
    return { ok: true }
  } catch (err) {
    console.error('submitWaitlist failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Could not submit right now. Please refresh and try again.' :
        'Something went wrong. Please try again.',
    }
  }
}
