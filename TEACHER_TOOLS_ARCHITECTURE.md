# ZedExams Teacher Tools — Architecture & Technical Blueprint

**Step 2 of 3.** Builds on `TEACHER_TOOLS_STRATEGY.md` (Step 1). Covers: data model, security rules, Cloud Function signatures, the Zambian CBC lesson-plan schema, prompt-template system, CBC knowledge-base format, rate limiting, export pipeline, frontend routing, and admin playground. This document is the implementation contract for Step 3 (the MVP prototype).

---

## 1. Assumptions locked in from Step 1

- Teacher tools live at `zedexams.com/teachers/*` under the same auth and Firestore database.
- Teacher access is gated by the existing `teacherApplications` approval flow. A user's `role` must equal `"teacher"` or `"admin"` to use generation endpoints.
- AI backend is Claude, with model routing between Sonnet 4.5 (heavy tasks) and Haiku 4.5 (light tasks).
- Pricing: Free (10 lesson plans, 5 worksheets, 20 flashcards / month), Individual Paid K89/mo or K799/yr, School K5,000/yr for up to 20 seats.
- Mobile money via the existing `momoService.js`; subscription status stored on the existing `users` document (extended with teacher-plan fields).

## 2. Data model — Firestore additions

All new collections are additive to the existing `users`, `teacherApplications`, `quizzes`, `lessons`, `papers`, `results`, `payments` collections. No existing collection changes shape.

### 2.1 `aiGenerations/{generationId}`

The canonical record of every AI generation. One document per generation, regardless of tool.

```
aiGenerations/{generationId}
├── ownerUid: string                    // auth UID of the teacher
├── tool: "lesson_plan" | "worksheet" | "flashcards" | "quiz" | "rubric" | "scheme_of_work"
├── inputs: object                      // normalized user inputs (see 2.1.1)
├── output: object                      // tool-specific structured output (see §4, §5, §6)
├── outputText: string                  // raw Claude response as JSON string (for reproducibility)
├── modelUsed: "claude-sonnet-4-5" | "claude-haiku-4-5"
├── promptVersion: string               // e.g. "lesson_plan.v3"
├── kbVersion: string                   // e.g. "cbc-kb-2026-04"
├── tokensIn: number
├── tokensOut: number
├── costUsdCents: number                // computed from model + tokens
├── status: "generating" | "complete" | "failed" | "flagged"
├── errorMessage: string | null
├── createdAt: timestamp
├── completedAt: timestamp | null
├── teacherEdited: boolean              // set true once teacher saves edits
├── exportedFormats: string[]           // e.g. ["pdf", "docx"] — grows over time
└── visibility: "private" | "shared_to_school" | "public_marketplace"
```

#### 2.1.1 Normalized `inputs` shape (per tool)

All tools share a common input envelope plus tool-specific fields:

```
inputs: {
  grade: "ECE" | "G1" | ... | "G12",
  subject: string,                     // slug from curriculum, e.g. "mathematics"
  topic: string,
  subtopic: string | null,
  durationMinutes: number | null,      // lesson plan only
  language: "english" | "bemba" | "nyanja" | "tonga" | "lozi" | "kaonde" | "lunda" | "luvale",
  // tool-specific:
  count: number | null,                // worksheet questions, flashcard cards
  difficulty: "easy" | "medium" | "hard" | "mixed",
  instructions: string | null          // free-text teacher override, ≤500 chars
}
```

### 2.2 `teacherLibraries/{uid}/items/{itemId}`

A teacher's saved library — references generations they've chosen to keep.

```
teacherLibraries/{uid}/items/{itemId}
├── generationId: string                // FK into aiGenerations
├── tool: string
├── title: string                       // teacher-editable
├── grade: string
├── subject: string
├── topic: string
├── tags: string[]                      // teacher-assigned
├── folderId: string | null             // for library organization
├── pinned: boolean
├── lastOpenedAt: timestamp
└── createdAt: timestamp
```

### 2.3 `teacherLibraries/{uid}/folders/{folderId}`

Simple folder tree (one level deep for MVP).

```
teacherLibraries/{uid}/folders/{folderId}
├── name: string
├── color: string                       // hex code
├── createdAt: timestamp
└── itemCount: number                   // denormalized; updated by a CF trigger
```

### 2.4 `usageMeters/{uid}/periods/{yyyymm}`

