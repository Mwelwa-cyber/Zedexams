/**
 * Pure error-message mapping for the Test Paper Studio diagram tools.
 *
 * Split out of testPaperDiagram.js (which imports firebase/functions and so
 * can't be unit-tested under plain `node`) following the repo's *Core split
 * pattern. These map a callable error — a Firebase HttpsError surfaced to the
 * client, or the client-side timeout wrapper's plain Error — onto a teacher-
 * facing string the review screen shows in red beside the figure.
 *
 * Design note (2026-06): the redraw used to collapse EVERY `internal` error
 * into one vague "took too long or hit an error" line, hiding the descriptive
 * reason the server attaches ("Diagram redraw failed: OpenAI rejected the image
 * request…"). Every distinct failure then looked identical, so a recurring
 * redraw failure gave the teacher (and us) nothing to act on. We now surface
 * the server's reason when it has one, and reserve the generic line for the
 * genuine no-message cases: a platform-killed instance ("internal" with no
 * body) or a real deadline.
 */

// True for a Firebase callable error whose code is `internal` but carries no
// real reason — the signature of an instance the platform aborted mid-await
// (e.g. a generation that ran past the function timeout), where the callable's
// own try/catch never ran to attach a message.
function isBareInternal(code, msg) {
  return code.includes('internal') && (!msg || msg.toLowerCase() === 'internal')
}

// Recognise a genuine timeout from either the server (HttpsError
// `deadline-exceeded`) or the client-side withTimeout wrapper (a plain Error
// whose message mentions timing out).
function isTimeout(code, msg) {
  return code.includes('deadline-exceeded') || /took too long|timed out/i.test(msg)
}

export function messageFromError(error) {
  const code = error?.code || ''
  const msg = (error?.message || '').trim()
  if (code.includes('resource-exhausted')) {
    return 'Monthly diagram limit reached. Upgrade your plan or try again next month.'
  }
  if (code.includes('permission-denied')) {
    return 'Diagram tools are only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to redraw diagrams.'
  }
  if (code.includes('failed-precondition') && /not configured|rotate|looks invalid/i.test(msg)) {
    // Config/key problems the admin must fix — surface the server's wording.
    return msg || 'Diagram generation is not available — admin needs to configure the image key.'
  }
  // A genuine timeout (the provider or the whole fallback chain ran past its
  // deadline) — friendly and actionable.
  if (isTimeout(code, msg)) {
    return 'The diagram service took too long. Try again, or keep / clean the original image instead.'
  }
  // A platform-killed instance leaves a bare "internal" with no reason — show
  // the generic line since there is nothing specific to report.
  if (isBareInternal(code, msg) || !msg) {
    return 'The diagram service took too long or hit an error. Try again, or keep / clean the original image instead.'
  }
  // Any other error carries a descriptive server reason. Surface it (stripped of
  // the internal "Diagram redraw failed:" prefix) so the failure is diagnosable,
  // and still point at the no-cost fallback.
  const reason = msg.replace(/^Diagram redraw failed:\s*/i, '').replace(/[.\s]+$/, '')
  return `${reason} — or keep / clean the original image instead.`
}

export function messageFromTableError(error) {
  const code = error?.code || ''
  const msg = (error?.message || '').trim()
  if (code.includes('resource-exhausted')) {
    return 'Monthly limit reached. Try again next month or upgrade your plan.'
  }
  if (code.includes('permission-denied')) {
    return 'Table tools are only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to rebuild tables.'
  }
  // The server attaches a helpful, specific reason for these (e.g. "No table
  // could be read from this figure. Try Redraw…") — surface it as-is.
  if (code.includes('failed-precondition') && msg) return msg
  if (isTimeout(code, msg)) {
    return 'Rebuilding the table took too long. Please choose another option below.'
  }
  if (isBareInternal(code, msg) || !msg) {
    return 'Could not rebuild this table automatically. Please choose another option below.'
  }
  return msg
}
