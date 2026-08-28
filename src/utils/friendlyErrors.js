/**
 * src/utils/friendlyErrors.js
 *
 * THE single source of truth for turning a technical failure into a
 * human-friendly, actionable message.
 *
 * Why this exists: before this module the app had a dozen ad-hoc maps —
 * `FRIENDLY` in Login.jsx, another in Register.jsx, `messageFromError` in
 * aiAssistant.js, raw `error.message` echoed straight to learners in many
 * catch blocks. A Zambian learner on a flaky 3G connection should never see
 * "FirebaseError: Missing or insufficient permissions" or "Internal Server
 * Error (500)". They should see a calm title, a plain explanation, and a
 * button that gets them unstuck.
 *
 * Design:
 *   - PURE. No React, no Firebase, no `import.meta`. Safe to unit-test under
 *     plain `node` (see friendlyErrors.test.js) and safe to import anywhere.
 *   - Every friendly error is `{ title, message, actions, severity, icon,
 *     code, category }`:
 *       title    — short, reassuring headline ("No Internet Connection")
 *       message  — what happened + (when known) why + what to do next
 *       actions  — ordered list of semantic ACTION keys the UI renders as
 *                  buttons (the UI owns wiring each key to a handler)
 *       severity — 'info' | 'warning' | 'error' | 'critical' (drives tone/log)
 *       icon     — an emoji glyph so the card always has an illustration with
 *                  zero extra imports
 *       code     — the original technical code/status, kept for admin logging
 *       category — coarse bucket ('network', 'auth', 'payment', …)
 *
 * Two entry points:
 *   - `toFriendlyError(error, opts)` — give it anything you caught (Error,
 *     Firebase error, string, HTTP response shape) and it figures out the
 *     friendliest match.
 *   - `friendlyTemplate(key, overrides)` — when you already know the exact
 *     situation (e.g. "the quiz was already submitted") just name it.
 *
 * Plus `friendlyMessage(error, fallback)` for the common case where a call
 * site only wants the message string (drop-in upgrade for getErrorMessage).
 */

// ── Semantic action keys ────────────────────────────────────────────────
// The UI (ErrorState) maps each key to a label + handler. Keeping them as
// stable string constants means a translator and a renderer never drift.
export const ACTIONS = Object.freeze({
  RETRY: 'retry',
  REFRESH: 'refresh',
  GO_BACK: 'goBack',
  GO_HOME: 'goHome',
  CONTACT_SUPPORT: 'contactSupport',
  REPORT_PROBLEM: 'reportProblem',
  CONTINUE_OFFLINE: 'continueOffline',
  SIGN_IN: 'signIn',
  CREATE_ACCOUNT: 'createAccount',
  FORGOT_PASSWORD: 'forgotPassword',
  CHOOSE_FILE: 'chooseFile',
  EDIT_REQUEST: 'editRequest',
  CHOOSE_PAYMENT: 'choosePayment',
  UPGRADE: 'upgrade',
})

// Default human labels for each action key. The renderer may override, but
// having sensible defaults here keeps every call site terse.
export const ACTION_LABELS = Object.freeze({
  [ACTIONS.RETRY]: 'Try Again',
  [ACTIONS.REFRESH]: 'Refresh',
  [ACTIONS.GO_BACK]: 'Go Back',
  [ACTIONS.GO_HOME]: 'Go Home',
  [ACTIONS.CONTACT_SUPPORT]: 'Contact Support',
  [ACTIONS.REPORT_PROBLEM]: 'Report Problem',
  [ACTIONS.CONTINUE_OFFLINE]: 'Continue Offline',
  [ACTIONS.SIGN_IN]: 'Sign In',
  [ACTIONS.CREATE_ACCOUNT]: 'Create Account',
  [ACTIONS.FORGOT_PASSWORD]: 'Forgot Password',
  [ACTIONS.CHOOSE_FILE]: 'Choose Another File',
  [ACTIONS.EDIT_REQUEST]: 'Edit Request',
  [ACTIONS.CHOOSE_PAYMENT]: 'Choose Another Payment Method',
  [ACTIONS.UPGRADE]: 'Upgrade to Pro',
})

