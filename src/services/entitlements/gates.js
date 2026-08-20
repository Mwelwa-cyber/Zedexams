/**
 * gates — the registry of everything the app locks.
 *
 * One entry per gate, and nothing may be locked without one. The rule that
 * makes this worth having is not tidiness: an inline `if (!isPremium)` in a
 * component carries its own copy of the quota, its own copy of the words, and
 * its own idea of whether it may interrupt — which is how a product ends up
 * with four different sentences for the same lock and a modal nobody
 * remembers adding. A gate here declares what it locks, which quota governs
 * it, which tier of surface it is allowed to use, and the words the sheet
 * says. `test:entitlement-gates` fails if a gate is missing any of them.
 *
 * ── Tier is a ceiling, not a preference ────────────────────────────────
 *
 *   tier 1 — inline lock badge only (the card stays rendered and tappable)
 *   tier 2 — may open the contextual unlock sheet when TAPPED
 *   tier 3 — may take the whole screen, and only after a success event
 *
 * Nothing here is tier 3. The full-screen modal is triggered by wins, not by
 * gates, which is the whole point of Part 3 — see `MOMENT_OF_WIN_EVENTS`.
 *
 * ── Copy interpolation ─────────────────────────────────────────────────
 *
 * `title` and `body` may contain `{token}` placeholders filled from the
 * context passed to the sheet. `interpolate()` leaves an unknown token's
 * SURROUNDING text intact and drops the token, so a missing `paperTitle` reads
 * "Save this paper to your phone" rather than "Save {paperTitle} to your
 * phone" — a placeholder printed to a learner is the most visible kind of bug
 * and the least likely to be caught by a test that only checks the sheet
 * opened.
 */

/**
 * How many past papers a free learner may open per week.
 *
 * This is the painless volume limit the design leans on so the in-paper
 * question count does not have to do the work. Read it from
 * `useEntitlements`, never inline — and note that changing it changes what
 * existing free learners can reach, so it is a product decision with a number
 * attached rather than a tuning knob.
 */
export const FREE_PAPERS_PER_WEEK = 3

/**
 * Surfaces, in the order of how much they cost the learner's attention.
 * Exported so `interruptionBudget` and the analytics events name the same
 * things the registry does.
 */
export const TIER = Object.freeze({
  AMBIENT: 0,      // PlanChip
  INLINE: 1,       // LockBadge, locked card styling
  CONTEXTUAL: 2,   // ContextualUnlockSheet, opened by a tap
  FULL_SCREEN: 3,  // MomentOfWinModal
  BELL: 4,         // notification centre
})

/**
 * The ONLY events that may open a tier-3 modal. A trigger not on this list is
 * refused by `MomentOfWinModal` — mount, route change and sign-in are not
 * success events, and the test asserts each of them is rejected.
 */
export const MOMENT_OF_WIN_EVENTS = Object.freeze([
  'quiz_completed',
  'streak_extended',
  'note_topic_completed',
  'teacher_document_exported',
])

