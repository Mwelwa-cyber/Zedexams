/**
 * Server-side paper model: flatten an assessment + its questions into an
 * ordered, rendering-agnostic block list that both the DOCX and PDF renderers
 * walk. Pure (rich-text extraction only) so it unit-tests under plain `node`
 * and both renderers stay consistent (one paper shape, two outputs).
 *
 * This is the server analogue of src/utils/assessmentPaperLayout.js. It is
 * intentionally self-contained (functions/ is a separate CommonJS package and
 * cannot import the browser ESM layout module).
 */

const {plainText, firstLine} = require("./richTextServer");
const {ASSESSMENT_TYPE_LABELS} = require("../teacherTools/assessmentFormats");

const SECTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const GRADE_WORDS = {
  1: "ONE", 2: "TWO", 3: "THREE", 4: "FOUR", 5: "FIVE", 6: "SIX",
  7: "SEVEN", 8: "EIGHT", 9: "NINE", 10: "TEN", 11: "ELEVEN", 12: "TWELVE",
};
const DEFAULT_ANSWER_LINES = {short: 2, diagram: 4, essay: 8};
const OPTION_LETTERS = "ABCDEFGH".split("");

/** Canonicalise a stored question type onto the render buckets. */
function canonType(q) {
  const t = String(q.type || q.detectedType || "mcq").toLowerCase();
  if (t === "tf" || t === "true_false" || t === "truefalse") return "true_false";
  if (t === "fill_blanks" || t === "fill_in_the_blank" || t === "cloze") return "fill_blanks";
  if (t === "structured" || t === "diagram") return "diagram";
  if (t === "essay" || t === "long_answer") return "essay";
  if (t === "short_answer" || t === "short" || t === "numeric") return "short_answer";
  if (t === "mcq" || t === "multiple_choice") return "mcq";
  return t;
}

/** Build the paper title, mirroring src buildPaperTitle. */
function buildPaperTitle(a = {}) {
  const grade = a.grade ?? "";
  const gradeWord = GRADE_WORDS[grade] || String(grade).toUpperCase();
  const type = a.assessmentType;
  const term = a.term ?? "";
  const year = a.year || a.assessmentYear ||
    (a.assessmentDate ? new Date(a.assessmentDate).getFullYear() : new Date().getFullYear());
  let typeBit = (ASSESSMENT_TYPE_LABELS[type] || "Assessment").toUpperCase();
  if (type === "end_of_term" && term) typeBit = `END OF TERM ${term} TEST`;
  else if (type === "mid_term" && term) typeBit = `MID-TERM ${term} TEST`;
  else if (type !== "mock_exam" && type !== "examination" && type !== "final_exam" && term) {
    typeBit = `TERM ${term} ${typeBit}`;
  }
  return `GRADE ${gradeWord} ${typeBit} - ${year}`;
}

/** Number of ruled answer lines for a written-answer question. */
function answerLinesFor(type, q) {
  if (Number.isFinite(Number(q.answerLines)) && Number(q.answerLines) > 0) return Number(q.answerLines);
  if (type === "essay") return DEFAULT_ANSWER_LINES.essay;
  if (type === "diagram") return DEFAULT_ANSWER_LINES.diagram;
  return DEFAULT_ANSWER_LINES.short;
}

/** Human answer string for the marking scheme. */
function schemeAnswer(q, type) {
  if (type === "mcq") {
    const idx = Number(q.correctAnswer);
    const opts = Array.isArray(q.options) ? q.options : [];
    if (Number.isInteger(idx) && idx >= 0 && idx < opts.length) {
      return `${OPTION_LETTERS[idx]}. ${plainText(opts[idx])}`.trim();
    }
    return String(q.correctAnswer ?? "");
  }
  if (type === "true_false") {
    const v = q.correctAnswer;
    if (v === true || v === "true" || v === 0) return "True";
    if (v === false || v === "false" || v === 1) return "False";
    return String(v ?? "");
  }
  const ans = q.correctAnswer ?? q.answer ?? q.markingScheme ?? "";
  return plainText(ans);
}

/**
 * Build the ordered block model.
 *
 * @param {object} assessment
 * @param {Array}  questions
 * @param {'paper'|'scheme'} mode
 * @returns {object} { title, subject, headerLines, learnerFields, instructions,
 *                     blocks, totalMarks, imageRefs, isScheme }
 */
