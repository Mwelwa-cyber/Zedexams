// src/features/zedChat/lib/askZedCore.js
//
// Pure decisions for the Ask Zed surface (learner redesign step 9,
// prototype-v5). No React, no DOM — tested under plain node by
// scripts/test-ask-zed-core.mjs.

/**
 * Routes where the floating "Ask Zed" pill must not appear, ported from
 * the prototype's fabHidden list: focused/immersive surfaces (runners,
 * viewers, games, the duel), result/leaderboard screens, the chat
 * itself, and every non-learner area. Matching is by prefix so nested
 * routes inherit the rule; note that '/papers/' (trailing slash) hides
 * the viewer/practice/quiz subroutes while the /papers hub keeps the
 * pill — exactly the mockup's split between view-papers and view-viewer.
 */
export const FAB_HIDDEN_PATHS = [
  '/ask-zed',          // already there
  '/exam/',            // daily exam runner
  '/exams/leaderboard',
  '/quiz/',            // quiz runner
  '/results/',         // quiz results (prototype hides on result views)
  '/papers/',          // paper viewer / practice / paper quiz — hub stays
  '/lessons/',         // immersive lesson player
  '/games/play/',      // active game
  '/games/duel',       // Race Zed!
  '/games/leaderboard',
  '/timetable/pdf',    // full-screen ECZ PDF viewer
  '/profile',          // prototype-v6: fab hides on Profile…
  '/settings',         // …Settings…
  '/notifications',    // …and the notification centre
  '/guardian',         // the Guardian Zone is a parent's space, not a child's
  '/family',           // the parent app — see shouldHideFabForRole
  '/admin',            // admin surfaces — distraction
  '/teacher',          // teacher surfaces — distraction
  '/login',
  '/register',
  '/auth/',
  '/pricing',
  '/privacy',
  '/terms',
  '/status',
  '/share/',           // public share view (no auth)
]

export function shouldHideFab(pathname) {
  if (!pathname || pathname === '/') return true // marketing root redirect
  return FAB_HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * Roles the pill never appears for, whatever route they are on.
 *
 * Ask Zed is the LEARNER's study helper: it is grade-scoped, it carries a
 * child-safety system prompt, and every turn is metered against a
 * learner's own allowance. A guardian who taps it is not the person any
 * of that was written for — a parent asking it about their child's
 * homework spends the CHILD's allowance on an answer pitched at the
 * child. So it is refused by role, not only by route: the route list is
 * a list of screens, and a screen added tomorrow inherits nothing from
 * it, whereas a parent account is a parent account everywhere.
 *
 * `/family` is in FAB_HIDDEN_PATHS as well, and deliberately so — an
 * admin looking at the family surface for support gets the same answer
 * as the parent whose screen it is.
 *
 * Unknown or missing roles are NOT hidden: the pill's other guards (auth,
 * the guardian control, the learner's own switch) already decide that
 * case, and defaulting to hidden here would take Ask Zed away from every
 * learner whose profile has not loaded yet.
 */
export const FAB_HIDDEN_ROLES = ['parent']

export function shouldHideFabForRole(role) {
  return FAB_HIDDEN_ROLES.includes(String(role || ''))
}

/** First word of a display name, for the personalised greeting. */
export function firstNameOf(displayName) {
  const first = String(displayName || '').trim().split(/\s+/)[0] || ''
  return first
}

/**
 * The intro card + suggestion chips, per the prototype's azRender():
 * a note context ("Stuck? Ask Zed about this") seeds a topic-specific
 * greeting and chips; otherwise the general study greeting, personalised
 * with the learner's first name and grade when known.
 */
export function buildAskZedIntro({ firstName = '', grade = null, topic = null } = {}) {
  const hi = firstName ? `Hi ${firstName}! 👋` : 'Hi! 👋'
  const cleanTopic = String(topic || '').trim()
  if (cleanTopic) {
    return {
      intro: `${hi} You're learning ${cleanTopic}. Ask me anything about it and I'll explain it simply. 😊`,
      topic: cleanTopic,
      chips: [
        `Explain ${cleanTopic} simply`,
        'Give me an example',
        'Why does it matter in the exam?',
      ],
    }
  }
  const gradeNum = Number(grade)
  const scope = Number.isFinite(gradeNum) && gradeNum > 0 ? `Grade ${gradeNum}` : 'school'
  return {
    intro: `${hi} I'm Zed. Ask me anything about your ${scope} topics and I'll explain it simply. What are you learning today?`,
    topic: null,
    chips: [
      'Help me with fractions',
      'Explain photosynthesis simply',
      'Tell me a fun fact about Zambia',
    ],
  }
}