export const SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
})

// ── Named templates ─────────────────────────────────────────────────────
// Every well-known situation in the product, keyed so a call site can ask
// for it by name. `toFriendlyError` also resolves into these via heuristics.
// Keep titles in Title Case and messages to three calm sentences at most.
export const TEMPLATES = Object.freeze({
  // -- Connectivity / infrastructure -------------------------------------
  network: {
    category: 'network',
    severity: SEVERITY.WARNING,
    icon: '📡',
    title: 'No Internet Connection',
    message:
      "We couldn't connect to the internet. Please check your connection and try again.",
    actions: [ACTIONS.RETRY, ACTIONS.CONTINUE_OFFLINE],
  },
  server: {
    category: 'server',
    severity: SEVERITY.ERROR,
    icon: '🛠️',
    title: 'Something Went Wrong',
    message:
      'Our servers are having a small problem. Please try again in a few moments.',
    actions: [ACTIONS.RETRY, ACTIONS.CONTACT_SUPPORT],
  },
  timeout: {
    category: 'network',
    severity: SEVERITY.WARNING,
    icon: '⏳',
    title: 'This Is Taking Too Long',
    message:
      "The request is taking longer than usual — your connection may be slow. Please wait a moment and try again.",
    actions: [ACTIONS.RETRY],
  },

  // -- Authentication ----------------------------------------------------
  wrongPassword: {
    category: 'auth',
    severity: SEVERITY.WARNING,
    icon: '🔑',
    title: 'Incorrect Password',
    message: 'The password you entered is incorrect. Please try again.',
    actions: [ACTIONS.FORGOT_PASSWORD],
  },
  accountNotFound: {
    category: 'auth',
    severity: SEVERITY.WARNING,
    icon: '🔍',
    title: 'Account Not Found',
    message: "We couldn't find an account with that email address.",
    actions: [ACTIONS.CREATE_ACCOUNT, ACTIONS.RETRY],
  },
  sessionExpired: {
    category: 'auth',
    severity: SEVERITY.WARNING,
    icon: '🔒',
    title: 'Session Expired',
    message: "For your security, you've been signed out. Please sign in again.",
    actions: [ACTIONS.SIGN_IN],
  },
  tooManyAttempts: {
    category: 'auth',
    severity: SEVERITY.WARNING,
    icon: '🛑',
    title: 'Too Many Attempts',
    message:
      'For your security we have paused sign-in for a few minutes. Please wait and try again.',
    actions: [ACTIONS.FORGOT_PASSWORD],
  },

  // -- Permissions -------------------------------------------------------
  permission: {
    category: 'permission',
    severity: SEVERITY.WARNING,
    icon: '🚫',
    title: 'Access Restricted',
    message: "You don't have permission to access this feature.",
    actions: [ACTIONS.GO_BACK],
  },

  // -- File upload -------------------------------------------------------
  fileTooLarge: {
    category: 'upload',
    severity: SEVERITY.WARNING,
    icon: '📦',
    title: 'File Too Large',
    message: 'That file is too big to upload. Please choose a smaller file.',
    actions: [ACTIONS.CHOOSE_FILE],
  },
  unsupportedFileType: {
    category: 'upload',
    severity: SEVERITY.WARNING,
    icon: '📄',
    title: 'Unsupported File Type',
    message:
      "This file type isn't supported. Please upload a supported format and try again.",
    actions: [ACTIONS.CHOOSE_FILE],
  },
  corruptFile: {
    category: 'upload',
    severity: SEVERITY.WARNING,
    icon: '🧩',
    title: 'Unable to Read File',
    message: 'The selected file appears to be damaged or unreadable.',
    actions: [ACTIONS.CHOOSE_FILE],
  },

  // -- AI generation -----------------------------------------------------
  aiFailed: {
    category: 'ai',
    severity: SEVERITY.ERROR,
    icon: '🤖',
    title: "AI Couldn't Complete Your Request",
    message:
      "The AI couldn't finish generating your content. Please try again.",
    actions: [ACTIONS.RETRY, ACTIONS.EDIT_REQUEST],
  },
  aiTimeout: {
    category: 'ai',
    severity: SEVERITY.WARNING,
    icon: '⏱️',
    title: 'Generation Taking Longer Than Expected',
    message:
      'This request is taking longer than usual. Please wait or try again.',
    actions: [ACTIONS.RETRY],
  },
  aiLimitReached: {
    category: 'ai',
    severity: SEVERITY.INFO,
    icon: '🌙',
    title: 'Daily Limit Reached',
    message:
      "You've reached today's AI usage limit. Please try again tomorrow.",
    actions: [ACTIONS.GO_BACK],
  },

  // -- Quiz --------------------------------------------------------------
  quizNotFound: {
    category: 'quiz',
    severity: SEVERITY.WARNING,
    icon: '📭',
    title: 'Quiz Not Available',
    message: 'This quiz may have been removed or is no longer available.',
    actions: [ACTIONS.GO_BACK],
  },
  quizAlreadySubmitted: {
    category: 'quiz',
    severity: SEVERITY.INFO,
    icon: '✅',
    title: 'Quiz Already Completed',
    message: "You've already submitted this quiz.",
    actions: [ACTIONS.GO_BACK],
  },
  quizTimeUp: {
    category: 'quiz',
    severity: SEVERITY.INFO,
    icon: '⌛',
    title: 'Time Is Up',
    message:
      'The quiz time has ended. Your answers have been submitted automatically.',
    actions: [ACTIONS.GO_BACK],
  },

  // -- Lesson plan / documents ------------------------------------------
  downloadFailed: {
    category: 'download',
    severity: SEVERITY.ERROR,
    icon: '⬇️',
    title: 'Download Failed',
    message: "We couldn't generate your document. Please try again.",
    actions: [ACTIONS.RETRY],
  },
  lessonGenFailed: {
    category: 'ai',
    severity: SEVERITY.ERROR,
    icon: '📚',
    title: 'Unable to Create Lesson Plan',
    message: "The lesson plan couldn't be generated at the moment.",
    actions: [ACTIONS.RETRY],
  },

  // -- Payments ----------------------------------------------------------
  paymentFailed: {
    category: 'payment',
    severity: SEVERITY.ERROR,
    icon: '💳',
    title: 'Payment Unsuccessful',
    message: "We couldn't process your payment.",
    actions: [ACTIONS.RETRY, ACTIONS.CHOOSE_PAYMENT],
  },
  subscriptionExpired: {
    category: 'payment',
    severity: SEVERITY.INFO,
    icon: '⭐',
    title: 'Subscription Expired',
    message:
      'Your subscription has ended. Renew to continue enjoying Pro features.',
    actions: [ACTIONS.UPGRADE],
  },

  // -- Storage -----------------------------------------------------------
  storageFull: {
    category: 'storage',
    severity: SEVERITY.WARNING,
    icon: '🗄️',
    title: 'Storage Limit Reached',
    message:
      'Your storage is full. Delete unused files or upgrade your plan to free up space.',
    actions: [ACTIONS.UPGRADE, ACTIONS.GO_BACK],
  },

  // -- Generic catch-all -------------------------------------------------
  generic: {
    category: 'unknown',
    severity: SEVERITY.ERROR,
    icon: '😕',
    title: 'Something Went Wrong',
    message:
      'An unexpected problem stopped us in our tracks. Please try again — this usually fixes it.',
    actions: [ACTIONS.RETRY, ACTIONS.REPORT_PROBLEM],
  },
})

