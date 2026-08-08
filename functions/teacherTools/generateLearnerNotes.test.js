/**
 * The learner-notes pipeline (§3, §3b, §4b), end to end with the provider and
 * the syllabus stubbed.
 *
 * What is worth proving here is the part that is not visible in any single
 * module: the four steps happen in the right ORDER and each one actually
 * constrains the next. Retrieval before writing (so the prompt carries the
 * boundary); the diagram chosen from the topic rather than from the model; the
 * checks run after writing and the failing section — and only that section —
 * regenerated; and the answers never on the learner's pages regardless of what
 * the model returns.
 *
 * Plain `node` script. firebase-admin, firebase-functions, the Anthropic client
 * and the KB are stubbed via Module._load before the module under test loads,
 * the same pattern generateNotes.test.js uses.
 *
 * Run: node functions/teacherTools/generateLearnerNotes.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `${name}${detail ? `\n      ${detail}` : ""}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

/* ── Stubs ─────────────────────────────────────────────────────────────── */

const calls = {claude: [], lookupTopic: []};

let topicEntry = {
  topic: "The Digestive System",
  specificOutcomes: [
    "describe the parts of the human digestive system",
    "explain how food is broken down in the mouth",
  ],
  subtopics: ["Parts of the digestive system", "Digestion in the mouth"],
  keyTerms: ["digestion", "saliva"],
};
let lookupThrows = false;

// The model's reply, per call. The first call is the whole document; any later
// call is a section rewrite.
let claudeReplies = [];

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "./cbcKnowledge") {
    return {
      lookupTopic: async (args) => {
        calls.lookupTopic.push(args);
        if (lookupThrows) throw new Error("firestore unavailable");
        return topicEntry;
      },
      lookupSubtopicModule: async () => null,
      normalizeFramework: (fw) => (String(fw) === "2013" ? "2013" : "2023"),
    };
  }
  if (request === "./anthropicClient") {
    return {
      callClaude: async (apiKey, opts) => {
        calls.claude.push(opts);
        const reply = claudeReplies[calls.claude.length - 1];
        if (typeof reply === "function") return reply(opts);
        return {
          parsed: reply,
          text: "raw",
          usage: {inputTokens: 100, outputTokens: 200},
          model: "stub-model",
        };
      },
    };
  }
  if (request === "./subjectNaming") {
    return {subjectNameForGrade: (subject) => String(subject).replace(/_/g, " ")};
  }
  return origLoad.call(this, request, ...rest);
};

const {generateLearnerNotesDocument} = require("./generateLearnerNotes");

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const INPUTS = {
  grade: "G7",
  subject: "integrated_science",
  topic: "The Digestive System",
  subtopic: "",
  language: "english",
  school: "Kabulonga Primary",
  teacherName: "Mrs Banda",
  date: "3 March 2026",
  curriculum: "cbc",
  framework: "2023",
};

function goodDocument(overrides = {}) {
  return {
    header: {
      title: "Digestion — Grade 7 Integrated Science",
      grade: "Grade 7", subject: "Integrated Science",
      topic: "The Digestive System", subtopic: "",
    },
    learningOutcomes: [
      "By the end of these notes you will be able to name the parts of your digestive system.",
      "You will be able to explain how food is broken down in your mouth.",
    ],
    sections: [
      {
        heading: "Your mouth",
        body: ["When you eat nshima, your teeth cut it into small pieces.",
          "Your **saliva** makes the food soft so you can swallow it."],
        definitions: [{term: "saliva", meaning: "the water in your mouth that softens food"}],
        recap: "Digestion starts in your mouth.",
      },
      {
        heading: "Your stomach",
        body: ["Your stomach churns the food until it is a soft paste."],
        definitions: [],
        recap: "Your stomach mixes food.",
      },
    ],
    workedExamples: [{
      title: "Follow one mouthful",
      problem: "Where does a piece of nshima go after you swallow it?",
      steps: ["Step 1 — your mouth: your teeth cut it up.", "Step 2 — you swallow."],
      answer: "It goes down to your stomach.",
    }],
    dontMixThese: [{
      confusedPair: "Chewing / Digestion",
      warning: "Chewing is only the first step. Digestion is the whole journey!",
      clarification: "Chewing happens in your mouth. Digestion carries on all the way down.",
    }],
    learnerQuestions: [{
      question: "Why does my stomach make a noise?",
      answer: "It is the muscles squeezing food and air together.",
    }],
    rememberBox: ["Digestion starts in your mouth.", "Your stomach mixes food into a paste."],
    exercise: {
      instructions: "Answer all the questions in your exercise book.",
      questions: [
        {prompt: "Name two parts of your digestive system.", marks: 2, type: "recall",
          answer: "Any two of: mouth, stomach, small intestine.", markingNote: "One mark each."},
        {prompt: "Why do you chew your food before swallowing it?", marks: 2, type: "apply",
          answer: "So it is small and soft enough to swallow and be broken down."},
      ],
    },
    coveredContent: ["parts of the digestive system", "digestion in the mouth"],
    ...overrides,
  };
}

