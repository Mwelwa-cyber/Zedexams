/**
 * assessmentFormatSeeds — in-code seed data for Zambian assessment format
 * profiles. Same role as cbcTopics.js for the topic KB: these profiles ship
 * with the code so the assessment generator is always grounded on Zambian
 * paper conventions, and the Firestore overlay
 * (cbcKnowledgeBase/{version}/assessmentFormats) lets admins edit or add
 * profiles without a deploy.
 *
 * Each profile describes how a kind of Zambian school assessment is laid
 * out: paper structure (sections + marks shares), front-page instruction
 * wording, numbering conventions, question phrasing register, marks
 * allocation habits, diagram conventions, and 2-4 exemplar questions.
 *
 * COPYRIGHT RULE: exemplar questions are PARAPHRASED / representative,
 * never verbatim reproductions of any ECZ or school paper — the model
 * learns the register and layout without copying protected content. The
 * same rule applies to admin-added and PDF-extracted profiles.
 *
 * Profile id convention: `${assessmentType}-${gradeBand}-${subject}` where
 * subject is a canonical ALLOWED_SUBJECTS key from generateAssessment.js,
 * or the literal "_generic" for the band-wide fallback.
 */

// ── Shared wording fragments ─────────────────────────────────────────────

const NUMBERING_FORMAL =
  "Sections are lettered A, B, C. Questions are numbered 1, 2, 3 … " +
  "continuously across the whole paper (do NOT restart at 1 in each " +
  "section). Multi-part questions use (a), (b), (c); sub-parts use " +
  "(i), (ii), (iii). Show the marks for every question or part in square " +
  "brackets at the end, e.g. [2].";

const NUMBERING_SIMPLE =
  "Number the questions 1, 2, 3 … straight through. Multi-part questions " +
  "use (a), (b), (c). Show the marks in square brackets at the end of " +
  "each question, e.g. [1].";

const PHRASING_PRIMARY = [
  "Use ECZ command words: State, Name, List, Give, Draw, Match, Fill in, Circle, Calculate, Work out, Find, Explain in one sentence.",
  "One command per question part. Short, plain sentences a Zambian pupil of this grade reads easily.",
  "Use Zambian contexts and names: kwacha (K) and ngwee, markets, maize, nshima, buses, clinics, villages; names like Chanda, Bupe, Mutinta, Luyando, Mr Mbewe, Mrs Phiri.",
];

const PHRASING_SECONDARY = [
  "Use ECZ command words: State, Name, List, Define, Calculate, Determine, Explain, Describe, Distinguish, Compare, Outline, Discuss, Draw, Label.",
  "One command per question part. Stems are concise; longer scenario stems are fine for structured questions.",
  "Use Zambian contexts: kwacha, local businesses and markets, farming, mining towns, health and civic life; names like Chanda, Mutinta, Bwalya, Mr Mbewe, Mrs Zulu.",
];

const COVER_FORMAL = [
  "Write your name and class in the spaces provided.",
  "Answer ALL questions.",
  "Write your answers in the spaces provided.",
  "Write neatly and clearly.",
];

const COVER_MOCK = [
  "Write your name, examination number and class in the spaces provided.",
  "There are … questions in this paper. Answer ALL questions.",
  "Read each question carefully before answering.",
  "Check your work before handing in.",
];

// ── Seed profiles ────────────────────────────────────────────────────────

