/**
 * Zambian Curriculum & Exam Standards Check Agent — verification runner.
 *
 * Runs AFTER a generator (practiceQuiz / examQuiz / notes / studyTips /
 * feedback). Reads the latest aiGeneratedContent doc for the task and
 * checks alignment against the v2 Curriculum Reader output and the
 * Standards Agent's assessment-structure block. Writes a structured
 * verdict onto aiGeneratedContent.zambianStandardsCheck AND reports
 * to the AI Supervisor via aiSupervisorLogs.
 *
 * NOT to be confused with the reference-data Standards Agent
 * (`runners/standards.js`) which runs BEFORE the exam generator to
 * supply section sizing + Blooms mix. This is the verification
 * counterpart that runs AFTER each generator.
 *
 * Verdict shape pinned by `standardsCheckVerdictSchema` in
 * src/schemas/learnerAi.js — 14 axes, status enum, confidence score,
 * issues[], recommendations[], zambianCurriculumFit / Assessment Fit
 * booleans.
 *
 * Hard rule: NEVER calls an LLM for the core alignment axes. The
 * deterministic checks below are exhaustive and sufficient to refuse
 * misaligned content. The agent IS permitted to call Haiku 4.5 for
 * the `language` + `age_suitability` axes once those LLM prompts are
 * wired up (out of scope here); deterministic blockers always win.
 *
 * Outputs:
 *   - Updates aiGeneratedContent.{contentId}.zambianStandardsCheck
 *   - Writes aiAgentLogs row
 *   - Writes aiTaskSteps row
 *   - Writes aiSupervisorLogs row (the "report to Supervisor" leg)
 *   - Updates aiLiveAgentStates/{standardsCheck}
 */

const admin = require("firebase-admin");
const {
  writeAgentLog, writeSupervisorLog, updateLiveAgentState, writeTaskStep,
} = require("../logger");
const {
  COLLECTIONS, TASK_STATUS, TASK_STEP_STATUS, SEVERITY,
} = require("../v2Collections");

const AGENT_ID = "standardsCheck";

// Axes scoped per artifact type — paper_structure / sections /
// instructions / marks_allocation only meaningful for exam_quiz.
const EXAM_ARTIFACT_TYPES = new Set(["exam_quiz"]);

// Foreign-content heuristic. Hard signals only — common non-Zambian
// place names and currencies that would surface in a misaligned
// artifact. Whitelisted Zambian terms below take precedence.
const FOREIGN_PATTERNS = [
  /\bLondon\b/i, /\bNew York\b/i, /\bChicago\b/i, /\bMumbai\b/i,
  /\bToronto\b/i, /\bSydney\b/i, /\bBeijing\b/i, /\bShanghai\b/i,
  /\bTokyo\b/i, /\bManchester\b/i, /\bLiverpool\b/i,
  /\$\s*\d/i,          // $5, $10 etc.
  /£\s*\d/i,           // £5, £10
  /€\s*\d/i,           // €5
  /\bGBP\b/i, /\bUSD\b/i, /\bEUR\b/i, /\bINR\b/i,
  /\bpounds?\b/i, /\bdollars?\b/i, /\beuros?\b/i,
];
const ZAMBIAN_WHITELIST = [
  /\bLusaka\b/i, /\bKafue\b/i, /\bNdola\b/i, /\bKitwe\b/i,
  /\bLivingstone\b/i, /\bChipata\b/i, /\bMongu\b/i, /\bSolwezi\b/i,
  /\bMansa\b/i, /\bKasama\b/i, /\bKapiri Mposhi\b/i, /\bZambia\b/i,
  /\bZMW\b/i, /\bkwacha\b/i, /\bnshima\b/i, /\bchitenge\b/i,
  /\bECZ\b/i, /\bsukulu\b/i, /\bbemba\b/i, /\bnyanja\b/i, /\btonga\b/i,
  /\blozi\b/i, /\blenje\b/i, /\bkaonde\b/i, /\bluvale\b/i,
];

// ── String comparison helper ────────────────────────────────────────

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

// ── Per-axis alignment checks ───────────────────────────────────────