function reset() {
  calls.claude.length = 0;
  calls.lookupTopic.length = 0;
  lookupThrows = false;
  topicEntry = {
    topic: "The Digestive System",
    specificOutcomes: [
      "describe the parts of the human digestive system",
      "explain how food is broken down in the mouth",
    ],
    subtopics: ["Parts of the digestive system", "Digestion in the mouth"],
    keyTerms: ["digestion", "saliva"],
  };
  claudeReplies = [goodDocument()];
}

const generate = (rawOptions = {}, inputs = INPUTS) =>
  generateLearnerNotesDocument({apiKey: "k", uid: "u1", inputs, rawOptions});

/* ── Cases ─────────────────────────────────────────────────────────────── */

(async function run() {
  // 1. Retrieve BEFORE write, and the boundary reaches the prompt.
  reset();
  {
    const result = await generate();
    ok("retrieves the syllabus before writing", calls.lookupTopic.length === 1);
    const prompt = calls.claude[0].messages[0].content;
    ok("the prompt carries the retrieved outcomes",
        prompt.includes("describe the parts of the human digestive system"));
    ok("the prompt states the completeness floor", /COMPLETENESS FLOOR/.test(prompt));
    ok("the prompt states the depth ceiling", /DEPTH CEILING/.test(prompt));
    ok("the ceiling names the jejunum case", /jejunum/.test(prompt));
    ok("the grounding chip counts the outcomes",
        result.grounding.grounded && result.grounding.count === 2,
        JSON.stringify(result.grounding));
    ok("the grounding label names the grade and subject",
        /Grade 7/.test(result.grounding.label) && /2 outcomes/.test(result.grounding.label),
        result.grounding.label);
  }

  // 2. A topic with no syllabus data SAYS so — no silent fallback.
  reset();
  {
    topicEntry = null;
    const result = await generate();
    ok("ungrounded: reports grounded=false", result.grounding.grounded === false);
    ok("ungrounded: has the amber message",
        /No syllabus data found for this topic/.test(result.grounding.message));
    const prompt = calls.claude[0].messages[0].content;
    ok("ungrounded: the prompt is TOLD there are no outcomes",
        /NO SYLLABUS OUTCOMES WERE FOUND/.test(prompt));
  }

  // 3. A syllabus READ FAILURE is not reported as "no syllabus data".
  reset();
  {
    lookupThrows = true;
    const result = await generate();
    ok("unavailable: distinguished from an empty catalogue",
        result.grounding.unavailable === true && result.grounding.grounded === false);
    ok("unavailable: says the check could not run",
        /could not read the syllabus/i.test(result.grounding.message), result.grounding.message);
  }

  // 4. The diagram is proposed from the TOPIC, deterministically.
  reset();
  {
    const result = await generate();
    const blocks = result.notes.diagrams;
    ok("a Digestive System topic proposes the library figure", blocks.length === 2);
    ok("the study version goes in the notes body",
        blocks[0].placement === "body" && blocks[0].mode === "study"
        && blocks[0].libraryKey === "digestivesystem");
    ok("the label-it version goes in the exercise",
        blocks[1].placement === "exercise" && blocks[1].mode === "label-it"
        && blocks[1].params.labels === "off");
    ok("the label-it version carries a word bank", blocks[1].wordBank.length > 0);
    ok("the diagram's labels are on the ANSWER page only",
        result.notes.answerKey.diagramLabels.length > 0
        && result.notes.answerKey.diagramLabels[0].name === "mouth");
    const prompt = calls.claude[0].messages[0].content;
    ok("the writer is told which figure is on the sheet", /A DIAGRAM IS ON THE SHEET/.test(prompt));
  }

  // 5. A topic with no library figure gets none.
  reset();
  {
    const result = await generate({}, {...INPUTS, topic: "Measuring temperature"});
    ok("no figure is invented for an unmatched topic", result.notes.diagrams.length === 0);
  }

  // 6. Exercise answers NEVER reach the learner's pages.
  reset();
  {
    const result = await generate();
    const printed = JSON.stringify(result.notes.exercise);
    ok("the learner's exercise has no answer field", !/answer/.test(printed), printed);
    ok("the answers are on the separate answer page",
        result.notes.answerKey.answers.length === 2
        && /mouth, stomach/.test(result.notes.answerKey.answers[0].answer));
    ok("answer numbering matches the printed questions",
        result.notes.exercise.questions.map((q) => q.number).join() ===
        result.notes.answerKey.answers.map((a) => a.number).join());
  }

  // 7. The voice lint fires and regenerates ONLY the failing section.
  reset();
  {
    const bad = goodDocument();
    bad.sections[1].body = ["Write the word stomach on the board and ask the class to copy it."];
    claudeReplies = [
      bad,
      // The rewrite reply — one section, learner-voiced.
      {sections: [bad.sections[0], {
        heading: "Your stomach",
        body: ["Your stomach squeezes the food until it is a soft paste."],
        definitions: [], recap: "Your stomach mixes food.",
      }]},
    ];
    const result = await generate();
    ok("a teacher-directed sentence triggers a rewrite", calls.claude.length === 2);
    const rewritePrompt = calls.claude[1].messages[0].content;
    ok("the rewrite names the offending phrase", /on the board/.test(rewritePrompt));
    ok("the rewrite is scoped to one section", /Rewrite ONE section/.test(rewritePrompt));
    ok("the rewritten document is clean", result.checks.voiceClean === true);
    ok("the rewrite is recorded on the document",
        result.checks.rewrittenSections.join() === "sections");
    ok("the untouched section survived",
        result.notes.sections[0].heading === "Your mouth");
  }

  // 8. The grade ceiling fires on a real out-of-scope concept.
  reset();
  {
    const bad = goodDocument();
    bad.sections[1].body = ["Next the food reaches the jejunum, where most of it is absorbed."];
    claudeReplies = [
      bad,
      {sections: [bad.sections[0], {
        heading: "Your small intestine",
        body: ["Next the food goes into your small intestine, where your body takes what it needs."],
        definitions: [], recap: "Your body absorbs food here.",
      }]},
    ];
    const result = await generate();
    ok("a beyond-grade concept triggers a rewrite", calls.claude.length === 2);
    ok("the rewrite explains WHY it is out of scope",
        /jejunum/.test(calls.claude[1].messages[0].content)
        && /Grade 10/.test(calls.claude[1].messages[0].content));
    ok("the rewritten document passes the ceiling", result.checks.scopeClean === true);
    ok("the jejunum is gone", !JSON.stringify(result.notes.sections).includes("jejunum"));
  }

  // 9. A clean document costs exactly one provider call.
  reset();
  {
    await generate();
    ok("no rewrite when nothing is wrong", calls.claude.length === 1);
  }

  // 10. A rewrite that fails leaves the ORIGINAL section and says so.
  reset();
  {
    const bad = goodDocument();
    bad.sections[1].body = ["Ask the class what they ate this morning."];
    claudeReplies = [bad, () => {
      throw new Error("provider down");
    }];
    const result = await generate();
    ok("a failed rewrite does not lose the section", result.notes.sections.length === 2);
    ok("a failed rewrite is reported, not hidden", result.checks.voiceClean === false);
    ok("the report says what is still wrong", /teacher-directed/.test(result.checks.voiceMessage));
  }

  // 11. Board notes drop the FAQ, whatever the model returned.
  reset();
  {
    const result = await generate({format: "board"});
    ok("board notes carry no FAQ", result.notes.learnerQuestions.length === 0);
    ok("board notes keep the Remember! box", result.notes.rememberBox.length > 0);
    ok("board notes keep the exercise", result.notes.exercise.questions.length === 2);
    ok("the board format is recorded on the document", result.notes.format === "board");
    const prompt = calls.claude[0].messages[0].content;
    ok("the writer is told it is for a chalkboard", /FORMAT — BOARD NOTES/.test(prompt));
  }

  // 12. The options reach the prompt as real constraints.
  reset();
  {
    await generate({length: "half", detail: "summarised", englishLevel: "simple"});
    const prompt = calls.claude[0].messages[0].content;
    ok("length constrains generation, in words", /about \d+ words of body text/.test(prompt));
    ok("summarised asks for a revision sheet", /DETAIL — SUMMARISED/.test(prompt));
    ok("simple English is requested", /ENGLISH LEVEL — SIMPLE/.test(prompt));
    ok("all three levels keep the textbook's terms",
        /technical terms, which stay exactly as the textbook writes them/.test(prompt));
  }

  // 12b. The reading level is a stated constraint, and it differs by grade.
  reset();
  {
    await generate({}, {...INPUTS, grade: "G4"});
    const primary = calls.claude[0].messages[0].content;
    reset();
    await generate({}, {...INPUTS, grade: "F1"});
    const secondary = calls.claude[0].messages[0].content;
    ok("a Grade 4 sheet is asked for shorter sentences than a Form 1 sheet",
        /READING LEVEL — UPPER PRIMARY/.test(primary)
        && /READING LEVEL — JUNIOR SECONDARY/.test(secondary),
        "'the reading level for this grade' is an instruction a model agrees with and ignores");
  }

  // 13. A completeness gap is reported rather than passed over.
  reset();
  {
    topicEntry = {
      ...topicEntry,
      specificOutcomes: [
        "describe the parts of the human digestive system",
        "explain the role of the liver in digestion",
      ],
    };
    const result = await generate();
    ok("an uncovered outcome is reported",
        result.checks.uncoveredOutcomes.some((o) => /liver/.test(o)),
        JSON.stringify(result.checks.uncoveredOutcomes));
  }

  // 14. The verdict travels with the document.
  reset();
  {
    const result = await generate();
    ok("the saved document carries its own check results",
        typeof result.notes.checks.voiceClean === "boolean"
        && typeof result.notes.checks.scopeChecked === "boolean");
    ok("the saved document carries its grounding",
        result.notes.grounding.grounded === true);
    ok("the saved document records the audience", result.notes.audience === "learner");
  }

  console.log(`\nAll learner-notes pipeline tests passed (${passed} assertions).`);
})().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
