# Teacher Tools MVP — Wiring and Deploy Guide

**Step 3 deliverable.** This is the working vertical slice of the Zambian CBC Lesson Plan Generator — backend Cloud Function, React generator UI, DOCX export, Firestore rules, and metering.

Worksheet and Flashcard generators are not in this pass — they follow the same pattern and can be added in a second sprint once the Lesson Plan generator is validated with real teachers.

---

## Files added in this MVP

### Backend — `functions/teacherTools/`

| File | Purpose |
|---|---|
| `anthropicClient.js` | Dedicated Claude client (returns text + usage; not clipped) |
| `cbcKnowledge.js` | In-code CBC KB seed (Grade 4-6 sample topics) + lookup/suggest helpers |
| `lessonPlanSchema.js` | Runtime validator for the generated lesson-plan JSON |
| `lessonPlanPrompt.js` | System prompt + user-prompt builder (v1) |
| `usageMeter.js` | Per-tool, per-month quota enforcement |
| `generateLessonPlan.js` | The onCall Cloud Function |

### Frontend — `src/`

| File | Purpose |
|---|---|
| `utils/teacherTools.js` | httpsCallable wrapper + option constants |
| `utils/lessonPlanToDocx.js` | DOCX export (uses `docx` package) |
| `components/teacher/generate/LessonPlanGenerator.jsx` | The page teachers use |

### Docs

| File | Purpose |
|---|---|
| `TEACHER_TOOLS_STRATEGY.md` | Step 1 — business strategy & roadmap |
| `TEACHER_TOOLS_ARCHITECTURE.md` | Step 2 — architecture blueprint (schemas, rules) |
| `TEACHER_TOOLS_FIRESTORE_RULES_PATCH.md` | Rules block to paste into firestore.rules |
| `TEACHER_TOOLS_MVP_README.md` | This file |

---

## One-time setup

### 1. Install frontend dependency for DOCX export

```bash
npm install docx
# Optional — nicer cross-browser file-download UX:
npm install file-saver
```

### 2. (Optional) Install file-saver types if using TS later

```bash
# Skip this if you're staying on plain JS
npm install --save-dev @types/file-saver
```

### 3. Paste Firestore rules

Open `firestore.rules`, and inside the root `match /databases/{database}/documents { ... }` block (alongside the existing `// ── lessons ──` and `// ── payments ──` sections), paste the block from `TEACHER_TOOLS_FIRESTORE_RULES_PATCH.md`.

### 4. Wire the Cloud Function

Edit `functions/index.js`. Near the top, after the existing `require(...)` for `./aiService`, add:

```javascript
const { createGenerateLessonPlan } = require('./teacherTools/generateLessonPlan')
```

Then, anywhere near your other `exports.xxx = onCall(...)` declarations (the file has many), add:

```javascript
exports.generateLessonPlan = createGenerateLessonPlan(anthropicApiKey)
```

`anthropicApiKey` is the existing `defineSecret("ANTHROPIC_API_KEY")` already declared at the top of `index.js`.

### 5. Wire the frontend route

Edit `src/App.jsx`. At the top with the other lazy imports:

```jsx
const LessonPlanGenerator = lazy(() =>
  import('./components/teacher/generate/LessonPlanGenerator')
)
```

Inside the `<Routes>` element, alongside your other `/teacher/...` routes guarded by `<TeacherRoute>`, add:

```jsx
<Route
  path="/teachers/generate/lesson-plan"
  element={<TeacherRoute><LessonPlanGenerator /></TeacherRoute>}
/>
```

(Note: uses `/teachers/` plural — matches the branding "ZedExams Teacher Suite" and the architecture doc. If your existing teacher routes use `/teacher/` singular, pick one and stay consistent. I'd switch existing routes to `/teachers/` since that's what the SEO-friendly landing page should be too.)

### 6. Add a Teacher dashboard link

In `src/components/teacher/TeacherDashboard.jsx` or `TeacherLayout.jsx`, add a button / nav item linking to `/teachers/generate/lesson-plan` so teachers can find it.