const FORMAT_PROFILES = [
  // ═══ EXERCISE — short classroom practice, minimal formality ═══════════
  {
    id: "exercise-lower_primary-_generic",
    assessmentType: "exercise",
    gradeBand: "lower_primary",
    subject: "_generic",
    label: "Lower Primary Classroom Exercise",
    paperStructure: [
      {
        name: "EXERCISE",
        heading: "EXERCISE",
        instructions: "Answer all the questions.",
        questionTypes: ["short_answer", "multiple_choice", "true_false"],
        questionCountHint: "5-8",
        marksShare: 100,
        marksPerQuestionHint: "1-2 marks each",
      },
    ],
    coverInstructions: [
      "Write your name.",
      "Answer all the questions.",
    ],
    numberingStyle: NUMBERING_SIMPLE,
    phrasingNotes: [
      "Very short sentences with familiar words only — pitched at a Grade 1-3 Zambian pupil.",
      "Use Fill in, Circle, Match, Count, Write, Draw as the main commands.",
      "Use familiar Zambian things: mangoes, chickens, kwacha coins, the market, family names like Bupe and Chanda.",
    ],
    marksConventions: [
      "1 mark per answer. Keep totals small (5-15 marks).",
    ],
    diagramConventions: [
      "Counting and matching questions often use simple pictures. When a picture is needed, describe it in the diagram field (e.g. 'Five mangoes in a row').",
    ],
    exemplarQuestions: [
      {type: "short_answer", marks: 1, prompt: "Fill in the missing number: 4, 5, __, 7.", note: "fill-in with a blank line"},
      {type: "short_answer", marks: 1, prompt: "Count the oranges in the picture and write the number.", note: "picture-based counting; needs a diagram"},
      {type: "multiple_choice", marks: 1, prompt: "Circle the word that names an animal: chair, goat, table.", note: "circle-the-answer style"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "exercise-upper_primary-_generic",
    assessmentType: "exercise",
    gradeBand: "upper_primary",
    subject: "_generic",
    label: "Upper Primary Classroom Exercise",
    paperStructure: [
      {
        name: "EXERCISE",
        heading: "EXERCISE",
        instructions: "Answer ALL questions. Show your working where needed.",
        questionTypes: ["short_answer", "calculation", "multiple_choice"],
        questionCountHint: "6-10",
        marksShare: 100,
        marksPerQuestionHint: "1-3 marks each",
      },
    ],
    coverInstructions: [
      "Write your name and class.",
      "Answer ALL questions.",
      "Show your working where the question asks for it.",
    ],
    numberingStyle: NUMBERING_SIMPLE,
    phrasingNotes: PHRASING_PRIMARY,
    marksConventions: [
      "1 mark for simple recall; 2-3 marks where working or an explanation is needed.",
      "Keep the total small (10-20 marks) — this is practice, not a test.",
    ],
    diagramConventions: [
      "Use a diagram only when the question genuinely needs one; describe it in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "calculation", marks: 2, prompt: "Work out 348 + 276. Show your working.", note: "working shown for 2 marks"},
      {type: "short_answer", marks: 1, prompt: "Name the gas plants take in during photosynthesis.", note: "single-fact recall"},
      {type: "short_answer", marks: 2, prompt: "Chanda bought a pencil at K3.50 and a ruler at K6. Find the total amount he spent.", note: "kwacha context"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "exercise-junior_secondary-_generic",
    assessmentType: "exercise",
    gradeBand: "junior_secondary",
    subject: "_generic",
    label: "Junior Secondary Classroom Exercise",
    paperStructure: [
      {
        name: "EXERCISE",
        heading: "EXERCISE",
        instructions: "Answer ALL questions. Show all essential working.",
        questionTypes: ["short_answer", "calculation", "structured"],
        questionCountHint: "5-8",
        marksShare: 100,
        marksPerQuestionHint: "2-4 marks each",
      },
    ],
    coverInstructions: [
      "Write your name and class.",
      "Answer ALL questions.",
      "Show all essential working.",
    ],
    numberingStyle: NUMBERING_SIMPLE,
    phrasingNotes: PHRASING_SECONDARY,
    marksConventions: [
      "Method and answer earn separate marks on calculations.",
      "Keep the total small (10-20 marks).",
    ],
    diagramConventions: [
      "Use a diagram only when the question genuinely needs one; describe it in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "calculation", marks: 3, prompt: "Solve for x: 3x - 7 = 14. Show your working.", note: "method + answer marks"},
      {type: "short_answer", marks: 2, prompt: "Define the term 'habitat' and give one example found in Zambia.", note: "define + local example"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "exercise-senior_secondary-_generic",
    assessmentType: "exercise",
    gradeBand: "senior_secondary",
    subject: "_generic",
    label: "Senior Secondary Classroom Exercise",
    paperStructure: [
      {
        name: "EXERCISE",
        heading: "EXERCISE",
        instructions: "Answer ALL questions. Show all essential working.",
        questionTypes: ["short_answer", "calculation", "structured"],
        questionCountHint: "4-7",
        marksShare: 100,
        marksPerQuestionHint: "2-5 marks each",
      },
    ],
    coverInstructions: [
      "Write your name and class.",
      "Answer ALL questions.",
      "Show all essential working.",
    ],
    numberingStyle: NUMBERING_SIMPLE,
    phrasingNotes: PHRASING_SECONDARY,
    marksConventions: [
      "Method and answer earn separate marks on calculations; explanations are marked per valid point.",
      "Keep the total small (10-25 marks).",
    ],
    diagramConventions: [
      "Use a diagram only when the question genuinely needs one; describe it in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "calculation", marks: 4, prompt: "A trader bought goods for K1 200 and sold them for K1 500. Calculate the percentage profit.", note: "kwacha business context, method marks"},
      {type: "structured", marks: 5, prompt: "Explain THREE ways deforestation affects communities in rural Zambia.", note: "point-per-mark explanation"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },

  // ═══ TOPIC TEST — one topic, 1-2 sections, formal but short ═══════════
  {
    id: "topic_test-lower_primary-_generic",
    assessmentType: "topic_test",
    gradeBand: "lower_primary",
    subject: "_generic",
    label: "Lower Primary Topic Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A",
        instructions: "Answer all the questions. Circle or write the answer.",
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        questionCountHint: "6-8",
        marksShare: 60,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B",
        instructions: "Write your answers in the spaces provided.",
        questionTypes: ["short_answer"],
        questionCountHint: "3-4",
        marksShare: 40,
        marksPerQuestionHint: "2 marks each",
      },
    ],
    coverInstructions: [
      "Write your name and class.",
      "Answer all the questions.",
      "Write neatly.",
    ],
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Very short sentences with familiar words — pitched at a Grade 1-3 Zambian pupil.",
      "Use Circle, Match, Fill in, Count, Write, Draw as the main commands.",
      "Use familiar Zambian things: mangoes, chickens, kwacha coins, the market; names like Bupe and Chanda.",
    ],
    marksConventions: [
      "1 mark per simple answer; 2 marks where the pupil writes or draws something longer.",
      "Typical total: 10-20 marks.",
    ],
    diagramConventions: [
      "Counting, matching and labelling questions often need simple pictures — describe them in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "Which of these is a fruit? A chair  B mango  C stone", note: "simple 3-option MCQ"},
      {type: "short_answer", marks: 2, prompt: "Write the number that comes after 19.", note: "short written answer"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "topic_test-upper_primary-_generic",
    assessmentType: "topic_test",
    gradeBand: "upper_primary",
    subject: "_generic",
    label: "Upper Primary Topic Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "5-8",
        marksShare: 40,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions. Write your answers in the spaces provided. Show your working where marks are given for working.",
        questionTypes: ["short_answer", "calculation", "structured"],
        questionCountHint: "4-6",
        marksShare: 60,
        marksPerQuestionHint: "2-4 marks each",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: PHRASING_PRIMARY,
    marksConventions: [
      "Section A: 1 mark per multiple-choice item.",
      "Section B: 1 mark per fact or step; calculations earn 1 mark for method and 1 for the correct answer.",
      "Typical total: 20-30 marks.",
    ],
    diagramConventions: [
      "Use a labelled figure where the topic is visual (shapes, plants, maps); describe it in the diagram field and write the question as if the figure is printed beside it ('Study the diagram below.').",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "The place value of 7 in 3 745 is …  A units  B tens  C hundreds  D thousands", note: "trailing-ellipsis MCQ stem, ECZ house style"},
      {type: "calculation", marks: 2, prompt: "Work out 456 ÷ 8. Show your working.", note: "method + answer marks"},
      {type: "structured", marks: 4, prompt: "Bupe bought 3 exercise books at K8.50 each. (a) Find the total cost. (b) How much change did she get from K50?", note: "kwacha context, lettered parts"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "topic_test-junior_secondary-_generic",
    assessmentType: "topic_test",
    gradeBand: "junior_secondary",
    subject: "_generic",
    label: "Junior Secondary Topic Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "5-8",
        marksShare: 30,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show all essential working.",
        questionTypes: ["short_answer", "calculation", "structured"],
        questionCountHint: "4-6",
        marksShare: 70,
        marksPerQuestionHint: "3-6 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: PHRASING_SECONDARY,
    marksConventions: [
      "Section A: 1 mark per item.",
      "Structured questions: 3-6 marks split across (a), (b), (c) parts; method and answer earn separate marks on calculations.",
      "Typical total: 25-40 marks.",
    ],
    diagramConventions: [
      "Science and geography items commonly use labelled diagrams, tables or simple graphs; describe the figure in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "Which of the following is a renewable source of energy?  A coal  B charcoal  C solar  D diesel", note: "4-option recall MCQ"},
      {type: "structured", marks: 5, prompt: "Mutinta runs a small poultry business. (a) State TWO records she should keep. (b) Explain ONE reason why keeping records helps her business grow.", note: "scenario stem with lettered parts"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "topic_test-senior_secondary-_generic",
    assessmentType: "topic_test",
    gradeBand: "senior_secondary",
    subject: "_generic",
    label: "Senior Secondary Topic Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions in this section.",
        questionTypes: ["short_answer", "calculation"],
        questionCountHint: "4-6",
        marksShare: 40,
        marksPerQuestionHint: "2-3 marks each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show all essential working and give full explanations.",
        questionTypes: ["structured", "calculation", "essay"],
        questionCountHint: "2-4",
        marksShare: 60,
        marksPerQuestionHint: "5-10 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: PHRASING_SECONDARY,
    marksConventions: [
      "Short answers: 1 mark per valid point.",
      "Structured questions: marks split across lettered parts; method and accuracy marked separately on calculations.",
      "Typical total: 30-50 marks.",
    ],
    diagramConventions: [
      "Use labelled diagrams, graphs and data tables where the subject demands them; describe the figure in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "calculation", marks: 3, prompt: "A car travels 240 km in 3 hours. Calculate its average speed in km/h.", note: "formula + substitution + answer"},
      {type: "structured", marks: 8, prompt: "A copper mining company in Kitwe is expanding. (a) State TWO benefits of the expansion to the local community. (b) Explain TWO environmental problems it may cause. (c) Suggest ONE way the company can reduce these problems.", note: "Zambian industry scenario, three lettered parts"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },

  // ═══ END OF TERM — full formal test, 2-3 sections ═════════════════════
  {
    id: "end_of_term-lower_primary-_generic",
    assessmentType: "end_of_term",
    gradeBand: "lower_primary",
    subject: "_generic",
    label: "Lower Primary End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A",
        instructions: "Answer all the questions. Circle or write the answer.",
        questionTypes: ["multiple_choice", "true_false", "short_answer"],
        questionCountHint: "8-10",
        marksShare: 50,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B",
        instructions: "Write your answers in the spaces provided.",
        questionTypes: ["short_answer"],
        questionCountHint: "5-6",
        marksShare: 50,
        marksPerQuestionHint: "2 marks each",
      },
    ],
    coverInstructions: [
      "Write your name and class.",
      "Answer all the questions.",
      "Write neatly.",
    ],
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Very short sentences with familiar words — pitched at a Grade 1-3 Zambian pupil.",
      "Use Circle, Match, Fill in, Count, Write, Draw as the main commands.",
      "Spread questions across everything taught this term, easiest first.",
      "Use familiar Zambian things: mangoes, chickens, kwacha coins, the market; names like Bupe and Chanda.",
    ],
    marksConventions: [
      "1 mark per simple answer; 2 marks for longer written or drawn answers.",
      "Typical total: 20-30 marks.",
    ],
    diagramConventions: [
      "Counting, matching and labelling questions often need simple pictures — describe them in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "How many legs does a chicken have?  A 2  B 4  C 6", note: "familiar-context MCQ"},
      {type: "short_answer", marks: 2, prompt: "Fill in the missing letters: m_ng_ (a sweet fruit).", note: "fill-in word completion"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "end_of_term-upper_primary-_generic",
    assessmentType: "end_of_term",
    gradeBand: "upper_primary",
    subject: "_generic",
    label: "Upper Primary End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "10",
        marksShare: 30,
        marksPerQuestionHint: "1-2 marks each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions. Write your answers in the spaces provided. Show your working where marks are given for working.",
        questionTypes: ["short_answer", "calculation"],
        questionCountHint: "6-8",
        marksShare: 40,
        marksPerQuestionHint: "2-3 marks each",
      },
      {
        name: "SECTION C",
        heading: "SECTION C: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show all your working.",
        questionTypes: ["structured"],
        questionCountHint: "2-3",
        marksShare: 30,
        marksPerQuestionHint: "4-6 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      ...PHRASING_PRIMARY,
      "Cover the whole term's work, moving from easy recall in Section A to application in Section C.",
    ],
    marksConventions: [
      "Section A: 1-2 marks per item. Section B: 2-3 marks. Section C: 4-6 marks per structured question split across parts.",
      "Calculations earn 1 mark for method and 1 for the correct answer.",
      "Typical total: 40-60 marks.",
    ],
    diagramConventions: [
      "Include a labelled figure where the topic is visual; describe it in the diagram field and write the question as if the figure is printed beside it.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "The money a trader is left with after paying all costs is called …  A wage  B profit  C loan  D rent", note: "trailing-ellipsis MCQ, ECZ register"},
      {type: "short_answer", marks: 2, prompt: "Name TWO sources of water in your community.", note: "TWO in capitals signals the number of points"},
      {type: "structured", marks: 5, prompt: "Luyando sells tomatoes at the market. She buys a box for K120 and sells the tomatoes for K180. (a) Calculate her profit. (b) State ONE way she could increase her profit.", note: "scenario, lettered parts, kwacha"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "end_of_term-junior_secondary-_generic",
    assessmentType: "end_of_term",
    gradeBand: "junior_secondary",
    subject: "_generic",
    label: "Junior Secondary End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "10",
        marksShare: 25,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions in the spaces provided.",
        questionTypes: ["short_answer", "calculation"],
        questionCountHint: "5-7",
        marksShare: 35,
        marksPerQuestionHint: "2-4 marks each",
      },
      {
        name: "SECTION C",
        heading: "SECTION C: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show all essential working and give full explanations.",
        questionTypes: ["structured", "essay"],
        questionCountHint: "2-3",
        marksShare: 40,
        marksPerQuestionHint: "6-10 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      ...PHRASING_SECONDARY,
      "Cover the whole term's work, progressing from recall to application and analysis.",
    ],
    marksConventions: [
      "Section A: 1 mark per item. Section B: 1 mark per valid point or step. Section C: marks split across lettered parts.",
      "Typical total: 50-75 marks.",
    ],
    diagramConventions: [
      "Labelled diagrams, tables and simple graphs are common in science and social studies items; describe the figure in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "Which of the following is NOT a function of the roots of a plant?  A absorbing water  B anchoring the plant  C making food  D storing food", note: "NOT in capitals, used sparingly"},
      {type: "structured", marks: 6, prompt: "Bwalya's family grows maize in Chibombo. (a) Name TWO inputs the family needs for a good harvest. (b) Explain how rainfall affects their yield. (c) Suggest ONE way to reduce post-harvest losses.", note: "Zambian farming scenario, three parts"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "end_of_term-senior_secondary-_generic",
    assessmentType: "end_of_term",
    gradeBand: "senior_secondary",
    subject: "_generic",
    label: "Senior Secondary End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions in this section.",
        questionTypes: ["short_answer", "calculation", "multiple_choice"],
        questionCountHint: "6-8",
        marksShare: 40,
        marksPerQuestionHint: "2-4 marks each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show all essential working and give full explanations.",
        questionTypes: ["structured", "calculation", "essay"],
        questionCountHint: "3-4",
        marksShare: 60,
        marksPerQuestionHint: "8-12 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      ...PHRASING_SECONDARY,
      "Cover the whole term's work; later structured questions should demand multi-step reasoning at school-certificate standard.",
    ],
    marksConventions: [
      "Short answers: 1 mark per valid point. Structured questions: marks split across lettered parts; method and accuracy marked separately.",
      "Typical total: 60-100 marks.",
    ],
    diagramConventions: [
      "Graphs, labelled apparatus and data tables are common; describe the figure in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "short_answer", marks: 2, prompt: "Define inflation and state ONE effect it has on Zambian households.", note: "define + local effect"},
      {type: "structured", marks: 10, prompt: "A solution of hydrochloric acid reacts with zinc metal. (a) Write the word equation for the reaction. (b) State the gas produced and describe its test. (c) Explain TWO ways the rate of this reaction can be increased.", note: "multi-part structured at certificate standard"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },

  // ═══ MOCK EXAMINATION — full exam-conditions paper ════════════════════
  {
    id: "mock_exam-upper_primary-_generic",
    assessmentType: "mock_exam",
    gradeBand: "upper_primary",
    subject: "_generic",
    label: "Grade 7 Mock Examination (PSLE style)",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Each question is followed by four options A, B, C and D. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "15-20",
        marksShare: 70,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: WRITTEN QUESTIONS",
        instructions: "Answer ALL questions. Write your answers in the spaces provided. Show your working.",
        questionTypes: ["short_answer", "calculation", "structured"],
        questionCountHint: "4-6",
        marksShare: 30,
        marksPerQuestionHint: "2-4 marks each",
      },
    ],
    coverInstructions: COVER_MOCK,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Match the ECZ Grade 7 PSLE register: single-best-answer items with four options A-D, exactly one correct.",
      "Mix the common ECZ shapes: fill-in-the-blank stems trailing off with '…', short scenario stems ('Chanda makes and sells flower pots at a lodge. We can say he is …'), direct recall, and an occasional NOT item with the cue word capitalised.",
      "Keep options short, parallel in form and sensibly ordered (alphabetical or numeric). No 'All of the above' / 'None of the above'.",
      "Pitch language at an average 12-13 year old Zambian pupil; use names like Chanda, Luyando, Bupe; kwacha, markets, villages, maize.",
    ],
    marksConventions: [
      "Section A: 1 mark per item, like the real paper.",
      "Section B: 2-4 marks each with method marks on calculations.",
    ],
    diagramConventions: [
      "Some PSLE items refer to pictures, maps or simple charts; describe the figure in the diagram field when used.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "The profit a trader is left with after selling goods is the money called …  A commission  B income  C profit  D wage", note: "paraphrased PSLE register — never copy real items"},
      {type: "multiple_choice", marks: 1, prompt: "To make a strong sleeping mat, Luyando was advised to use the … method.  A knotting  B moulding  C plaiting  D weaving", note: "mid-sentence blank with '…'"},
      {type: "calculation", marks: 3, prompt: "A bus left Lusaka at 08:30 and arrived in Kabwe at 10:15. How long did the journey take?", note: "written section, everyday Zambian context"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "Register distilled from the exam-paper generator style guide (paraphrased ECZ G7 conventions).",
  },
  {
    id: "mock_exam-junior_secondary-_generic",
    assessmentType: "mock_exam",
    gradeBand: "junior_secondary",
    subject: "_generic",
    label: "Grade 9 Mock Examination (JSLE style)",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "15-20",
        marksShare: 40,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions in the spaces provided.",
        questionTypes: ["short_answer", "calculation"],
        questionCountHint: "5-8",
        marksShare: 30,
        marksPerQuestionHint: "2-4 marks each",
      },
      {
        name: "SECTION C",
        heading: "SECTION C: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show all essential working and give full explanations.",
        questionTypes: ["structured", "essay"],
        questionCountHint: "2-3",
        marksShare: 30,
        marksPerQuestionHint: "6-10 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_MOCK,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      ...PHRASING_SECONDARY,
      "Set the paper under examination conditions: spread coverage across the syllabus like a real JSLE paper, easiest items first within each section.",
    ],
    marksConventions: [
      "Section A: 1 mark per item. Sections B and C follow examination marking: 1 mark per valid point or step, method and accuracy separated on calculations.",
    ],
    diagramConventions: [
      "Labelled diagrams, maps, tables and graphs appear regularly; describe the figure in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "Which of the following minerals is mined on the Copperbelt of Zambia?  A coal  B copper  C gold  D iron", note: "Zambian-geography recall MCQ"},
      {type: "structured", marks: 8, prompt: "A school club in Kasama wants to start a vegetable garden. (a) List TWO tools the club will need. (b) Explain TWO benefits of the garden to the school. (c) Describe ONE way the club can keep the soil fertile.", note: "lettered parts at JSLE standard"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "mock_exam-senior_secondary-_generic",
    assessmentType: "mock_exam",
    gradeBand: "senior_secondary",
    subject: "_generic",
    label: "Grade 12 Mock Examination (School Certificate style)",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions in this section.",
        questionTypes: ["short_answer", "calculation", "multiple_choice"],
        questionCountHint: "6-10",
        marksShare: 35,
        marksPerQuestionHint: "2-4 marks each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: STRUCTURED AND ESSAY QUESTIONS",
        instructions: "Answer ALL questions. Show all essential working and give full explanations.",
        questionTypes: ["structured", "calculation", "essay"],
        questionCountHint: "3-5",
        marksShare: 65,
        marksPerQuestionHint: "10-15 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_MOCK,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      ...PHRASING_SECONDARY,
      "Set the paper at school-certificate standard under examination conditions: rigorous multi-step structured questions, precise command words, full syllabus coverage.",
    ],
    marksConventions: [
      "Examination marking throughout: 1 mark per valid point or step; method, accuracy and quality of explanation marked separately on long questions.",
    ],
    diagramConventions: [
      "Graphs, labelled apparatus, maps and data tables are standard; describe the figure in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "short_answer", marks: 3, prompt: "State THREE functions of the Bank of Zambia.", note: "THREE capitalised, 1 mark per point"},
      {type: "structured", marks: 12, prompt: "A farmer in Choma is deciding between growing maize and soya beans. (a) State TWO factors she should consider. (b) Explain how market prices affect her choice. (c) Discuss TWO risks of growing only one crop and how she can manage them.", note: "extended scenario with discussion at certificate standard"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },

  // ═══ SUBJECT OVERRIDES ════════════════════════════════════════════════
  {
    id: "end_of_term-upper_primary-mathematics",
    assessmentType: "end_of_term",
    gradeBand: "upper_primary",
    subject: "mathematics",
    label: "Upper Primary Mathematics — End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "10",
        marksShare: 25,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions. Show ALL your working in the spaces provided. Marks may be awarded for correct working.",
        questionTypes: ["calculation", "short_answer"],
        questionCountHint: "8-10",
        marksShare: 45,
        marksPerQuestionHint: "2-3 marks each (1 for method, 1 for answer)",
      },
      {
        name: "SECTION C",
        heading: "SECTION C: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show ALL your working.",
        questionTypes: ["structured"],
        questionCountHint: "2-3",
        marksShare: 30,
        marksPerQuestionHint: "4-6 marks each, split across lettered parts",
      },
    ],
    coverInstructions: [
      ...COVER_FORMAL,
      "Show ALL your working. Marks may be awarded for correct working.",
      "Calculators are NOT allowed.",
    ],
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Use the maths command words: Work out, Calculate, Find, Solve, Simplify, Measure, Draw, Complete.",
      "Money is in kwacha and ngwee written as K8.50; use a space as the thousands separator (3 745).",
      "Word problems use everyday Zambian situations: market prices, bus fares, school requirements, farming.",
    ],
    marksConventions: [
      "Calculations: 1 mark for correct method/working + 1 mark for the correct answer.",
      "Multi-step problems allocate marks per step; the marking guide must show the step each mark belongs to.",
      "Typical total: 40-60 marks.",
    ],
    diagramConventions: [
      "Geometry items need labelled figures (shapes with marked sides/angles); data items need tables or simple bar charts. Describe the figure in the diagram field and write the question as if the figure is printed beside it.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "The place value of 7 in 3 745 is …  A units  B tens  C hundreds  D thousands", note: "place-value MCQ with thousands space"},
      {type: "calculation", marks: 2, prompt: "Work out 456 × 7. Show your working.", note: "1 method + 1 answer"},
      {type: "structured", marks: 5, prompt: "Chanda sells fritters at school. He makes 48 fritters and sells each at K2.50. (a) How much money does he collect if he sells them all? (b) The ingredients cost K75. Calculate his profit.", note: "kwacha business problem, lettered parts"},
      {type: "calculation", marks: 3, prompt: "The diagram shows a rectangle 8 cm long and 5 cm wide. Calculate (a) its perimeter and (b) its area.", note: "needs a labelled rectangle diagram"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "topic_test-upper_primary-mathematics",
    assessmentType: "topic_test",
    gradeBand: "upper_primary",
    subject: "mathematics",
    label: "Upper Primary Mathematics — Topic Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: SHORT QUESTIONS",
        instructions: "Answer ALL questions. Show your working.",
        questionTypes: ["multiple_choice", "calculation", "short_answer"],
        questionCountHint: "6-8",
        marksShare: 55,
        marksPerQuestionHint: "1-2 marks each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: PROBLEM SOLVING",
        instructions: "Answer ALL questions. Show ALL your working. Marks may be awarded for correct working.",
        questionTypes: ["calculation", "structured"],
        questionCountHint: "3-4",
        marksShare: 45,
        marksPerQuestionHint: "3-4 marks each",
      },
    ],
    coverInstructions: [
      ...COVER_FORMAL,
      "Show ALL your working. Marks may be awarded for correct working.",
    ],
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Use the maths command words: Work out, Calculate, Find, Solve, Simplify, Complete.",
      "Money is in kwacha and ngwee written as K8.50; use a space as the thousands separator (3 745).",
      "Stay strictly within the one topic being tested; word problems use everyday Zambian situations.",
    ],
    marksConventions: [
      "Calculations: 1 mark for method + 1 for answer. Problem questions: marks per step.",
      "Typical total: 20-30 marks.",
    ],
    diagramConventions: [
      "Geometry and data topics need labelled figures or tables; describe the figure in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "calculation", marks: 2, prompt: "Find the value of 3/4 of 60.", note: "direct topic calculation"},
      {type: "structured", marks: 4, prompt: "Mutinta needs 2/5 of a 50 kg bag of mealie meal for a school event. (a) How many kilograms does she need? (b) What fraction of the bag is left?", note: "topic applied to a Zambian scenario"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "end_of_term-upper_primary-english",
    assessmentType: "end_of_term",
    gradeBand: "upper_primary",
    subject: "english",
    label: "Upper Primary English — End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: LANGUAGE STRUCTURE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer or fill in the missing word.",
        questionTypes: ["multiple_choice", "short_answer"],
        questionCountHint: "10-12",
        marksShare: 35,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: COMPREHENSION",
        instructions: "Read the passage below carefully and answer the questions that follow.",
        questionTypes: ["short_answer", "multiple_choice"],
        questionCountHint: "5-7",
        marksShare: 35,
        marksPerQuestionHint: "1-3 marks each",
      },
      {
        name: "SECTION C",
        heading: "SECTION C: COMPOSITION",
        instructions: "Write a composition of about 120-150 words on the topic below. Pay attention to spelling, punctuation and paragraphing.",
        questionTypes: ["essay"],
        questionCountHint: "1",
        marksShare: 30,
        marksPerQuestionHint: "one composition marked out of the full section total",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Section A tests grammar in context: tenses, prepositions, articles, plurals, opposites, punctuation — one point per item.",
      "Section B: write an original short passage (100-160 words) set in a Zambian context (school, market, village, town) at the grade's reading level, then ask literal, inferential and vocabulary questions on it.",
      "Section C: a guided or free composition on a familiar Zambian experience (a school trip, market day, helping at home).",
      "Use Zambian names and places throughout: Chanda, Bupe, Luyando; Lusaka, Kitwe, the local market.",
    ],
    marksConventions: [
      "Section A: 1 mark per item. Section B: 1 mark per literal answer, 2-3 for inference or explanation.",
      "Composition marking guide splits marks across content/ideas, language accuracy, and spelling/punctuation/paragraphing.",
      "Typical total: 40-60 marks.",
    ],
    diagramConventions: [
      "English papers rarely need diagrams; a picture-composition prompt may describe a single picture in the diagram field.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "Choose the correct word: Bupe and Chanda … going to the market.  A is  B are  C am  D be", note: "grammar-in-context item"},
      {type: "short_answer", marks: 2, prompt: "From the passage, explain why Mutinta woke up early on Saturday.", note: "comprehension inference question"},
      {type: "essay", marks: 15, prompt: "Write a composition of about 120-150 words with the title 'A Day at the Market'.", note: "guided composition on a familiar Zambian topic"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "end_of_term-upper_primary-integrated_science",
    assessmentType: "end_of_term",
    gradeBand: "upper_primary",
    subject: "integrated_science",
    label: "Upper Primary Integrated Science — End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: MULTIPLE CHOICE",
        instructions: "Answer ALL questions in this section. Circle the letter of the correct answer.",
        questionTypes: ["multiple_choice"],
        questionCountHint: "10",
        marksShare: 30,
        marksPerQuestionHint: "1 mark each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions in the spaces provided.",
        questionTypes: ["short_answer"],
        questionCountHint: "6-8",
        marksShare: 40,
        marksPerQuestionHint: "2-3 marks each",
      },
      {
        name: "SECTION C",
        heading: "SECTION C: STRUCTURED QUESTIONS",
        instructions: "Study the diagrams carefully and answer the questions that follow.",
        questionTypes: ["structured"],
        questionCountHint: "2-3",
        marksShare: 30,
        marksPerQuestionHint: "4-6 marks each, split across lettered parts",
      },
    ],
    coverInstructions: COVER_FORMAL,
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Use the science command words: Name, State, Label, Draw, Identify, Explain, Describe what happens when ….",
      "Ground questions in things Zambian pupils see: maize plants, boreholes and wells, charcoal braziers, the sun, local animals, clinics and hygiene.",
      "Section C questions typically start from a diagram ('Study the diagram below…') or a simple experiment description.",
    ],
    marksConventions: [
      "Section A: 1 mark per item. Section B: 1 mark per fact or correctly named part.",
      "Labelling questions: 1 mark per correct label. Explanations: 1 mark per valid point.",
      "Typical total: 40-60 marks.",
    ],
    diagramConventions: [
      "This subject is diagram-heavy: labelled drawings of plants, the water cycle, simple circuits, the human body. Most Section C questions should carry a diagram brief (what to draw and which labels/letters to mark) in the diagram field, with the question written as if the figure is printed beside it.",
    ],
    exemplarQuestions: [
      {type: "multiple_choice", marks: 1, prompt: "Which part of a plant carries water from the roots to the leaves?  A flower  B leaf  C stem  D fruit", note: "recall MCQ"},
      {type: "short_answer", marks: 2, prompt: "State TWO ways of making water safe for drinking at home.", note: "health/hygiene context"},
      {type: "structured", marks: 5, prompt: "The diagram shows a bean seedling with parts labelled A, B and C. (a) Name the parts labelled A and B. (b) State the function of the part labelled C. (c) Explain what would happen to the seedling if it was kept in a dark room for two weeks.", note: "diagram-based structured question — needs a labelled seedling figure"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
  {
    id: "end_of_term-junior_secondary-mathematics",
    assessmentType: "end_of_term",
    gradeBand: "junior_secondary",
    subject: "mathematics",
    label: "Junior Secondary Mathematics — End of Term Test",
    paperStructure: [
      {
        name: "SECTION A",
        heading: "SECTION A: SHORT ANSWER QUESTIONS",
        instructions: "Answer ALL questions in this section. Show ALL essential working.",
        questionTypes: ["calculation", "short_answer", "multiple_choice"],
        questionCountHint: "8-10",
        marksShare: 50,
        marksPerQuestionHint: "2-3 marks each",
      },
      {
        name: "SECTION B",
        heading: "SECTION B: STRUCTURED QUESTIONS",
        instructions: "Answer ALL questions. Show ALL essential working. Omission of essential working will result in loss of marks.",
        questionTypes: ["structured", "calculation"],
        questionCountHint: "3-4",
        marksShare: 50,
        marksPerQuestionHint: "6-10 marks each, split across lettered parts",
      },
    ],
    coverInstructions: [
      ...COVER_FORMAL,
      "Show ALL essential working. Omission of essential working will result in loss of marks.",
      "State the units of your answers where appropriate.",
    ],
    numberingStyle: NUMBERING_FORMAL,
    phrasingNotes: [
      "Use the maths command words: Calculate, Solve, Simplify, Factorise, Evaluate, Express, Find, Construct, Draw.",
      "Money in kwacha (K1 500); use a space as the thousands separator.",
      "Word problems use Zambian business, farming and travel contexts at Grade 8-9 standard.",
    ],
    marksConventions: [
      "Method and accuracy marked separately throughout; the marking guide must show which step earns each mark.",
      "Structured questions split marks across (a), (b), (c) parts.",
      "Typical total: 50-75 marks.",
    ],
    diagramConventions: [
      "Geometry, graphs and statistics questions carry figures: labelled triangles/angles, Cartesian grids, bar charts and pie charts. Describe the figure in the diagram field with all labels and given measurements.",
    ],
    exemplarQuestions: [
      {type: "calculation", marks: 3, prompt: "Solve the equation 5x - 8 = 2x + 13.", note: "method steps + final answer"},
      {type: "calculation", marks: 2, prompt: "Express 0.375 as a fraction in its lowest terms.", note: "short conversion item"},
      {type: "structured", marks: 8, prompt: "Mr Mbewe borrows K12 000 from a bank at 15% simple interest per year for 2 years. (a) Calculate the interest he will pay. (b) Find the total amount he must repay. (c) He repays in equal monthly instalments over the 2 years — calculate the monthly instalment.", note: "kwacha finance problem, three parts"},
    ],
    status: "active",
    origin: "builtin_seed",
    sourceNote: "",
  },
];

module.exports = {FORMAT_PROFILES};