/**
 * Return a fresh copy of a named template, optionally overriding any field.
 * Always returns a NEW object (templates are frozen) so callers can safely
 * mutate / spread the result.
 */
export function friendlyTemplate(key, overrides = {}) {
  const base = TEMPLATES[key] || TEMPLATES.generic
  return {
    ...base,
    ...overrides,
    // Never let an override drop the safety net of an array of actions.
    actions: overrides.actions ?? [...base.actions],
  }
}

// ── Auth-form inline messages ────────────────────────────────────────────
// The sign-in / sign-up forms want a single calm SENTENCE next to the field,
// not the full ErrorState card. This is the one place that copy lives now —
// it replaces the duplicated `FRIENDLY` maps that used to sit in Login.jsx
// and Register.jsx. `flow` selects sign-in vs sign-up phrasing for the
// Google-specific failures (the only codes whose copy differed between the
// two forms).
const AUTH_MESSAGES_SHARED = {
  'auth/invalid-credential': 'Wrong email or password. Please try again.',
  'auth/invalid-login-credentials': 'Wrong email or password. Please try again.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/wrong-password': 'Wrong password. Please try again.',
  'auth/too-many-requests': 'Too many attempts — please wait a few minutes.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/network-request-failed': 'Couldn’t reach the sign-in server. Check your connection and tap Sign In again.',
  'auth/operation-not-allowed': 'Email and password sign-in is not available right now.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/popup-blocked':
    'Your browser blocked the Google sign-in popup. Please allow popups and try again.',
  'auth/account-exists-with-different-credential':
    'An account already exists with this email. Sign in with the original method.',
  'auth/email-already-in-use': 'This email is already registered. Try logging in.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  // Thrown by src/firebase/config.js's assertAuthAttested() when App Check
  // enforcement is on for Authentication and only the fail-open placeholder
  // token (appCheckResilient.js) is available after one forced refresh —
  // e.g. reCAPTCHA Enterprise timed out or crashed. About the device check,
  // not the credentials, so it must never collapse into the generic
  // "Login failed" fallback that reads as a wrong password.
  'appcheck/unattested': "We couldn't verify this device just now. Please check your connection and try again in a moment.",
}