export const FEATURE_GATES = {
  /*
   * The whole-product ask, for the surfaces that are not about one
   * feature: a learner who reached a price list or an upgrade banner.
   *
   * It exists because those surfaces have to send an under-18 learner
   * SOMEWHERE, and every other gate here names one thing ("open more past
   * papers", "see what you got wrong"). Reusing PAPER_OPEN there would put
   * a message about past papers in front of a guardian whose child was
   * asking about ZedExams — a request the parent cannot match to anything
   * their child did.
   *
   * No `quota`: nothing counts down to it. It is reached by arriving at a
   * price, which is not a thing a learner runs out of.
   */
  FULL_ACCESS: {
    tier: TIER.CONTEXTUAL,
    icon: '🔓',
    title: 'Unlock everything on ZedExams',
    body: 'Every past paper, every quiz and full marking for your grade.',
  },

  PAPER_OPEN: {
    quota: 'papersThisWeek',
    tier: TIER.CONTEXTUAL,
    icon: '📄',
    title: 'Open more past papers',
    body: "You've opened your {quota} free papers this week. Unlock every paper for your grade.",
  },

  // NOT a sheet. The in-paper free set never interrupts; this gate is rendered
  // inline on the results screen by <PaperContinueLock />, after the learner
  // has been paid in feedback for the work they did. See Part 3.5.
  PAPER_CONTINUE: {
    tier: TIER.CONTEXTUAL,
    surface: 'results-inline',
    icon: '🔒',
    title: '{remaining} more questions in this paper',
    body: 'Finish the whole {paperYear} paper and get it marked like the real exam.',
  },

  PAPER_OFFLINE: {
    tier: TIER.CONTEXTUAL,
    icon: '⬇️',
    title: 'Read this paper without data',
    body: 'Save {paperTitle} to your phone and open it anywhere — no bundles needed.',
  },

  // Marking of questions the learner has ALREADY ANSWERED is free on every
  // plan, permanently. This gate covers the papers they have not finished —
  // it must never be placed in front of a free set's own results.
  AUTO_MARKING: {
    tier: TIER.CONTEXTUAL,
    icon: '✅',
    title: 'See what you got wrong',
    body: 'Get your marked paper with the topics you need to work on.',
  },

  NOTES_OTHER_TERMS: {
    tier: TIER.CONTEXTUAL,
    icon: '📚',
    // Term-NEUTRAL on purpose: the old copy named Term 1 and Term 2, which is
    // only true for a learner sitting in Term 3. Which terms are locked
    // depends on the date, and a gate registry is not where the calendar is
    // read — so the copy names the relationship instead of the numbers.
    title: 'Open the other terms’ notes',
    body: 'Your current term stays free. Unlock the rest of the year to revise everything at once.',
  },

  LIVE_CHALLENGE: {
    tier: TIER.CONTEXTUAL,
    icon: '⚡',
    title: 'Challenge a friend',
    body: 'Race a classmate through a paper and compare your marks afterwards.',
  },

  TEACHER_AI_GEN: {
    quota: 'aiGenerationsThisMonth',
    tier: TIER.CONTEXTUAL,
    icon: '✨',
    title: 'Keep generating',
    body: "You've used your {quota} free generations this month.",
  },

  TEACHER_DOCX: {
    tier: TIER.CONTEXTUAL,
    icon: '📝',
    title: 'Export as Word',
    body: 'PDF export stays free. Word export lets you edit the plan afterwards.',
  },

  TEACHER_BULK: {
    tier: TIER.CONTEXTUAL,
    icon: '📚',
    title: 'Generate a whole set',
    body: "Produce a term's worth of documents in one go instead of one at a time.",
  },
}

export const GATE_IDS = Object.freeze(Object.keys(FEATURE_GATES))

export function getGate(gateId) {
  return FEATURE_GATES[gateId] || null
}

/** Which quota governs a gate, or null for a gate that is plan-only. */
export function gateQuota(gateId) {
  return FEATURE_GATES[gateId]?.quota || null
}

/**
 * Fill `{token}` placeholders from a context object.
 *
 * A token with no value is REMOVED rather than left in place, and the
 * surrounding whitespace is collapsed, because the failure mode this protects
 * against is a raw `{paperTitle}` reaching a learner's screen.
 */
export function interpolate(template, context = {}) {
  if (typeof template !== 'string') return ''
  return template
    .replace(/\{(\w+)\}/g, (_, key) => {
      const value = context[key]
      if (value == null || value === '') return ''
      return String(value)
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The gate's copy, resolved for one context.
 * Returns `null` for an unknown gate id so a caller renders nothing rather
 * than an empty sheet with a CTA in it.
 */
export function resolveGateCopy(gateId, context = {}) {
  const gate = getGate(gateId)
  if (!gate) return null
  return {
    id: gateId,
    icon: gate.icon,
    tier: gate.tier,
    surface: gate.surface || 'sheet',
    quota: gate.quota || null,
    title: interpolate(gate.title, context),
    body: interpolate(gate.body, context),
  }
}
