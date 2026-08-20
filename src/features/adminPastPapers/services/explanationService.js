/**
 * The client half of §6's authoring pipeline.
 *
 * Four callables, all staff-only and all server-authoritative. Nothing here
 * decides anything: the drafter's word limits, the "did it name a specific
 * mistake" check and the approve/edit/reject state machine are all in
 * `functions/paperQuiz/explanationCore.js`, because they are the rules that
 * decide what a child eventually reads and the browser is not where those live.
 *
 * Every call resolves rather than rejecting — a reviewer with sixty rows open
 * should be told which one failed, not handed a broken screen.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

let functionsRef = null
function fns() {
  if (!functionsRef) functionsRef = getFunctions(app, 'us-central1')
  return functionsRef
}

async function call(name, payload) {
  try {
    const res = await httpsCallable(fns(), name)(payload)
    return { ok: true, data: res?.data || {} }
  } catch (err) {
    return { ok: false, message: err?.message || 'That did not work. Please try again.', data: {} }
  }
}

/** The review queue: one row per question, plus paper-level coverage. */
export function loadExplanationQueue(paperId) {
  return call('paperExplanationQueue', { paperId })
}

/**
 * Draft explanations for a paper.
 *
 * `redraft` re-runs questions that already carry a draft. It never touches an
 * APPROVED one — a human wrote or blessed that prose, and a bulk re-run that
 * replaced it would undo a reviewer's work and reset the question to
 * unapproved. The server enforces that; this flag only chooses between
 * "questions with nothing" and "those plus existing drafts".
 */
export function draftExplanations({ paperId, questionIds, redraft = false }) {
  return call('draftPaperExplanations', { paperId, questionIds, redraft })
}

/** Approve, edit or reject ONE question. */
export function reviewExplanation({ quizId, questionId, action, edited }) {
  return call('reviewPaperExplanation', { quizId, questionId, action, edited })
}

/**
 * Approve a batch.
 *
 * The ids are the ones the reviewer was SHOWN. The server intersects them with
 * what is still `ai_draft`, so a question that arrived between the screen
 * rendering and the button being pressed is not approved — the reviewer did
 * not read it, and that is the entire safeguard on an action whose purpose is
 * not reading things one at a time.
 */
export function bulkApprove({ quizId, questionIds }) {
  return call('bulkApproveExplanations', { quizId, questionIds })
}
