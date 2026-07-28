/**
 * Making the generator produce exactly the number of answer choices the teacher
 * asked for (§3).
 *
 * ## Two halves, and only one of them can be trusted
 *
 * The prompt half tells the model "every multiple-choice question has exactly
 * four options, labelled A to D". That works most of the time and it is worth
 * doing, because a model given a target writes better distractors than one
 * whose fifth option is thrown away afterwards.
 *
 * The enforcement half is this module, because "the model was told" is not the
 * same as "the model did". A paper that comes back with five options on question
 * 13 and four everywhere else prints an inconsistent section, and the teacher
 * who set A–D gets something else.
 *
 * ## Trimming keeps the ANSWER, not the first four
 *
 * The obvious trim — `options.slice(0, 4)` — deletes the correct answer whenever
 * the model happened to put it last, and the result is a question that prints
 * cleanly, has four plausible options, and cannot be answered correctly. So the
 * correct option is kept and the surplus is taken from the DISTRACTORS, in the
 * order the model wrote them.
 *
 * ## A shortfall is never invented
 *
 * Three options where four were asked for is reported, not padded. A distractor
 * this module made up would be a wrong answer with no pedagogical thought behind
 * it, printed on a real test, and nothing downstream would know it was ours.
 * `paperIntegrityCore` blocks the export and names the question.
 *
 * Plain CommonJS: this runs inside the Cloud Functions generator, not the
 * browser.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** The counts the studio offers, plus the legacy two. */
const MIN_COUNT = 2;
const MAX_COUNT = 5;

/**
 * Coerce a requested count onto something usable, or null when nothing was
 * asked for — in which case the generator's output is left exactly as it came.
 */
function normalizeRequestedCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < MIN_COUNT || rounded > MAX_COUNT) return null;
  return rounded;
}

/**
 * Which option a question's `answer` refers to.
 *
 * The generator writes the answer as full TEXT ("the heart"), but a letter
 * ("B") is accepted too because the picture-MCQ path documents that form. Both
 * are matched case- and punctuation-insensitively, because a model that writes
 * "The heart." for the option "the heart" has still answered the question.
 *
 * Returns -1 when the answer matches nothing, which is a real defect — and one
 * this module must not paper over by guessing index 0.
 */
function correctOptionIndex(options, answer) {
  const list = Array.isArray(options) ? options : [];
  const raw = String(answer ?? "").trim();
  if (!raw || list.length === 0) return -1;

  const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase()
      .replace(/[.．。]+$/, "");
  const target = tidy(raw);

  const exact = list.findIndex((o) => tidy(o) === target);
  if (exact !== -1) return exact;

  // A bare letter, with or without a delimiter: "B", "B.", "(B)".
  const letter = raw.match(/^\(?([A-Za-z])\)?[.):]?$/);
  if (letter) {
    const index = LETTERS.indexOf(letter[1].toUpperCase());
    if (index >= 0 && index < list.length) return index;
  }
  return -1;
}

/**
 * Trim one question's options to `count`, keeping the correct one.
 *
 * Returns `{options, changed, dropped}`. When the answer cannot be located the
 * question is left ALONE: trimming blind would be as likely to delete the answer
 * as to keep it, and an untrimmed question is reported by the integrity gate
 * while a silently-broken one is not.
 */
function trimQuestionOptions(question, count) {
  const options = Array.isArray(question?.options) ? question.options : [];
  if (!count || options.length <= count) return {options, changed: false, dropped: 0};

  const correct = correctOptionIndex(options, question?.answer);
  if (correct === -1) return {options, changed: false, dropped: 0};

  // Keep the correct option in its original position, and fill the remaining
  // slots from the distractors in the order the model wrote them — the order it
  // chose is the order it thought about them in.
  const keep = new Set([correct]);
  for (let i = 0; i < options.length && keep.size < count; i += 1) {
    if (i !== correct) keep.add(i);
  }
  const kept = options.filter((_, i) => keep.has(i));
  return {options: kept, changed: true, dropped: options.length - kept.length};
}

/**
 * Apply the requested count across a whole generated paper.
 *
 * Mutates nothing: returns a new payload plus a report naming every question
 * that was trimmed and every one that came back short. The report is what the
 * generator logs — a silent trim looks identical to a model that got it right,
 * and the difference matters when someone asks why the prompt is not working.
 *
 * @param {object} payload  validateAssessment(...)'s `assessment`
 * @param {number} requested the teacher's answer-choice count
 */
function applyAnswerChoiceCount(payload, requested) {
  const count = normalizeRequestedCount(requested);
  const report = {requested: count, trimmed: [], short: [], unmatched: []};
  if (!count || !payload || !Array.isArray(payload.sections)) {
    return {assessment: payload, report};
  }

  const sections = payload.sections.map((section) => {
    const questions = Array.isArray(section?.questions) ? section.questions : [];
    return {
      ...section,
      questions: questions.map((question) => {
        // True/false is two choices by definition; the paper's count is not
        // about it, and trimming it to three would be nonsense.
        if (question?.type !== "multiple_choice") return question;
        const options = Array.isArray(question.options) ? question.options : [];
        if (options.length === 0) return question;

        if (options.length < count) {
          report.short.push({number: question.number, got: options.length});
          return question;
        }
        const {options: trimmed, changed} = trimQuestionOptions(question, count);
        if (options.length > count && !changed) {
          report.unmatched.push({number: question.number, got: options.length});
          return question;
        }
        if (!changed) return question;
        report.trimmed.push({number: question.number, from: options.length, to: trimmed.length});
        return {...question, options: trimmed};
      }),
    };
  });

  return {assessment: {...payload, sections}, report};
}

/**
 * The prompt directive.
 *
 * Written as a hard requirement rather than a preference, and it states the
 * LETTERS as well as the number: a model told "four options" sometimes labels
 * them 1–4, and a model told "A to D" produces the labels the paper prints.
 *
 * Returns '' when nothing was requested, so a caller can concatenate it
 * unconditionally.
 */
function answerChoiceDirective(requested) {
  const count = normalizeRequestedCount(requested);
  if (!count) return "";
  const last = LETTERS[count - 1];
  return [
    "ANSWER CHOICES — this is a hard requirement, not a preference:",
    `- EVERY multiple_choice question must have EXACTLY ${count} options, no more and no fewer.`,
    `- They are labelled A to ${last} on the printed paper, so write exactly ${count} entries in "options".`,
    "- Do NOT write the letters inside the option text; the paper adds them.",
    `- Exactly one of the ${count} is correct. The other ${count - 1} must each be a `,
    "  distinct, plausible mistake a learner at this level really makes — never a",
    "  filler, never \"none of the above\", and never two options that are the same",
    "  value written differently (1/2 and 0.5 are one option, not two).",
    "- true_false questions are unaffected: they always have exactly two options.",
  ].join("\n");
}

module.exports = {
  answerChoiceDirective,
  applyAnswerChoiceCount,
  correctOptionIndex,
  normalizeRequestedCount,
  trimQuestionOptions,
};