---

## Deploy

```bash
# Deploy Firestore rules first (the function will fail on first run without them).
npm run deploy:firebase:firestore

# Deploy the function.
npm run deploy:firebase:functions

# Deploy the frontend.
npm run deploy
```

---

## Verifying it works

1. **Approve a teacher account.** The function requires `users/{uid}.role == 'teacher'` or `admin`. If testing as yourself, set your own role to `admin` via Firestore console, or approve your teacher application via the existing admin flow.

2. **Open `/teachers/generate/lesson-plan`** while logged in.

3. **Pick Grade 5 → Mathematics → Fractions.** The seed KB has this topic, so it should work end-to-end. Click Generate.

4. **Expected result:** In 15–30 seconds, a fully-formed Zambian CBC lesson plan renders on the right, with a Download .docx button that produces a printable Word document formatted with bordered header table and parallel Teacher's Activities / Pupils' Activities columns.

5. **Check Firestore.** You should see:
   - A new `aiGenerations/{id}` doc with `status: "complete"`, the full lesson plan under `output`, and token counts.
   - A `usageMeters/{yourUid}/periods/{yyyymm}` doc with `counters.lesson_plan: 1`.

---

## What's stubbed vs. production-ready

**Production-ready:**
- Prompt system + Zambian CBC system prompt grounded in `<cbc_context>` injection.
- Schema validation that degrades gracefully (returns what we have, flags the doc).
- Per-tool monthly quota with atomic Firestore transaction.
- Token counts + cost calculation stored on every generation.
- DOCX export formatted for Zambian head-teacher submission.
- Role gate using existing `teacher` / `admin` role scheme.
- Error messages localised to teacher context (not generic "AI unavailable").

**Stubbed for now:**
- CBC KB is in-code with ~4 topics. Next step is to migrate to Firestore `cbcKnowledgeBase` and build an admin UI to seed all Grades 1-9 × core subjects from CDC syllabi. Budget a weekend of data entry with a Zambian teacher collaborator for this.
- No "Save to Library" flow yet — generations are saved to `aiGenerations` but there's no library UI. Design lives in `TEACHER_TOOLS_ARCHITECTURE.md §2.2` and `§13`.
- No streaming UI — teacher sees a 15-30s spinner. Streaming via SSE can be added later; it's UX polish, not blocker.
- Worksheet and Flashcard generators not built — same backend pattern, different prompt + schema.
- Admin prompt playground and KB editor not built.
- PDF export not built (DOCX covers 90% of the need; PDF is a Phase 2 addition).

---

## How to iterate the prompt safely

1. Don't edit `lessonPlanPrompt.js` in place once you have beta teachers using it.
2. Copy it to `lessonPlanPromptV2.js`, bump `PROMPT_VERSION` to `"lesson_plan.v2"`, edit the v2 file.
3. Flip the import in `generateLessonPlan.js`, redeploy.
4. Old `aiGenerations` docs keep their `promptVersion: "lesson_plan.v1"` stamp, so you can always reproduce what a given teacher saw.
5. Better long-term: move prompt templates to Firestore (`promptTemplates/{toolId}/versions/{vN}`) per the architecture doc so prompt changes don't require a function redeploy.

---

## Next-step options (pick one for Step 4)

A. **Worksheet Generator** — same pattern, 2-3 hours of additional work. Highest value for teachers.
B. **Flashcard Generator** — fastest to ship (smaller output, Haiku model), good for quick revision content.
C. **Teacher library UI** — let teachers find and re-download / edit their past generations. Unlocks retention.
D. **CBC KB admin editor** — lets you or a teacher collaborator seed the full Grade 1-9 curriculum efficiently. Required before a public launch.
E. **Streaming UI** — polish the "generating" experience.

My recommendation: **A then D** — Worksheet generator first (completes the most-requested tool pair), then the KB editor so you can expand to all grades before public beta.