Monthly usage counters for rate limiting and billing reconciliation. Document ID is the period key (e.g. `202604` for April 2026).

```
usageMeters/{uid}/periods/{yyyymm}
├── uid: string
├── periodStart: timestamp
├── periodEnd: timestamp
├── counters: {
│   lesson_plan: number,
│   worksheet: number,
│   flashcards: number,
│   quiz: number,
│   rubric: number,
│   scheme_of_work: number
│ }
├── limits: {                           // snapshot of limits at period start
│   lesson_plan: number,
│   worksheet: number,
│   flashcards: number,
│   quiz: number,
│   rubric: number,
│   scheme_of_work: number
│ }
├── plan: "free" | "individual" | "school"
├── totalCostUsdCents: number
└── updatedAt: timestamp
```

### 2.5 `cbcKnowledgeBase/{kbVersion}` + subcollections

Versioned grounding data injected into prompts. Admin-only writable; cached client-side.

```
cbcKnowledgeBase/{kbVersion}
├── version: string                     // e.g. "2026-04"
├── publishedAt: timestamp
├── isActive: boolean                   // only one at a time
├── sourceNote: string                  // e.g. "CDC syllabus PDFs 2023 + teacher review round 1"
└── notes: string

cbcKnowledgeBase/{kbVersion}/topics/{topicId}
├── grade: string
├── subject: string
├── term: 1 | 2 | 3
├── topic: string
├── subtopics: string[]
├── specificOutcomes: string[]          // CBC "Specific Outcomes"
├── keyCompetencies: string[]
├── values: string[]
├── suggestedMaterials: string[]
└── ecSampleQuestions: string[] | null  // seeded from past papers where available
```

### 2.6 `promptTemplates/{toolId}/versions/{versionId}`

Versioned prompt templates. Admin-only writable.

```
promptTemplates/{toolId}
├── toolId: "lesson_plan" | "worksheet" | ...
├── activeVersionId: string
└── updatedAt: timestamp

promptTemplates/{toolId}/versions/{versionId}
├── versionId: string                   // e.g. "v3"
├── systemPrompt: string
├── userPromptTemplate: string          // Handlebars-style {{placeholders}}
├── jsonSchema: object                  // output JSON schema (validated post-call)
├── defaultModel: "claude-sonnet-4-5" | "claude-haiku-4-5"
├── createdBy: string                   // admin uid
├── createdAt: timestamp
└── notes: string
```

### 2.7 `schoolLicences/{licenceId}`

School-tier licences for Phase 1.5+ (not MVP, but schema locked now to avoid migration).

```
schoolLicences/{licenceId}
├── schoolName: string
├── contactName: string
├── contactEmail: string
├── contactPhone: string
├── adminUid: string                    // principal/head teacher's account
├── seatLimit: number
├── seatsUsed: number
├── memberUids: string[]
├── plan: "school_small" | "school_medium" | "school_large"
├── priceKwacha: number
├── paidUntil: timestamp
├── createdAt: timestamp
└── status: "active" | "expired" | "suspended"
```

### 2.8 Extensions to existing `users/{uid}`

Add fields (all optional; no rule changes needed beyond allowing admin to set them):

```
users/{uid} (additions)
├── teacherPlan: "free" | "individual" | "school" | null
├── teacherPlanExpiresAt: timestamp | null
├── teacherPlanActivatedAt: timestamp | null
├── schoolLicenceId: string | null
└── teacherMonthlyGenerationsOverride: number | null  // admin override for special cases
```

## 3. Security rules — additions

Add to `firestore.rules` inside the root `match /databases/{database}/documents` block. These keep your existing patterns (role checks, `isTeacherOrAbove`, etc.).