/**
 * Friendly one-line copy for a Firebase Auth error code, used inline on the
 * sign-in / sign-up forms.
 *
 * @param {string} code  Firebase auth code, e.g. 'auth/wrong-password'.
 * @param {object} opts
 *   flow     — 'signin' (default) | 'signup'; picks the Google verb.
 *   online   — pass navigator.onLine. When the device is demonstrably online
 *              but Firebase Auth still reports `auth/network-request-failed`,
 *              the problem is NOT the user's connection — the SDK's request to
 *              Google's sign-in servers (identitytoolkit / reCAPTCHA) is being
 *              blocked (VPN, ad-blocker, privacy/browser extension, corporate
 *              firewall, or a network that filters Google). The default
 *              "check your connection" copy actively misdirects those users, so
 *              when online===true we point them at the real culprits instead.
 *   fallback — copy when the code is unmapped (default per flow).
 */
export function friendlyAuthMessage(code, opts = {}) {
  const flow = opts.flow === 'signup' ? 'signup' : 'signin'
  // "sign-in" / "sign-up" (noun) and "sign in" / "sign up" (verb).
  const noun = flow === 'signup' ? 'sign-up' : 'sign-in'
  const verb = flow === 'signup' ? 'sign up' : 'sign in'
  // A network failure on a device that IS online means Google's auth server is
  // being blocked locally, not that the user is offline — give actionable copy.
  if (code === 'auth/network-request-failed' && opts.online === true) {
    return `We reached the internet but couldn’t contact the ${noun} server. This is usually a VPN, ad-blocker, or a privacy/browser extension blocking Google — turn those off (or try a different browser or network) and ${verb} again.`
  }
  const googleMessages = {
    'auth/operation-not-supported-in-this-environment': `Google ${noun} isn’t available in this app build. Please update the app from the Play Store, or ${verb} with your email and password.`,
    'auth/google-no-id-token': `Google ${noun} could not be completed. Please update the app, or ${verb} with your email and password.`,
    'auth/google-developer-error': `Google ${noun} isn’t set up for this app version yet. Please ${verb} with your email and password for now.`,
  }
  const fallback =
    opts.fallback ||
    (flow === 'signup'
      ? 'Registration failed. Please try again.'
      : 'Login failed. Please try again.')
  return AUTH_MESSAGES_SHARED[code] || googleMessages[code] || fallback
}