function checkGrade({content, reader}) {
  if (!reader || !reader.grade) return {axis: "grade", verdict: "skip"};
  const got = norm(content && content.grade) ||
    norm(content && content.header && content.header.grade);
  const want = norm(reader.grade);
  if (got && want && got === want) return {axis: "grade", verdict: "pass"};
  if (got && want && got !== want) {
    return {
      axis: "grade", verdict: "fail",
      issue: {
        axis: "grade", severity: "critical",
        message: `Artifact grade "${got}" does not match curriculum grade "${want}"`,
      },
    };
  }
  return {axis: "grade", verdict: "skip"};
}

function checkSubject({content, reader}) {
  if (!reader || !reader.subject) return {axis: "subject", verdict: "skip"};
  const got = norm(content && content.subject) ||
    norm(content && content.header && content.header.subject);
  const want = norm(reader.subject);
  if (got && got === want) return {axis: "subject", verdict: "pass"};
  if (got && got !== want) {
    return {
      axis: "subject", verdict: "fail",
      issue: {
        axis: "subject", severity: "critical",
        message: `Artifact subject "${got}" does not match curriculum subject "${want}"`,
      },
    };
  }
  return {axis: "subject", verdict: "skip"};
}

function checkTerm({content, reader}) {
  const got = norm(content && content.term) ||
    norm(content && content.header && content.header.term);
  const want = norm(reader && reader.term);
  if (!want) return {axis: "term", verdict: "skip"};
  if (got === want) return {axis: "term", verdict: "pass"};
  return {
    axis: "term", verdict: "fail",
    issue: {
      axis: "term", severity: "minor",
      message: `Artifact term "${got || "(missing)"}" does not match curriculum term "${want}"`,
    },
  };
}

function checkTopic({content, reader}) {
  if (!reader || !reader.topic) return {axis: "topic", verdict: "skip"};
  const got = norm(content && content.topic) ||
    (content && content.questions ?
      norm(content.questions[0] && content.questions[0].topic) :
      norm(content && content.sections && content.sections[0] &&
        content.sections[0].questions && content.sections[0].questions[0] &&
        content.sections[0].questions[0].topic));
  const want = norm(reader.topic);
  if (got && got === want) return {axis: "topic", verdict: "pass"};
  if (got && got !== want) {
    return {
      axis: "topic", verdict: "fail",
      issue: {
        axis: "topic", severity: "critical",
        message: `Artifact topic "${got}" does not match curriculum topic "${want}"`,
      },
    };
  }
  return {axis: "topic", verdict: "skip"};
}

// Compares the topic the Curriculum Reader fuzzy-matched against the
// topic the requester actually asked for. The default `checkTopic`
// catches generator-vs-reader mismatches; this one catches the
// upstream case where the reader landed on a *different* curriculum
// entry than requested. Severity is `minor` (admin review surfaces
// it for low-confidence matches) — does not fail the chain.
function checkTopicDrift({task, reader}) {
  const askedForRaw = String((task && task.topic) || "").trim();
  const gotRaw = String((reader && reader.topic) || "").trim();
  if (!askedForRaw || !gotRaw) return {axis: "topic_drift", verdict: "skip"};
  if (askedForRaw.toLowerCase() === gotRaw.toLowerCase()) {
    return {axis: "topic_drift", verdict: "pass"};
  }
  return {
    axis: "topic_drift", verdict: "fail",
    issue: {
      axis: "topic_drift", severity: "minor",
      message: `Curriculum Reader matched "${gotRaw}" but the request asked ` +
        `for "${askedForRaw}". Verify the match is acceptable before publishing.`,
    },
  };
}

function checkSubtopic({content, reader}) {
  if (!reader || !reader.subtopic) return {axis: "subtopic", verdict: "skip"};
  const got = norm(content && content.subtopic) ||
    (content && content.questions ?
      norm(content.questions[0] && content.questions[0].subtopic) :
      norm(content && content.sections && content.sections[0] &&
        content.sections[0].questions && content.sections[0].questions[0] &&
        content.sections[0].questions[0].subtopic));
  const want = norm(reader.subtopic);
  if (got === want) return {axis: "subtopic", verdict: "pass"};
  if (got && got !== want) {
    return {
      axis: "subtopic", verdict: "fail",
      issue: {
        axis: "subtopic", severity: "minor",
        message: `Artifact subtopic "${got}" does not match curriculum subtopic "${want}"`,
      },
    };
  }
  return {axis: "subtopic", verdict: "skip"};
}

