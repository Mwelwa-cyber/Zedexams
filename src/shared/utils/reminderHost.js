/**
 * reminderHost — who is drawing the plan reminder on this screen.
 *
 * The app-root plan strips (SubscriptionStatusBanner, GraceRibbon) sit ABOVE
 * the routed page in the document flow. That is fine on a plain page and wrong
 * inside the learner shell: from 1000px the shell's fixed 250px sidebar is
 * painted over the strip's left edge, so a learner read "…estore your ZedExams
 * access." — the half of the sentence that was not under the sidebar — and the
 * phone's glass top bar pulls up over the strip's foot the same way.
 *
 * A shell that lays out its own chrome therefore draws the reminder INSIDE its
 * page column, where nothing can cover it, and claims the slot here so the
 * root strips step aside instead of showing twice. A claim is a counter, not a
 * boolean, so two shells mounting and unmounting across a navigation cannot
 * release each other's claim.
 *
 * Module-level on purpose: the root strips and the shell are in different
 * features, and a React context cannot reach from the shell UP to the strips
 * mounted beside the router. This file is in shared/ for the same reason — a
 * feature may not import a sibling feature.
 */

import { useSyncExternalStore } from 'react'

let claims = 0
const listeners = new Set()

function emit() {
  listeners.forEach((fn) => { try { fn() } catch { /* a listener must not break the others */ } })
}

/** @returns {() => void} release — idempotent. */
export function claimReminderHost() {
  claims += 1
  emit()
  let released = false
  return () => {
    if (released) return
    released = true
    claims = Math.max(0, claims - 1)
    emit()
  }
}

export function isReminderHostClaimed() {
  return claims > 0
}

export function subscribeReminderHost(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** True while a shell is drawing the reminder itself. Re-renders on change. */
export function useReminderHostClaimed() {
  return useSyncExternalStore(subscribeReminderHost, isReminderHostClaimed, () => false)
}