```javascript
// ── aiGenerations ─────────────────────────────────────────
match /aiGenerations/{genId} {
  allow read:   if isAuthed() && (resource.data.ownerUid == request.auth.uid || isAdmin());
  // Only Cloud Functions should create these (use the admin SDK), so deny client writes.
  allow create: if false;
  allow update: if isAuthed()
                   && resource.data.ownerUid == request.auth.uid
                   && changedKeys().hasOnly(['teacherEdited', 'visibility', 'exportedFormats']);
  allow delete: if isAuthed() && (resource.data.ownerUid == request.auth.uid || isAdmin());
}

// ── teacherLibraries ──────────────────────────────────────
match /teacherLibraries/{uid} {
  allow read: if isAuthed() && (isOwner(uid) || isAdmin());
  match /items/{itemId} {
    allow read, write, delete: if isAuthed() && isOwner(uid);
  }
  match /folders/{folderId} {
    allow read, write, delete: if isAuthed() && isOwner(uid);
  }
}

// ── usageMeters ───────────────────────────────────────────
match /usageMeters/{uid} {
  allow read: if isAuthed() && (isOwner(uid) || isAdmin());
  match /periods/{periodId} {
    allow read:  if isAuthed() && (isOwner(uid) || isAdmin());
    allow write: if false;   // only Cloud Functions write these
  }
}

// ── cbcKnowledgeBase ──────────────────────────────────────
match /cbcKnowledgeBase/{version} {
  allow read:  if isAuthed();
  allow write: if isAdmin();
  match /topics/{topicId} {
    allow read:  if isAuthed();
    allow write: if isAdmin();
  }
}

// ── promptTemplates ───────────────────────────────────────
match /promptTemplates/{toolId} {
  allow read:  if isAdmin();   // never exposed to non-admin clients
  allow write: if isAdmin();
  match /versions/{versionId} {
    allow read, write: if isAdmin();
  }
}

// ── schoolLicences ────────────────────────────────────────
match /schoolLicences/{licenceId} {
  allow read:   if isAuthed() && (request.auth.uid in resource.data.memberUids || isAdmin());
  allow write:  if isAdmin();
}
```

## 4. The Zambian CBC Lesson Plan schema

This is the canonical output shape for the Lesson Plan Generator. It reflects the CDC's lesson-plan format: administrative header, outcomes, competencies, values, prerequisite knowledge, materials, a three-phase body (Introduction / Development / Conclusion) with matching pupil and teacher activities, assessment, and reflection.