function gatherQuestions(content) {
  if (!content) return [];
  if (Array.isArray(content.questions)) return content.questions;
  if (Array.isArray(content.sections)) {
    return content.sections.flatMap((sec) =>
      Array.isArray(sec.questions) ? sec.questions : []);
  }
  return [];
}

function checkCompetency({content, reader}) {
  const want = norm(reader && reader.competencies && reader.competencies[0]);
  if (!want) return {axis: "competency", verdict: "skip"};
  const qs = gatherQuestions(content);
  if (!qs.length) return {axis: "competency", verdict: "skip"};
  // Each question stamps competency from the reader (per practiceQuiz /
  // examQuiz runners). Pass if every question has a non-empty
  // competency string matching the reader's first competency.
  const mismatched = qs.filter((q) => {
    const got = norm(q && q.competency);
    return got && got !== want;
  });
  if (!mismatched.length) return {axis: "competency", verdict: "pass"};
  return {
    axis: "competency", verdict: "fail",
    issue: {
      axis: "competency", severity: "critical",
      message: `${mismatched.length} question(s) carry a competency that does not match the curriculum`,
    },
  };
}

function checkLearningOutcome({content, reader}) {
  const want = norm(reader && reader.learningOutcomes && reader.learningOutcomes[0]);
  if (!want) return {axis: "learning_outcome", verdict: "skip"};
  const qs = gatherQuestions(content);
  if (!qs.length) return {axis: "learning_outcome", verdict: "skip"};
  const mismatched = qs.filter((q) => {
    const got = norm(q && q.learningOutcome);
    return got && got !== want;
  });
  if (!mismatched.length) return {axis: "learning_outcome", verdict: "pass"};
  return {
    axis: "learning_outcome", verdict: "fail",
    issue: {
      axis: "learning_outcome", severity: "minor",
      message: `${mismatched.length} question(s) carry a learning outcome that does not match the curriculum`,
    },
  };
}

function checkForeignContent({content}) {
  const qs = gatherQuestions(content);
  if (!qs.length) return {axis: "foreign_content", verdict: "skip"};
  const flagged = [];
  for (const q of qs) {
    const text = String(q.prompt || q.questionText || "");
    if (!text) continue;
    const isWhitelisted = ZAMBIAN_WHITELIST.some((re) => re.test(text));
    if (isWhitelisted) continue;
    const hit = FOREIGN_PATTERNS.find((re) => re.test(text));
    if (hit) flagged.push({
      number: q.number || null,
      pattern: hit.toString(),
    });
  }
  if (!flagged.length) return {axis: "foreign_content", verdict: "pass"};
  return {
    axis: "foreign_content", verdict: "fail",
    issue: {
      axis: "foreign_content", severity: "critical",
      message: `${flagged.length} question(s) reference non-Zambian places or foreign currencies. ` +
        `Prefer Zambian examples (Lusaka, Kafue, ZMW, etc.).`,
    },
  };
}

function checkAgeSuitability({content, reader}) {
  // Lower-primary grades (1-4): flag any question with words >14 chars
  // (proxy for vocabulary too advanced for the grade).
  const grade = parseInt(String(reader && reader.grade || "").replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(grade) || grade > 4) return {axis: "age_suitability", verdict: "skip"};
  const qs = gatherQuestions(content);
  if (!qs.length) return {axis: "age_suitability", verdict: "skip"};
  let longWordCount = 0;
  for (const q of qs) {
    const text = String(q.prompt || q.questionText || "");
    const words = text.split(/\s+/);
    longWordCount += words.filter((w) => w.replace(/[^A-Za-z]/g, "").length > 14).length;
  }
  if (longWordCount < 3) return {axis: "age_suitability", verdict: "pass"};
  return {
    axis: "age_suitability", verdict: "fail",
    issue: {
      axis: "age_suitability", severity: "minor",
      message: `${longWordCount} words exceed 14 letters — vocabulary likely too advanced for Grade ${grade}.`,
    },
  };
}