function buildServerPaperModel(assessment = {}, questions = [], mode = "paper") {
  const isScheme = mode === "scheme";
  const a = assessment || {};
  const sorted = [...(questions || [])].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  const totalMarks = sorted.reduce((s, q) => s + (Number(q.marks) || 0), 0);
  const imageRefs = [];

  const mcqCap = [2, 3, 4].includes(Number(a.mcqAnswerChoiceCount)) ? Number(a.mcqAnswerChoiceCount) : null;

  const headerLines = [
    a.schoolName, a.motto, a.address,
    a.emisNumber ? `EMIS No: ${a.emisNumber}` : "",
  ].map((s) => String(s || "").trim()).filter(Boolean);

  const learnerFields = {
    name: a.showNameField !== false,
    date: a.showDateField !== false,
    className: Boolean(a.showClassField),
    marks: a.showMarksField !== false,
    duration: a.duration || "",
    totalMarks,
  };

  const blocks = [];
  // Instructions (or a marking-key banner).
  const instructions = plainText(a.coverInstructions);
  if (instructions) blocks.push({kind: "instructions", text: instructions});
  if (isScheme) blocks.push({kind: "schemeBanner"});

  // Passage lookup so a passage renders before its member questions.
  const passages = Array.isArray(a.passages) ? a.passages : [];
  const passageById = new Map(passages.map((p) => [p.id, p]));
  const emittedPassages = new Set();

  // Group by parts when present, else one implicit group.
  const parts = Array.isArray(a.parts) ? a.parts : [];
  const groups = parts.length
    ? parts.map((p) => ({id: p.id, title: firstLine(p.title), instructions: plainText(p.instructions),
      questions: sorted.filter((q) => (q.partId || null) === p.id)}))
    : [{id: null, title: "", instructions: "", questions: sorted}];
  // Any questions not claimed by a part go into a leading ungrouped group.
  if (parts.length) {
    const claimed = new Set(groups.flatMap((g) => g.questions));
    const orphan = sorted.filter((q) => !claimed.has(q));
    if (orphan.length) groups.unshift({id: null, title: "", instructions: "", questions: orphan});
  }

  let n = 0;
  groups.forEach((group, gi) => {
    if (group.id) {
      const letter = SECTION_LETTERS[parts.findIndex((p) => p.id === group.id)] || SECTION_LETTERS[gi] || "";
      const marks = group.questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
      blocks.push({kind: "sectionHeader", letter, title: group.title, marks, instructions: group.instructions});
    }
    for (const q of group.questions) {
      // Emit a passage stimulus once, before its first member question.
      if (q.passageId && passageById.has(q.passageId) && !emittedPassages.has(q.passageId)) {
        emittedPassages.add(q.passageId);
        const p = passageById.get(q.passageId);
        blocks.push({kind: "passage", title: firstLine(p.title), text: plainText(p.passageText)});
      }
      n += 1;
      const type = canonType(q);
      let options = Array.isArray(q.options) ? q.options.map((o) => plainText(o)) : [];
      if (type === "mcq" && mcqCap) options = options.slice(0, mcqCap);
      const imageUrl = String(q.imageUrl || "").trim();
      if (imageUrl) imageRefs.push({url: imageUrl, questionNumber: n});
      blocks.push({
        kind: "question",
        n,
        type,
        text: plainText(q.text ?? q.questionText ?? q.question),
        marks: Number(q.marks) || 0,
        options,
        optionLetters: OPTION_LETTERS,
        answerLines: answerLinesFor(type, q),
        imageUrl,
        diagramText: plainText(q.diagramText),
        isScheme,
        answer: isScheme ? schemeAnswer(q, type) : "",
      });
    }
  });

  return {
    title: buildPaperTitle(a),
    subject: String(a.subject || "").trim().toUpperCase(),
    paperName: String(a.paperName || "").trim().toUpperCase(),
    headerLines,
    learnerFields,
    instructions,
    blocks,
    totalMarks,
    imageRefs,
    isScheme,
  };
}

module.exports = {
  buildServerPaperModel,
  buildPaperTitle,
  canonType,
  answerLinesFor,
  schemeAnswer,
  DEFAULT_ANSWER_LINES,
  SECTION_LETTERS,
  OPTION_LETTERS,
};
