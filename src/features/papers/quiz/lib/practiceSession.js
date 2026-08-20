/**
 * Practice's resume state, and the rule for reconciling two of them.
 *
 * §1: practice "resumes where they left off" and is "fully offline". Those two
 * together are what force a merge rather than a read: the device has a local
 * record written while offline, the account has `practiceProgress/{uid}_
 * {paperId}` written from whatever device was last online, and on the next
 * launch both exist and disagree.
 *
 * ── The merge rule, and why it is per-question rather than newest-wins ────
 *
 * Newest-wins throws away work. A learner who did questions 1–10 on a phone
 * with no signal and 1–4 on a school tablet an hour later would, under
 * newest-wins, come back to question 5 — six questions of answered, coached,
 * understood work discarded because the other device happened to sync later.
 *
 * So answers are UNIONED (a question answered anywhere is answered), and only
 * the cursor takes the larger of the two positions. The union is safe because
 * a practice answer is final the moment it is given — the option locks and the
 * coaching opens — so two devices can never hold different answers to the same
 * question that both deserve to survive. Where they somehow do, the local one
 * wins, because it is the one the learner in front of you just gave.
 *
 * Pure: node-tested, no storage, no Firebase.
 */

/** An empty session — never null, so a caller never branches on absence. */
export function emptySession(paperId = '') {
  return {
    paperId: String(paperId || ''),
    lastQuestionN: 0,
    answered: {},
    updatedAt: 0,
  }
}

/** Coerce anything stored or fetched into the shape, dropping junk. */
export function normalizeSession(raw, paperId = '') {
  const base = emptySession(paperId)
  if (!raw || typeof raw !== 'object') return base
  const answered = {}
  const src = raw.answered && typeof raw.answered === 'object' ? raw.answered : {}
  Object.keys(src).forEach((qid) => {
    const v = src[qid]
    // Stored as the chosen option INDEX. A non-integer is a corrupt or
    // half-migrated record and is dropped rather than rendered as a selection
    // the learner never made.
    if (Number.isInteger(v) && v >= 0) answered[String(qid)] = v
  })
  const n = Number(raw.lastQuestionN)
  const at = Number(raw.updatedAt)
  return {
    paperId: String(raw.paperId || paperId || ''),
    lastQuestionN: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    answered,
    updatedAt: Number.isFinite(at) && at > 0 ? at : 0,
  }
}

/**
 * Union two sessions. `local` wins a per-question conflict; the cursor is the
 * further of the two. See the header for why this is not newest-wins.
 */
export function mergeSessions(local, remote, paperId = '') {
  const a = normalizeSession(local, paperId)
  const b = normalizeSession(remote, paperId)
  return {
    paperId: a.paperId || b.paperId || String(paperId || ''),
    lastQuestionN: Math.max(a.lastQuestionN, b.lastQuestionN),
    answered: { ...b.answered, ...a.answered },
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  }
}

/**
 * Where the runner opens.
 *
 * The first UNANSWERED question, not `lastQuestionN + 1`. The two differ
 * whenever a learner jumped, resumed, or came back through a fix-up set, and
 * the first-unanswered reading is the one that never drops a learner onto a
 * question they have already been coached through — which reads as the app
 * having forgotten, and is the exact thing resume exists to prevent.
 *
 * A paper with every question answered opens at the LAST one rather than off
 * the end, so the footer offers "See how you did" instead of a blank screen.
 */
export function resumeIndex({ questions = [], answered = {} } = {}) {
  const list = Array.isArray(questions) ? questions : []
  if (list.length === 0) return 0
  const idx = list.findIndex((q) => !Number.isInteger(answered?.[q?.id]))
  return idx === -1 ? list.length - 1 : idx
}

/** True when there is real work to come back to — drives the resume banner. */
export function hasResumableWork(session, totalQuestions = 0) {
  const s = normalizeSession(session)
  const count = Object.keys(s.answered).length
  return count > 0 && count < Math.max(1, Number(totalQuestions) || 0)
}

/**
 * The document written to `practiceProgress/{uid}_{paperId}`.
 *
 * Deliberately small and deliberately NOT a score: §1's table says practice is
 * not recorded, and the one way that promise breaks is a resume document that
 * accumulates enough to be reported on later. It carries a cursor and which
 * questions were answered — never whether they were right.
 */
export function toProgressDoc(session, { learnerId, paperId }) {
  const s = normalizeSession(session, paperId)
  return {
    learnerId: String(learnerId || ''),
    paperId: String(paperId || ''),
    lastQuestionN: s.lastQuestionN,
    answered: s.answered,
  }
}

/** The id of that document. Keyed uid+paper, so there is one per learner per paper. */
export function progressDocId(learnerId, paperId) {
  return `${learnerId}_${paperId}`
}

/**
 * Which questions a fix-up run covers.
 *
 * The set is passed as ids rather than filtered here so the caller keeps the
 * paper's order; an ordering derived from a Set is whatever the Set felt like,
 * and a fix-up that jumps from question 31 to 12 to 44 reads as broken.
 */
export function selectQuestions(questions = [], ids = []) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String))
  return (Array.isArray(questions) ? questions : []).filter((q) => wanted.has(String(q?.id)))
}