```json
{
  "schemaVersion": "1.0",
  "header": {
    "school": "",
    "teacherName": "",
    "date": "2026-04-20",
    "time": "08:40–09:20",
    "durationMinutes": 40,
    "class": "Grade 5",
    "subject": "Mathematics",
    "topic": "Fractions",
    "subtopic": "Adding Fractions with Unlike Denominators",
    "termAndWeek": "Term 2, Week 4",
    "numberOfPupils": 42,
    "mediumOfInstruction": "English"
  },
  "specificOutcomes": [
    "By the end of the lesson, pupils should be able to identify the LCD of two unlike denominators.",
    "By the end of the lesson, pupils should be able to add two fractions with unlike denominators correctly.",
    "By the end of the lesson, pupils should be able to apply fraction addition to solve a real-life problem involving market quantities."
  ],
  "keyCompetencies": [
    "Critical thinking and problem solving",
    "Numeracy",
    "Communication and collaboration"
  ],
  "values": [
    "Accuracy",
    "Perseverance",
    "Cooperation"
  ],
  "prerequisiteKnowledge": [
    "Pupils can identify numerator and denominator.",
    "Pupils can find the LCM of two numbers up to 20.",
    "Pupils can add fractions with the same denominator."
  ],
  "teachingLearningMaterials": [
    "Fraction strips (paper)",
    "Chalkboard and chalk",
    "Pupils' exercise books",
    "Grade 5 Mathematics Pupil's Book, page 54"
  ],
  "references": [
    { "title": "Zambia Grade 5 Mathematics Pupil's Book", "publisher": "CDC", "pages": "54–57" },
    { "title": "Teacher's Guide Grade 5 Maths", "publisher": "CDC", "pages": "32" }
  ],
  "lessonDevelopment": {
    "introduction": {
      "durationMinutes": 5,
      "teacherActivities": [
        "Greets pupils and settles the class.",
        "Revises addition of fractions with like denominators using two quick examples on the board.",
        "Asks: 'What happens if the denominators are different?' to introduce today's topic."
      ],
      "pupilActivities": [
        "Greet the teacher.",
        "Solve the two revision examples in their exercise books.",
        "Respond to the teacher's question and share ideas."
      ]
    },
    "development": [
      {
        "stepNumber": 1,
        "title": "Demonstration with fraction strips",
        "durationMinutes": 10,
        "teacherActivities": [
          "Distributes fraction strips and models 1/2 + 1/3 physically.",
          "Guides pupils to discover that the strips must be cut into equal-sized pieces.",
          "Introduces the term 'Lowest Common Denominator (LCD)' on the board."
        ],
        "pupilActivities": [
          "Manipulate fraction strips in pairs.",
          "Describe what they observe to a partner.",
          "Copy the LCD definition into their exercise books."
        ]
      },
      {
        "stepNumber": 2,
        "title": "Guided practice",
        "durationMinutes": 12,
        "teacherActivities": [
          "Works through 2/3 + 1/4 on the board, narrating each step.",
          "Poses 3/4 + 1/6 and calls three pupils to complete it at the board while the rest work in books.",
          "Moves around the class, correcting misconceptions."
        ],
        "pupilActivities": [
          "Copy the worked example into their books.",
          "Attempt 3/4 + 1/6 independently then compare with a neighbour.",
          "Raise hands when they reach a difficulty."
        ]
      },
      {
        "stepNumber": 3,
        "title": "Independent practice",
        "durationMinutes": 8,
        "teacherActivities": [
          "Writes 4 problems on the board of mixed difficulty.",
          "Circulates, asking Higher-Order-Thinking questions (HOTS) to faster pupils."
        ],
        "pupilActivities": [
          "Solve the 4 problems silently.",
          "Mark one another's work when the teacher instructs."
        ]
      }
    ],
    "conclusion": {
      "durationMinutes": 5,
      "teacherActivities": [
        "Invites 2 pupils to summarize the LCD method in their own words.",
        "Writes one home-practice problem on the board.",
        "Links the lesson to tomorrow's topic: subtracting fractions with unlike denominators."
      ],
      "pupilActivities": [
        "Summarize the method aloud.",
        "Copy the home-practice problem.",
        "Ask any final questions."
      ]
    }
  },
  "assessment": {
    "formative": [
      "Observation during paired fraction-strip work.",
      "Monitoring of 4 independent practice problems.",
      "Oral questioning during the conclusion."
    ],
    "summative": {
      "description": "Mark the 4 independent-practice problems (out of 4).",
      "successCriteria": "A pupil is considered to have met the outcome if they solve ≥3 correctly."
    }
  },
  "differentiation": {
    "forStruggling": [
      "Pair with a stronger neighbour during guided practice.",
      "Provide pre-drawn fraction strips instead of cutting them themselves."
    ],
    "forAdvanced": [
      "Challenge them with a mixed-number addition problem.",
      "Ask them to create one word-problem for a partner to solve."
    ]
  },
  "homework": {
    "description": "Solve 5 problems on page 57 of the Pupil's Book.",
    "estimatedMinutes": 15
  },
  "teacherReflection": {
    "whatWentWell": "",
    "whatToImprove": "",
    "pupilsWhoNeedFollowUp": []
  }
}
```

The `teacherReflection` section is intentionally left blank — the teacher fills it in after teaching. Fields with Zambian-specific terminology (`termAndWeek`, `numberOfPupils`, `Lowest Common Denominator`) keep the document feeling authentic to Zambian heads of department who review these.

## 5. Worksheet schema

```json
{
  "schemaVersion": "1.0",
  "header": {
    "title": "Grade 5 Mathematics — Adding Fractions (Unlike Denominators)",
    "subject": "Mathematics",
    "grade": "Grade 5",
    "topic": "Fractions",
    "subtopic": "Adding Fractions with Unlike Denominators",
    "duration": "30 minutes",
    "instructions": "Answer ALL questions. Show your working clearly."
  },
  "sections": [
    {
      "title": "Section A — Warm-up (3 marks)",
      "questions": [
        {
          "type": "short_answer",
          "prompt": "Find the LCM of 4 and 6.",
          "marks": 1,
          "answer": "12",
          "workingNotes": "4 = 4, 8, 12; 6 = 6, 12. LCM = 12."
        }
      ]
    },
    {
      "title": "Section B — Core Practice (10 marks)",
      "questions": [
        {
          "type": "calculation",
          "prompt": "Calculate 2/3 + 1/4. Give your answer in its simplest form.",
          "marks": 3,
          "answer": "11/12",
          "workingNotes": "LCD = 12. 2/3 = 8/12, 1/4 = 3/12. 8/12 + 3/12 = 11/12."
        }
      ]
    }
  ],
  "answerKey": {
    "totalMarks": 20,
    "markingNotes": "Award 1 mark for correct LCD, 1 mark for correct equivalent fractions, 1 mark for correct sum.",
    "expectedAnswers": [
      { "sectionIndex": 0, "questionIndex": 0, "answer": "12", "workingNotes": "..." }
    ]
  }
}
```

