// Shared, dependency-free constants + helpers for the learner/teacher
// suggestion & request box. Kept free of React/Firestore imports so the
// allowlists can be unit-tested with plain `node` and so the values stay
// the single source of truth shared between the submit dialog
// (FeedbackDialog) and the Firestore validator in firestore.rules.
//
// IMPORTANT: FEEDBACK_TYPE_VALUES and KNOWN_FEEDBACK_ROLES must stay in
// sync with the `match /feedback/{...}` create rule in firestore.rules —
// if they drift, a valid client submission is silently rejected by
// Firestore (or worse, the rule accepts a value the UI never offers).

export const FEEDBACK_TYPES = [
  { value: 'suggestion', label: '💡 Suggestion',          hint: 'An idea to make ZedExams better' },
  { value: 'content',    label: '📚 Content request',     hint: 'A subject, topic, past paper or quiz you want us to add' },
  { value: 'feature',    label: '✨ Feature request',     hint: 'A new tool or capability you wish you had' },
  { value: 'bug',        label: '🐞 Something is broken',  hint: 'Report a problem you ran into' },
  { value: 'other',      label: '💬 Something else',       hint: '' },
]

export const FEEDBACK_TYPE_VALUES = FEEDBACK_TYPES.map(t => t.value)

// Roles the feedback rule accepts. Mirrors the contactMessages role set
// plus 'admin' (an admin can dogfood the box too).
export const KNOWN_FEEDBACK_ROLES = ['parent', 'teacher', 'school', 'learner', 'admin', 'other']

// Admin review workflow states. 'new' is pinned on create by the rules;
// only admins move a row along.
export const FEEDBACK_STATUSES = ['new', 'planned', 'done', 'declined']

export function isValidFeedbackType(type) {
  return FEEDBACK_TYPE_VALUES.includes(type)
}

// Map a raw user-profile role onto one the feedback rule accepts. Unknown
// or missing roles fall back to 'other' so a submission is never rejected
// purely on an unexpected role string; 'superAdmin' collapses to 'admin'.
export function normalizeFeedbackRole(role) {
  if (role === 'superAdmin') return 'admin'
  return KNOWN_FEEDBACK_ROLES.includes(role) ? role : 'other'
}
