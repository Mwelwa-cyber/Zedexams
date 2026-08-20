"use strict";

/**
 * §6's decisions: what a draft must satisfy, and what a review may do to it.
 *
 * Pure — no Firestore, no Anthropic — so the word limits, the refusal paths
 * and the state machine are all driven under plain node.
 *
 * ── Why a draft is VALIDATED and not just stored ─────────────────────────
 *
 * A reviewer reading 60 drafts approves at the speed of the worst one. Every
 * rule here that a machine can check ("did it write a distractor for every
 * wrong option", "is `why` under 40 words", "did it name a specific mistake or
 * did it type 'this is incorrect'") is a rule the reviewer does not have to
 * spend attention on — so their attention goes to the one thing only a person
 * can judge, which is whether the explanation is TRUE.
 *
 * A draft failing these is not stored as a draft. It is stored as nothing, and
 * the question stays `missing` — which the learner-facing gate already handles
 * by showing the answer alone.
 */

const {EXPLANATION_STATUS} = {
  EXPLANATION_STATUS: {MISSING: "missing", AI_DRAFT: "ai_draft", APPROVED: "approved"},
};

/** §6's word limits. */
const WHY_MAX_WORDS = 40;
const DISTRACTOR_MAX_WORDS = 30;

/**
 * Phrases that are not explanations.
 *
 * "Each distractors entry must name the SPECIFIC mistake behind that option —
 * not 'this is incorrect'." A model under pressure produces exactly these, and
 * they read as filled-in rather than empty, which is what makes them worth
 * catching by machine: a reviewer skimming sixty rows will approve them.
 */