function checkLanguage({content}) {
  // Deterministic surface-level checks only: catches obvious markers
  // of non-Zambian English (e.g. "the lift" instead of "elevator" is
  // fine — but a question that says "color" in Zambian English contexts
  // we don't flag, both spellings are acceptable). Limit to "ye olde
  // English" / archaic words and obvious LLM giveaways. Real
  // language-fit verdicts come from the Haiku nuance pass when it
  // lands.
  const qs = gatherQuestions(content);
  if (!qs.length) return {axis: "language", verdict: "skip"};
  const archaicPattern = /\b(thou|thee|thy|hast|doth|whilst|amongst)\b/i;
  const flagged = qs.filter((q) =>
    archaicPattern.test(String(q.prompt || q.questionText || "")),
  );
  if (!flagged.length) return {axis: "language", verdict: "pass"};
  return {
    axis: "language", verdict: "fail",
    issue: {
      axis: "language", severity: "minor",
      message: `${flagged.length} question(s) use archaic English. Use modern Zambian classroom English.`,
    },
  };
}

// ── Exam-paper-specific checks ──────────────────────────────────────

function checkPaperStructure({content, artifactType}) {
  if (!EXAM_ARTIFACT_TYPES.has(artifactType)) {
    return {axis: "paper_structure", verdict: "skip"};
  }
  const sections = content && Array.isArray(content.sections) ? content.sections : [];
  const ids = sections.map((s) => s.id);
  const wantA = ids.includes("A");
  const wantB = ids.includes("B");
  if (wantA && wantB) return {axis: "paper_structure", verdict: "pass"};
  return {
    axis: "paper_structure", verdict: "fail",
    issue: {
      axis: "paper_structure", severity: "critical",
      message: `Exam papers must include at minimum Sections A and B. Found: [${ids.join(",")}]`,
    },
  };
}

function checkMarksAllocation({content, artifactType}) {
  if (!EXAM_ARTIFACT_TYPES.has(artifactType)) {
    return {axis: "marks_allocation", verdict: "skip"};
  }
  const sections = content && Array.isArray(content.sections) ? content.sections : [];
  if (!sections.length) return {axis: "marks_allocation", verdict: "skip"};
  const declaredTotal = (content.header && Number.isInteger(content.header.totalMarks)) ?
    content.header.totalMarks : null;
  // Verify section.marks equals the sum of its questions' marks.
  for (const sec of sections) {
    const qs = Array.isArray(sec.questions) ? sec.questions : [];
    const sumQ = qs.reduce((acc, q) => acc + (Number.isInteger(q.marks) ? q.marks : 0), 0);
    if (Number.isInteger(sec.marks) && sec.marks !== sumQ && sumQ > 0) {
      return {
        axis: "marks_allocation", verdict: "fail",
        issue: {
          axis: "marks_allocation", severity: "minor",
          message: `Section ${sec.id} declared ${sec.marks} marks but questions sum to ${sumQ}.`,
        },
      };
    }
  }
  // Verify header.totalMarks equals the sum of section.marks.
  const headerSum = sections.reduce((acc, s) => acc +
    (Number.isInteger(s.marks) ? s.marks : 0), 0);
  if (declaredTotal !== null && headerSum > 0 && declaredTotal !== headerSum) {
    return {
      axis: "marks_allocation", verdict: "fail",
      issue: {
        axis: "marks_allocation", severity: "minor",
        message: `Header totalMarks=${declaredTotal} does not match sum of section marks=${headerSum}.`,
      },
    };
  }
  return {axis: "marks_allocation", verdict: "pass"};
}

function checkInstructions({content, artifactType}) {
  if (!EXAM_ARTIFACT_TYPES.has(artifactType)) {
    return {axis: "instructions", verdict: "skip"};
  }
  const list = content && content.header &&
    Array.isArray(content.header.instructions) ? content.header.instructions : [];
  if (list.length >= 2 && list.every((s) => typeof s === "string" && s.trim())) {
    return {axis: "instructions", verdict: "pass"};
  }
  return {
    axis: "instructions", verdict: "fail",
    issue: {
      axis: "instructions", severity: "minor",
      message: `Exam papers must carry at least 2 header instructions (got ${list.length}).`,
    },
  };
}