// ── Firebase code → template lookups ─────────────────────────────────────
// Exhaustive enough to cover what the app actually surfaces. Anything not
// listed falls through to category heuristics, then `generic`.
const AUTH_CODE_TEMPLATES = {
  'auth/wrong-password': 'wrongPassword',
  'auth/invalid-credential': 'wrongPassword',
  'auth/invalid-login-credentials': 'wrongPassword',
  'auth/user-not-found': 'accountNotFound',
  'auth/user-disabled': 'accountNotFound',
  'auth/too-many-requests': 'tooManyAttempts',
  'auth/network-request-failed': 'network',
  'auth/requires-recent-login': 'sessionExpired',
  'auth/user-token-expired': 'sessionExpired',
  'auth/id-token-expired': 'sessionExpired',
  'auth/session-cookie-expired': 'sessionExpired',
}

// Firebase Functions / Firestore canonical error codes (the part after the
// slash, e.g. `functions/permission-denied` or `permission-denied`).
const STATUS_CODE_TEMPLATES = {
  'permission-denied': 'permission',
  unauthenticated: 'sessionExpired',
  'resource-exhausted': 'aiLimitReached',
  unavailable: 'network',
  'deadline-exceeded': 'timeout',
  'not-found': 'generic',
  internal: 'server',
  unknown: 'server',
  cancelled: 'timeout',
}

// Cloud Storage error codes.
const STORAGE_CODE_TEMPLATES = {
  'storage/unauthorized': 'permission',
  'storage/unauthenticated': 'sessionExpired',
  'storage/quota-exceeded': 'storageFull',
  'storage/retry-limit-exceeded': 'network',
  'storage/canceled': 'timeout',
  'storage/object-not-found': 'generic',
}

function lc(value) {
  return String(value == null ? '' : value).toLowerCase()
}

/**
 * Pull the canonical code/status/message out of whatever was caught.
 * Handles: Error subclasses, Firebase errors ({ code }), httpsCallable
 * errors ({ code: 'functions/...' }), fetch Response-ish objects
 * ({ status }), strings, and plain objects.
 */
export function normalizeError(error) {
  if (error == null) return { code: '', status: 0, message: '' }
  if (typeof error === 'string') return { code: '', status: 0, message: error }

  const code = typeof error.code === 'string' ? error.code : ''
  const rawStatus =
    error.status ?? error.statusCode ?? error.httpStatus ?? error.response?.status
  let status = Number(rawStatus)
  if (!Number.isFinite(status)) status = 0

  let message = ''
  if (typeof error.message === 'string') message = error.message
  else if (typeof error.reason === 'string') message = error.reason
  else if (typeof error.error === 'string') message = error.error

  // Some servers only encode the status inside the message, e.g.
  // "Internal Server Error (500)" or "Request failed with status code 503".
  if (!status) {
    const m = message.match(/\b(4\d\d|5\d\d)\b/)
    if (m) status = Number(m[1])
  }

  return { code, status, message }
}

/**
 * True when the failure looks like a connectivity problem rather than a
 * real application error. Checked first because an offline learner hitting
 * any feature deserves the network card, not a scary server card.
 */
export function looksOffline(error, { online } = {}) {
  // Explicit signal from the caller (navigator.onLine) wins.
  if (online === false) return true
  const { code, message } = normalizeError(error)
  const c = lc(code)
  const m = lc(message)
  if (c === 'auth/network-request-failed') return true
  if (c.endsWith('/unavailable') || c === 'unavailable') return true
  if (c.includes('network')) return true
  return (
    m.includes('network error') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('err_internet_disconnected') ||
    m.includes('connection') && (m.includes('lost') || m.includes('refused')) ||
    m.includes('offline')
  )
}