const EMPTY_PHRASES = [
  /^this (is|option is) (not correct|incorrect|wrong)\.?$/i,
  /^(that|this) (does not|doesn't) (fit|work|apply)\.?$/i,
  /^(it is|its|it's) (not|never) (the )?(right|correct) (answer|one)\.?$/i,
  /^wrong\.?$/i,
  /^incorrect\.?$/i,
  /^not the answer\.?$/i,
];

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function isEmptyPhrase(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  return EMPTY_PHRASES.some((re) => re.test(t));
}

/**
 * Validate one drafted explanation against the question it explains.
 *
 * @returns {{ok: boolean, problems: string[], draft: object|null}}
 */
function validateDraft({draft, question}) {
  const problems = [];
  if (!draft || typeof draft !== "object") {
    return {ok: false, problems: ["the model returned nothing usable"], draft: null};
  }

  // The model's own refusal is honoured FIRST and is not an error — it is the
  // path the prompt asks for when the material does not support an
  // explanation, and treating it as a failure would train the next iteration
  // of the prompt to stop using it.
  if (draft.confident === false) {
    return {
      ok: false,
      refused: true,
      problems: [draft.concern ? String(draft.concern).slice(0, 400) : "the model was not confident"],
      draft: null,
    };
  }

  const why = String(draft.why || "").trim();
  if (!why) problems.push("no `why` was written");
  else if (words(why) > WHY_MAX_WORDS) problems.push(`\`why\` is ${words(why)} words (max ${WHY_MAX_WORDS})`);
  else if (isEmptyPhrase(why)) problems.push("`why` says nothing");

  const options = Array.isArray(question?.options) ? question.options : [];
  const correctIndex = Number.isInteger(question?.correctIndex) ? question.correctIndex : -1;
  const distractors = (draft.distractors && typeof draft.distractors === "object") ? draft.distractors : {};

  // One entry per WRONG option, and nothing for the right one. A distractor
  // written against the correct answer is a sign the model marked a different
  // option right, which is the failure the prompt's refusal path exists for.
  const wrongLetters = options
      .map((_, i) => (i === correctIndex ? null : String.fromCharCode(65 + i)))
      .filter(Boolean);
  const correctLetter = correctIndex >= 0 ? String.fromCharCode(65 + correctIndex) : "";

  if (correctLetter && distractors[correctLetter]) {
    problems.push(`a distractor was written for ${correctLetter}, which is the correct answer`);
  }
  wrongLetters.forEach((letter) => {
    const text = String(distractors[letter] || "").trim();
    if (!text) problems.push(`no distractor for ${letter}`);
    else if (words(text) > DISTRACTOR_MAX_WORDS) {
      problems.push(`distractor ${letter} is ${words(text)} words (max ${DISTRACTOR_MAX_WORDS})`);
    } else if (isEmptyPhrase(text)) {
      problems.push(`distractor ${letter} does not name a mistake`);
    }
  });

  const example = String(draft.example || "").trim();
  if (!example) problems.push("no `example` was written");

  if (problems.length > 0) return {ok: false, problems, draft: null};

  // Only the wrong options' entries survive, keyed by letter. Anything else
  // the model returned is dropped rather than stored.
  const cleanDistractors = {};
  wrongLetters.forEach((l) => { cleanDistractors[l] = String(distractors[l]).trim(); });

  return {
    ok: true,
    problems: [],
    draft: {
      why,
      distractors: cleanDistractors,
      example,
      explanationStatus: EXPLANATION_STATUS.AI_DRAFT,
    },
  };
}

/**
 * The review actions, and what each writes.
 *
 * Approve is the ONLY thing that sets `approved`, and it stamps who and when
 * (§4.1). Reject clears the prose entirely rather than leaving it as a draft:
 * a rejected explanation that stays on the document is one accidental
 * bulk-approve away from a child reading the thing a reviewer refused.
 */
const REVIEW_ACTION = Object.freeze({
  APPROVE: "approve",
  EDIT: "edit",
  REJECT: "reject",
});

function buildReviewWrite({action, edited, reviewerUid, now}) {
  if (action === REVIEW_ACTION.REJECT) {
    return {
      why: "",
      distractors: {},
      example: "",
      explanationStatus: EXPLANATION_STATUS.MISSING,
      approvedBy: "",
      approvedAt: null,
    };
  }
  const base = {
    explanationStatus: EXPLANATION_STATUS.APPROVED,
    approvedBy: String(reviewerUid || ""),
    approvedAt: now,
  };
  if (action === REVIEW_ACTION.EDIT) {
    // An edited explanation is APPROVED by definition — a human wrote it and
    // pressed save. There is no "edited but unapproved" state to get stuck in.
    return {
      ...base,
      why: String(edited?.why || "").trim(),
      distractors: sanitizeDistractors(edited?.distractors),
      example: String(edited?.example || "").trim(),
    };
  }
  return base;
}

function sanitizeDistractors(value) {
  const out = {};
  if (!value || typeof value !== "object") return out;
  Object.keys(value).slice(0, 12).forEach((k) => {
    const letter = String(k).trim().toUpperCase().slice(0, 1);
    if (!/^[A-H]$/.test(letter)) return;
    const text = String(value[k] || "").trim();
    if (text) out[letter] = text.slice(0, 1500);
  });
  return out;
}

/**
 * Which questions a bulk approve may touch.
 *
 * Only `ai_draft`, and only the ids the reviewer was actually shown. Approving
 * "everything in this part" must not sweep up a question that arrived between
 * the screen rendering and the button being pressed — the reviewer did not
 * read it, and bulk-approve is the one action where that distinction is the
 * whole safeguard.
 */
function selectBulkApprovable({questions, requestedIds}) {
  const wanted = new Set((Array.isArray(requestedIds) ? requestedIds : []).map(String));
  return (Array.isArray(questions) ? questions : [])
      .filter((q) => wanted.has(String(q.id)))
      .filter((q) => q.explanationStatus === EXPLANATION_STATUS.AI_DRAFT)
      .map((q) => String(q.id));
}

module.exports = {
  EXPLANATION_STATUS,
  REVIEW_ACTION,
  WHY_MAX_WORDS,
  DISTRACTOR_MAX_WORDS,
  words,
  isEmptyPhrase,
  validateDraft,
  buildReviewWrite,
  sanitizeDistractors,
  selectBulkApprovable,
};