function checkSections({content, artifactType, standards}) {
  if (!EXAM_ARTIFACT_TYPES.has(artifactType)) {
    return {axis: "sections", verdict: "skip"};
  }
  const sections = content && Array.isArray(content.sections) ? content.sections : [];
  if (!sections.length) {
    return {
      axis: "sections", verdict: "fail",
      issue: {
        axis: "sections", severity: "critical",
        message: "Exam paper has zero sections.",
      },
    };
  }
  // If standards supplied section sizing, check each section roughly
  // matches (±50% tolerance — papers shrink when grounding is sparse).
  const wantSections = (standards && standards.structure &&
    Array.isArray(standards.structure.sections)) ? standards.structure.sections : [];
  if (!wantSections.length) return {axis: "sections", verdict: "pass"};
  for (const w of wantSections) {
    const got = sections.find((s) => s.id === w.id);
    if (!got) {
      return {
        axis: "sections", verdict: "fail",
        issue: {
          axis: "sections", severity: "minor",
          message: `Standards expected Section ${w.id} but it's missing from the paper.`,
        },
      };
    }
    const gotCount = Array.isArray(got.questions) ? got.questions.length : 0;
    const wantCount = Number.isInteger(w.count) ? w.count : 0;
    if (wantCount > 0 && gotCount < Math.floor(wantCount * 0.5)) {
      return {
        axis: "sections", verdict: "fail",
        issue: {
          axis: "sections", severity: "minor",
          message: `Section ${w.id} has ${gotCount} questions but Standards expected ${wantCount}.`,
        },
      };
    }
  }
  return {axis: "sections", verdict: "pass"};
}

// ── Verdict assembly ────────────────────────────────────────────────

const AXIS_KEYS = [
  "grade", "subject", "term", "topic", "subtopic", "competency",
  "learning_outcome", "language", "age_suitability", "paper_structure",
  "marks_allocation", "instructions", "sections", "foreign_content",
];

const RECOMMENDATIONS_BY_AXIS = Object.freeze({
  grade: "Set artifact.grade to match the curriculum reader's grade exactly.",
  subject: "Set artifact.subject to match the curriculum reader's subject exactly.",
  term: "Set artifact.term to match the curriculum reader's term.",
  topic: "Set artifact.topic to match the curriculum reader's topic exactly.",
  subtopic: "Set artifact.subtopic to match the curriculum reader's subtopic.",
  competency: "Each question must stamp competency from chainContext.curriculumReader.",
  learning_outcome: "Each question must stamp learningOutcome from chainContext.curriculumReader.",
  language: "Use modern Zambian classroom English. Avoid archaic words.",
  age_suitability: "Shorten vocabulary for lower-primary learners (≤14-letter words).",
  paper_structure: "Exam papers must include Sections A (MCQ) and B (Short Answer) at minimum.",
  marks_allocation: "Section marks must equal sum of question marks; header total must equal sum of section marks.",
  instructions: "Add at least two header instructions to the exam paper.",
  sections: "Match Standards Agent's section sizing (within 50% tolerance).",
  foreign_content: "Replace foreign place names and currencies with Zambian examples (Lusaka, Kafue, ZMW, kwacha).",
});

function computeConfidence(issues) {
  let score = 1.0;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 0.15;
    else if (issue.severity === "minor") score -= 0.05;
  }
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return Math.round(score * 10000) / 10000;
}

function decideStatus({issues, confidence}) {
  const hasCritical = issues.some((i) => i.severity === "critical");
  if (hasCritical || confidence < 0.5) return "failed";
  if (confidence < 0.8 || issues.length > 0) return "needs_review";
  return "passed";
}