## 6. Flashcard schema

```json
{
  "schemaVersion": "1.0",
  "title": "Grade 5 — Fractions: Key Terms",
  "grade": "Grade 5",
  "subject": "Mathematics",
  "topic": "Fractions",
  "cards": [
    {
      "front": "What is a fraction?",
      "back": "A number that represents part of a whole, written as numerator/denominator.",
      "example": "3/4 means 3 parts out of 4 equal parts.",
      "hint": "Think of sharing food equally."
    },
    {
      "front": "What is the LCD?",
      "back": "The Lowest Common Denominator — the smallest number that both denominators divide into evenly.",
      "example": "The LCD of 1/4 and 1/6 is 12.",
      "hint": "It is also the LCM of the two denominators."
    }
  ]
}
```

## 7. Prompt-template system

### 7.1 File layout

```
functions/
  prompts/
    lesson_plan/
      v1.json
      v2.json
      v3.json        ← default active version
    worksheet/
      v1.json
      v2.json        ← default
    flashcards/
      v1.json        ← default
    shared/
      cbc_preamble.md
      safety_guardrails.md
```

### 7.2 Prompt document shape (each `vN.json`)

```json
{
  "versionId": "v3",
  "defaultModel": "claude-sonnet-4-5",
  "fallbackModel": "claude-haiku-4-5",
  "temperature": 0.3,
  "maxTokens": 4000,
  "systemPrompt": "You are an expert Zambian Grade {{grade}} teacher...",
  "userPromptTemplate": "Generate a lesson plan for {{subject}} ...",
  "outputJsonSchema": { "$ref": "#/schemas/lesson_plan_v1" }
}
```

At generation time: load the active prompt version, inject CBC knowledge-base entries for the requested grade/subject/topic as a grounding block, render the Handlebars template, call Claude, validate the JSON output against the schema, store everything.

### 7.3 Active version resolution

A small in-memory cache in the Cloud Function process reads `promptTemplates/{toolId}.activeVersionId` on cold start and every 5 minutes. Changing the active version in Firestore is how you roll out a new prompt without a deploy.

## 8. CBC knowledge base — how to build and inject it

The single most important quality lever you have. Without this, Claude invents Zambian-looking but wrong topic names. With it, Claude grounds every generation in real CDC-syllabus topics.

**Sourcing** (for v1 of the KB):
- CDC primary and junior-secondary syllabi (PDFs)
- CDC senior-secondary two-tier framework documents
- ECZ past-paper topic-frequency analysis from your existing `papers` collection
- A human review pass by one Zambian teacher per subject band (Primary, Junior Sec, Senior Sec)

**Storage** in Firestore under `cbcKnowledgeBase/{version}/topics/*` per the schema in 2.5.

**Injection at prompt time**:

```
<cbc_context grade="5" subject="mathematics" topic="Fractions">
Official sub-topics: Equivalent Fractions; Adding Fractions (Like); Adding Fractions (Unlike);
  Subtracting Fractions; Multiplying Fractions by Whole Numbers; Word Problems with Fractions.
Key Competencies typically applied: Critical thinking, Numeracy, Communication.
Values emphasised: Accuracy, Perseverance, Cooperation.
Reference: Zambia Grade 5 Mathematics Pupil's Book (CDC), pages 48–62.
</cbc_context>
```

The Cloud Function looks up the exact topic document and injects it verbatim. If the teacher's requested topic is not found, the function returns a friendly "That topic is not in the Grade 5 Mathematics syllabus — did you mean one of these?" with suggestions, rather than silently hallucinating.

## 9. Cloud Function signatures