/**
 * The main entry point. Returns a complete friendly-error object.
 *
 * options:
 *   category — bias resolution toward a domain when the same generic
 *              failure means different things in different places. e.g.
 *              `toFriendlyError(err, { category: 'payment' })` makes an
 *              otherwise-unrecognised failure read as "Payment Unsuccessful"
 *              instead of the generic card.
 *   online   — pass navigator.onLine so an offline device always gets the
 *              network card even when the underlying error is generic.
 *   fallback — template key to use when nothing else matches (default
 *              'generic', or the category's natural failure template).
 */
export function toFriendlyError(error, options = {}) {
  const { category, online, fallback } = options
  const norm = normalizeError(error)
  const { code, status } = norm
  const c = lc(code)

  const finalize = (key, extra) =>
    friendlyTemplate(key, { code: code || (status ? `http/${status}` : ''), ...extra })

  // 1. Connectivity always wins — never show a server/permission card to a
  //    device that simply lost its connection.
  if (looksOffline(error, { online })) return finalize('network')

  // 2. Exact Firebase Auth codes.
  if (AUTH_CODE_TEMPLATES[c]) return finalize(AUTH_CODE_TEMPLATES[c])

  // 3. Storage codes.
  if (STORAGE_CODE_TEMPLATES[c]) return finalize(STORAGE_CODE_TEMPLATES[c])

  // 4. Functions / Firestore canonical codes (strip any `prefix/`).
  const bare = c.includes('/') ? c.slice(c.indexOf('/') + 1) : c
  if (STATUS_CODE_TEMPLATES[bare]) {
    // `resource-exhausted` maps to the AI daily-cap card ("try again
    // tomorrow") ONLY when the caller is an AI surface (category 'ai').
    // Anywhere else it's a transient backend quota / write-rate limit, not a
    // day-long cap — so fall through and let the category fallback (e.g.
    // paymentFailed) or the retryable generic card handle it instead of
    // dead-ending the user with the wrong copy + a Go Back-only action.
    if (!(bare === 'resource-exhausted' && category !== 'ai')) {
      return finalize(STATUS_CODE_TEMPLATES[bare])
    }
  }

  // 5. HTTP status families.
  if (status === 401) return finalize('sessionExpired')
  if (status === 403) return finalize('permission')
  if (status === 408 || status === 504) return finalize('timeout')
  if (status === 429) {
    return finalize(category === 'auth' ? 'tooManyAttempts' : 'aiLimitReached')
  }
  if (status >= 500 && status <= 599) return finalize('server')

  // 6. Domain-category fallback — when we know WHERE the error happened even
  //    if we can't classify WHAT it was.
  const categoryFallback = {
    payment: 'paymentFailed',
    ai: 'aiFailed',
    quiz: 'quizNotFound',
    upload: 'corruptFile',
    download: 'downloadFailed',
    auth: 'generic',
    storage: 'storageFull',
  }[category]
  if (categoryFallback) return finalize(categoryFallback)

  // 7. Nothing matched.
  return finalize(fallback || 'generic')
}

/**
 * Convenience for call sites that only want a sentence to drop into a toast
 * or inline `<p>`. A friendly upgrade over `getErrorMessage`: it maps codes
 * rather than echoing raw `error.message`.
 */
export function friendlyMessage(error, fallback) {
  const friendly = toFriendlyError(error)
  if (friendly.category === 'unknown' && typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim()
  }
  return friendly.message
}

/**
 * Compact admin/developer log payload. Friendly copy is for the learner;
 * THIS is what gets forwarded to PostHog / Sentry so a developer can see the
 * real code, status, and (clipped) raw message behind the gentle card.
 */
export function technicalDetails(error, context = {}) {
  const { code, status, message } = normalizeError(error)
  const friendly = toFriendlyError(error, context)
  // The stack is the single most useful field for an admin triaging a bug —
  // a 300-char message rarely locates it. Guarded (only Error instances have
  // one) and clipped so a huge stack can't bloat the analytics event.
  const stack =
    error && typeof error.stack === 'string' ? error.stack.slice(0, 2000) : undefined
  return {
    code: code || (status ? `http/${status}` : ''),
    status: status || undefined,
    category: friendly.category,
    severity: friendly.severity,
    rawMessage: String(message || '').slice(0, 300),
    stack,
  }
}