/**
 * Pure verdict builder — exposed for unit tests. Runs every axis
 * check, decides status + confidence, returns the verdict object
 * (minus `contentId` + `checkedAt` which the runner stamps last).
 *
 * @param {object} args
 * @param {string} args.artifactType
 * @param {object} args.content              the aiGeneratedContent.content payload
 * @param {object|null} args.reader          chainContext.curriculumReader
 * @param {object|null} [args.standards]     chainContext.standards (for exam_quiz)
 * @returns {object}                         partial StandardsCheckVerdict
 */
function buildVerdict({artifactType, content, reader, standards, task}) {
  const results = [
    checkGrade({content, reader}),
    checkSubject({content, reader}),
    checkTerm({content, reader}),
    checkTopic({content, reader}),
    checkSubtopic({content, reader}),
    checkCompetency({content, reader}),
    checkLearningOutcome({content, reader}),
    checkLanguage({content}),
    checkAgeSuitability({content, reader}),
    checkPaperStructure({content, artifactType}),
    checkMarksAllocation({content, artifactType}),
    checkInstructions({content, artifactType}),
    checkSections({content, artifactType, standards}),
    checkForeignContent({content}),
    checkTopicDrift({task, reader}),
  ];

  const checks = {};
  const issues = [];
  for (const r of results) {
    checks[r.axis] = r.verdict;
    if (r.issue) issues.push(r.issue);
  }
  // Ensure every declared axis appears (defensive — should already be
  // covered by the loop above).
  for (const k of AXIS_KEYS) if (!checks[k]) checks[k] = "skip";

  const confidence = computeConfidence(issues);
  const status = decideStatus({issues, confidence});

  // zambianCurriculumFit: pure check that every core curriculum axis
  // passed (or was N/A). zambianAssessmentFit: every exam-paper axis
  // passed (or was N/A). For non-exam artifacts the assessment fit is
  // vacuously true because every paper-structure axis is `skip`.
  const curriculumAxes = ["grade", "subject", "term", "topic", "subtopic",
    "competency", "learning_outcome"];
  const assessmentAxes = ["paper_structure", "marks_allocation",
    "instructions", "sections"];
  const allFitFor = (keys) => keys.every((k) => checks[k] !== "fail");
  const zambianCurriculumFit = allFitFor(curriculumAxes);
  const zambianAssessmentFit = allFitFor(assessmentAxes);

  const recs = [];
  for (const issue of issues) {
    const r = RECOMMENDATIONS_BY_AXIS[issue.axis];
    if (r && !recs.includes(r)) recs.push(r);
    if (recs.length >= 20) break;
  }

  return {
    status,
    confidenceScore: confidence,
    checks,
    issues: issues.slice(0, 40),
    recommendations: recs,
    zambianCurriculumFit,
    zambianAssessmentFit,
    modelUsed: "deterministic",
    artifactType,
  };
}

// ── Firestore resolution + runner ───────────────────────────────────

/**
 * Find the latest aiGeneratedContent doc for this task. v2 schema
 * doesn't carry taskId on content docs, so we resolve by
 * (grade, subject, topic) and pick the most recent — same pattern
 * the dispatcher uses for the approval flip.
 */
async function findLatestContent({task}) {
  const db = admin.firestore();
  // Prefer the task's resultContentId if the dispatcher already
  // stamped one; otherwise fall back to the broad query.
  if (task && task.resultContentId) {
    try {
      const snap = await db.collection(COLLECTIONS.CONTENT).doc(task.resultContentId).get();
      if (snap.exists) return {ref: snap.ref, data: snap.data() || {}};
    } catch (err) {
      console.warn("[standardsCheck] doc-by-id lookup failed", err && err.message);
    }
  }
  try {
    const snap = await db.collection(COLLECTIONS.CONTENT)
        .where("grade", "==", String(task.grade || ""))
        .where("subject", "==", String(task.subject || ""))
        .where("topic", "==", String(task.topic || ""))
        .get();
    if (snap.empty) return null;
    const docs = [...snap.docs];
    docs.sort((a, b) => {
      const at = a.data().createdAt && a.data().createdAt.toMillis ?
        a.data().createdAt.toMillis() : 0;
      const bt = b.data().createdAt && b.data().createdAt.toMillis ?
        b.data().createdAt.toMillis() : 0;
      return bt - at;
    });
    return {ref: docs[0].ref, data: docs[0].data() || {}};
  } catch (err) {
    console.warn("[standardsCheck] broad lookup failed", err && err.message);
    return null;
  }
}