Add to `/functions/index.js`. All are HTTPS-callable (auth'd via Firebase Auth on the client).

```javascript
// Generation
exports.generateLessonPlan   = onCall({secrets: ["ANTHROPIC_API_KEY"]}, async (req) => { ... });
exports.generateWorksheet    = onCall({secrets: ["ANTHROPIC_API_KEY"]}, async (req) => { ... });
exports.generateFlashcards   = onCall({secrets: ["ANTHROPIC_API_KEY"]}, async (req) => { ... });

// Library
exports.saveToLibrary        = onCall(async (req) => { ... });
exports.deleteFromLibrary    = onCall(async (req) => { ... });
exports.regenerateSection    = onCall({secrets: ["ANTHROPIC_API_KEY"]}, async (req) => { ... });

// Export
exports.exportToPdf          = onCall(async (req) => { ... });
exports.exportToDocx         = onCall(async (req) => { ... });

// Admin
exports.adminSeedKb          = onCall(async (req) => { ... });
exports.adminPromptPlayground = onCall({secrets: ["ANTHROPIC_API_KEY"]}, async (req) => { ... });
```

Each generation function follows the same flow:

```
1. Verify auth + role ∈ {teacher, admin}.
2. Validate `inputs` against the tool's input schema.
3. Read user's usageMeter for the current period; create if missing.
4. Check counter < limit for this tool on user's plan. If not → throw PRECONDITION_FAILED.
5. Look up CBC KB entry for {grade, subject, topic}. If missing → suggest close matches.
6. Load active prompt template version.
7. Render prompt with inputs + KB context.
8. Route model: Sonnet for lesson_plan/worksheet, Haiku for flashcards.
9. Call Claude Messages API with tool-use for structured JSON output.
10. Validate response against the output JSON schema.
11. In a transaction: increment usageMeter counter, create aiGeneration doc, return generationId + output.
12. On any error: log, mark generation as failed, return friendly error to client.
```

## 10. Rate limiting and usage metering

Rate limits are enforced **server-side only** (client UI mirrors them for UX but never gates — a client-only check is a subscription-bypass vulnerability).

Implementation:

```javascript
// Pseudo-code inside each generation function
const period = yyyymm(now);
const meterRef = db.doc(`usageMeters/${uid}/periods/${period}`);

await db.runTransaction(async (tx) => {
  const meter = (await tx.get(meterRef)).data() || seedMeter(uid, period);
  const used  = meter.counters[tool] || 0;
  const limit = meter.limits[tool];
  if (used >= limit) {
    throw new HttpsError("failed-precondition", "quota-exceeded", {tool, used, limit});
  }
  tx.set(meterRef, {
    ...meter,
    counters: {...meter.counters, [tool]: used + 1},
    updatedAt: FieldValue.serverTimestamp()
  }, {merge: true});
});
```

Plan → limits mapping (Phase 1):

| Tool            | Free | Individual | School (per teacher) |
|-----------------|------|------------|-----------------------|
| lesson_plan     | 10   | 100        | 100                   |
| worksheet       | 5    | 50         | 50                    |
| flashcards      | 20   | 200        | 200                   |
| quiz            | 3    | 40         | 40                    |
| rubric          | 2    | 20         | 20                    |
| scheme_of_work  | 0    | 5          | 5                     |

Admins can override via `users.teacherMonthlyGenerationsOverride` for special cases.

## 11. Export pipeline

Two paths:

**DOCX** — client-side using the `docx` npm package. A `lessonPlanToDocx(generationObject)` function walks the JSON and emits a Word document styled to match a typical Zambian lesson-plan template (bordered tables, CDC-style section headings). Fast (≤200ms), zero server cost, works offline.

**PDF** — server-side using a `renderToPdf` Cloud Function that uses Puppeteer (already in your Firebase Functions environment as a dependency option). It renders a React/HTML template to Chromium and returns a PDF. Slower (~2s) and costs a Function invocation, but produces consistent output.

File naming convention:
```
{teacher-name-slug}_{grade}_{subject}_{topic-slug}_{date}.docx
```

Stored in Firebase Storage under `teacher-exports/{uid}/{generationId}.{ext}` for redownload. Retention: 30 days, then auto-deleted via a scheduled function.

## 12. Frontend routing — additions to `src/App.jsx`

```
/teachers                      — Teacher dashboard (library, stats, upgrade CTA)
/teachers/generate/lesson-plan — Lesson Plan Generator
/teachers/generate/worksheet   — Worksheet Generator
/teachers/generate/flashcards  — Flashcard Generator
/teachers/library              — Saved generations (search, filter, folder view)
/teachers/library/:itemId      — Detail view (read, edit, export, regenerate)
/teachers/settings             — Teacher profile + plan
/teachers/upgrade              — Pricing / plan selection (reuses your Flutterwave/MoMo flow)
/admin/prompts                 — Admin: prompt playground (role=admin gated)
/admin/kb                      — Admin: CBC knowledge-base editor
/admin/metrics                 — Admin: usage + cost dashboards
```

## 13. Component tree — additions under `src/components/teacher/`

```
src/components/teacher/
├── TeacherLayout.jsx                     (existing — extend to add a Generate menu)
├── TeacherDashboard.jsx                  (existing — add Quick Actions grid)
├── TeacherContent.jsx                    (existing)
├── TeacherPaperUpload.jsx                (existing)
├── generate/
│   ├── GeneratorShell.jsx                (shared layout: inputs panel + streaming preview)
│   ├── LessonPlanGenerator.jsx
│   ├── WorksheetGenerator.jsx
│   ├── FlashcardGenerator.jsx
│   ├── inputs/
│   │   ├── GradeSelector.jsx
│   │   ├── SubjectSelector.jsx
│   │   ├── TopicPicker.jsx               (typeahead from CBC KB)
│   │   ├── DifficultySelector.jsx
│   │   └── LanguageSelector.jsx
│   └── output/
│       ├── LessonPlanView.jsx            (editable TipTap-powered)
│       ├── WorksheetView.jsx
│       ├── FlashcardDeckView.jsx
│       ├── ExportMenu.jsx
│       └── UsageMeterBadge.jsx
├── library/
│   ├── LibraryShell.jsx
│   ├── LibraryGrid.jsx
│   ├── LibraryItemCard.jsx
│   ├── FolderSidebar.jsx
│   └── LibraryFilters.jsx
└── subscription/
    ├── TeacherPlanCards.jsx
    └── UpgradeModal.jsx
```

## 14. Admin prompt playground

A single admin page at `/admin/prompts` that lets you:
- Pick a tool (lesson_plan / worksheet / flashcards).
- Pick the current active version and one or more older versions.
- Enter a test input (grade, subject, topic, etc.).
- Run all selected versions against the same input in parallel.
- See a side-by-side diff of the outputs.
- Promote a non-active version to active with one click.

Build this in Phase 1. It pays for itself in the first prompt change.

## 15. Observability and cost tracking

Log every generation to an `aiGenerationsMetrics` **BigQuery sink** (via Firebase's built-in BigQuery export, free to set up). Daily aggregates via a scheduled function:

```
- generations per tool per day
- average tokens in/out per tool
- cost per generation (computed from modelUsed + tokens)
- free-tier-exhaustion rate per cohort
- tool-to-export rate per user
- failure rate by error code
```

Surface on `/admin/metrics`. These are the numbers you'll need to make Phase 2 prioritization decisions.

## 16. Implementation order for Step 3 (MVP build)

1. **Data & rules**: Add the new Firestore collections + security-rule block. Deploy rules.
2. **Prompt templates**: Commit `v1` prompts for lesson_plan, worksheet, flashcards. Seed `promptTemplates/*` in Firestore.
3. **CBC KB**: Seed a minimum viable KB — Grades 1–7 × core subjects (Mathematics, English, Integrated Science, Social Studies, Literacy, Zambian Language). Senior secondary comes later.
4. **Cloud Functions**: `generateLessonPlan` first (highest-value tool), then `generateWorksheet`, then `generateFlashcards`. Deploy + test each with Postman before touching the frontend.
5. **Frontend generators**: `LessonPlanGenerator` first — full round trip including export. Then Worksheet, then Flashcards.
6. **Library**: Dashboard, grid, detail view, folder support.
7. **Rate limiting**: wired into the Functions from step 4; UI meters in step 5/6.
8. **Admin playground**: last, but before first public beta.

## 17. Open questions for Step 3

Before I write the code, I need your answers on:

1. **Prompt-template seed language** — English-only for v1, or also seed Bemba / Nyanja templates from day one?
2. **Export default** — DOCX first (teachers edit before printing) or PDF first (print-ready)?
3. **Lesson-plan length preset** — default to 40-minute single lesson, or offer 40 / 60 / 80-minute presets?
4. **Streaming UI** — use Claude's SSE streaming so the teacher sees the plan build in real time, or wait for the full response (simpler, 3–8s spinner)?
5. **Beta cohort access** — gated invite codes for the first 20 teachers, or public free tier immediately?

Answer those five and I'll move into Step 3 — the working MVP prototype.