async function runStandardsCheck({task, chainContext = {}, stepNumber = 4}) {
  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID,
    status: TASK_STATUS.CHECKING,
    currentTaskId: task.id,
    currentTask: "Verify Zambian curriculum + assessment alignment",
    progress: 25,
    grade: task.grade || null,
    subject: task.subject || null,
    term: task.term || null,
    topic: task.topic || null,
    subtopic: task.subtopic || null,
    lastMessage: "Running deterministic alignment checks",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Standards check",
    message: "Deterministic alignment verification",
    status: TASK_STEP_STATUS.RUNNING, progress: 50,
  });

  const target = await findLatestContent({task});
  if (!target) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "standards_check",
      message: "No aiGeneratedContent found for this task",
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.ERROR,
    });
    await updateLiveAgentState(AGENT_ID, {
      status: "failed", currentTaskId: null, lastMessage: "no_artifact_found",
    });
    return {ok: false, reason: "no_artifact_found"};
  }

  const verdictBase = buildVerdict({
    artifactType: target.data.type || task.taskType,
    content: target.data.content || {},
    reader: chainContext.curriculumReader || null,
    standards: chainContext.standards || null,
    task,
  });

  const verdict = {
    ...verdictBase,
    contentId: target.ref.id,
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Write the verdict onto the artifact.
  await target.ref.set({
    zambianStandardsCheck: verdict,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  // Report to the AI Supervisor (separate, scarcer log).
  const supervisorAction = verdict.status === "failed" ? "regenerate_required" :
    (verdict.status === "needs_review" ? "sent_for_review" : "sent_for_review");
  await writeSupervisorLog({
    taskId: task.id,
    agentName: "Zambian Curriculum & Exam Standards Agent",
    contentType: verdict.artifactType,
    grade: task.grade || "", subject: task.subject || "", term: task.term || "",
    topic: task.topic || "", subtopic: task.subtopic || "",
    actionTaken: supervisorAction,
    reason: verdict.issues.length ?
      `${verdict.status}: ${verdict.issues.length} issue(s) ` +
      `[${verdict.issues.slice(0, 3).map((i) => i.axis).join(",")}]` :
      `${verdict.status}: all alignment checks passed`,
    confidenceScore: verdict.confidenceScore,
  });

  await writeAgentLog({
    taskId: task.id, agentName: AGENT_ID, action: "standards_check",
    message: `${verdict.status} (confidence=${verdict.confidenceScore.toFixed(2)}, ` +
      `issues=${verdict.issues.length}, ` +
      `curriculumFit=${verdict.zambianCurriculumFit}, ` +
      `assessmentFit=${verdict.zambianAssessmentFit})`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: verdict.status === "failed" ? SEVERITY.WARNING : SEVERITY.INFO,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Standards check",
    message: `${verdict.status}; ${verdict.issues.length} issue(s)`,
    status: verdict.status === "failed" ?
      TASK_STEP_STATUS.FAILED : TASK_STEP_STATUS.COMPLETED,
    progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: verdict.status === "failed" ? "failed" : "completed",
    currentTaskId: null, progress: 100,
    lastMessage: `${verdict.status} (${verdict.issues.length} issues)`,
  });

  // Return the verdict so the dispatcher can stash it on chainContext
  // and downstream agents (Quality Check) can read it.
  return {
    ok: true,
    standardsCheckVerdict: {...verdictBase, contentId: target.ref.id},
  };
}

module.exports = {
  runStandardsCheck,
  buildVerdict,
  computeConfidence,
  decideStatus,
  // Per-axis helpers exported for unit tests.
  checkGrade, checkSubject, checkTerm, checkTopic, checkSubtopic,
  checkCompetency, checkLearningOutcome, checkLanguage, checkAgeSuitability,
  checkPaperStructure, checkMarksAllocation, checkInstructions,
  checkTopicDrift,
  checkSections, checkForeignContent,
  AGENT_ID,
  FOREIGN_PATTERNS, ZAMBIAN_WHITELIST,
};
