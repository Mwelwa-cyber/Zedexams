# ZedExams — AI Note Generation Spec (the Block Recipe)

**What this is.** The reusable, subject-agnostic recipe that turns **one topic** into shippable learner content: a **note** (block JSON), a **quiz**, and **word-bank cards**. Drop it into your generation pipeline as the system prompt + schema + validation. It produces exactly the structure shown in the Grade 7 English reference (Part C).

**Golden rule.** The AI is an *author following a textbook*, not a knower. Facts and vocabulary come **only** from the supplied prescribed-textbook pages. If the AI's own knowledge disagrees with the book, the **book wins** — because the ECZ exam marks the book. (This is why "small intestine = 2 parts" when the Zambian book says so.)

---

## 1. Inputs (per topic)

Every generation call receives three things:

```json
{
  "topic": {
    "id": "eng-g7-conjunctions", "subject": "english", "grade": 7, "term": 2,
    "title": "Conjunctions — Joining Words", "strand": "ST",
    "syllabusRefs": ["7.4.14"], "examParts": ["P1"]
  },
  "syllabus": "Verbatim outcomes for this topic (Specific Outcomes, Knowledge, Skills, Values columns).",
  "textbook": "Verbatim prescribed-textbook pages for this topic — THE source of truth for facts & wording.",
  "pastPapers": [
    { "part": "P1", "stem": "I enjoyed the play …… I have seen it before.",
      "options": ["after","and","although","but"], "answer": 3 }
  ]
}
```

- **syllabus** → what to cover (scope, outcomes) and the exam-part mapping.
- **textbook** → the actual content, facts and vocabulary. Never go beyond it for facts.
- **pastPapers** → the style, difficulty and phrasing of quiz questions; and which sub-skills the exam weights.

If `textbook` is missing, **stop** and flag `needs-source` — do not generate from general knowledge.

---

## 2. Output contract

Return **one JSON object**, no prose around it:

```json
{
  "note":  { /* see §3 */ },
  "quiz":  { /* see §5 */ },
  "words": [ /* see §6 */ ],
  "meta":  { "sourcePages": "...", "confidence": 0.0-1.0, "flags": [] }
}
```

`meta.flags` may include: `needs-source`, `ambiguous-textbook`, `outcome-not-in-textbook`, `low-confidence`. Anything flagged routes to a human before publish.

---

## 3. Note block schema

`note.blocks` is an **ordered array**. Allowed block types and required fields:

| type | fields | notes |
|------|--------|-------|
| `heading` | `num`(int), `text` | starts a Learn step |
| `para` | `text` | may contain `[[kw:word]]` and `**bold**` |
| `tip` | `text`, `variant`:`trick`\|`alert` | Zed voice; keep to 1–2 sentences |
| `example` | `html` | worked example; `<u>` marks the target |
| `reveal` | `prompt`, `answer`, `note?` | tap-to-reveal |
| `tryit` | `prompt`, `options[]{label,correct}`, `feedback{correct}` | 1 correct |
| `sectionCheck` | `prompt`, `options[]`, `remediation{explain,examples,retry{prompt,options[]}}` | **required at end of each section** |
| `keypoints` | `html` | shown in Revise; **required per section** |
| `topicQuiz` | `quizId` | last block; references the quiz |
| *(Science)* `tapExplore` | `items[]{label,image,role}` | tap-to-open detail sheet |
| *(Science)* `labelDiagram` | `image`, `boxes[]{id,x,y}`, `bank[]`, `answers{}` | drag/tap labels; needs an **unlabelled** image + box coords |
| *(Maths, planned)* `workedSteps` | `steps[]` | line-by-line worked solution |

**note wrapper fields:** `id`, `topicId`, `title` (may include one emoji), `readMins` (int), `sources` (page refs), `blocks[]`.

---

## 4. Generation procedure

1. **Read the textbook pages.** Extract the topic's facts, definitions, key terms and the book's *exact wording* for anything examinable. List the sub-concepts in the book's order (this becomes your sections).
2. **Cross-check the syllabus.** Ensure every Specific Outcome is covered by a section. If an outcome isn't in the textbook pages, cover it minimally and flag `outcome-not-in-textbook`.
3. **Plan sections.** One `heading` per sub-concept (2–5 sections is typical). Order simplest → hardest for the grade.
4. **Draft each section in the Learn→See→Try→Check rhythm:**
   - open with a `keypoints` block (compact summary) — used by Revise mode and offline cards;
   - 1–2 `para` blocks (short; mark key terms `[[kw:]]`);
   - one `example` (Zambian names/settings);
   - optionally a `reveal` and a `tryit`;
   - close with **one `sectionCheck` that has full `remediation`** targeting the most likely confusion.
5. **Front matter & tips.** Add an opening `para` defining the concept, a `tip:trick` (a memory hook), and near the end a `tip:alert` linking the topic to its exam part.
6. **Author Word Bank cards** for every `[[kw:]]` used (§6).
7. **Build the quiz** from/like the past papers (§5).
8. **End with `topicQuiz`.**
9. **Self-validate** against §7. Emit JSON only.

---

## 5. Quiz generation rules

```json
{
  "id": "quiz-<topicId>", "topicId": "<id>", "examPart": "<P1..P4|SB>",
  "questions": [
    { "q": "...", "help": "one-line hint",
      "options": ["A","B","C","D"], "answer": 0, "topic": "<Topic title>" }
  ]
}
```
- **5–8 questions.** Match the **phrasing, difficulty and format of the mapped past-paper part** (P1 sentence-completion, P2 spelling, P3 punctuation, P4 meaning).
- Options render **vertically, A–D letter badges** (ECZ style). 3–4 options; exactly one correct.
- **Plausible distractors** — misspellings for P2, near-meanings for P4, near-punctuation for P3.
- Every question carries the **`topic` tag** (drives results advice and weak-topic → games feedback).
- Use **Zambian** names/contexts. Never reuse a past-paper question verbatim if copyright-sensitive — regenerate in the same style.

---

## 6. Word Bank card rules

```json
{ "w": "so", "subject": "english",
  "meaning": "Shows a result ➡️",
  "how": "Short 'how to use it' — include the common mistake (because = reason, so = result).",
  "examples": "2–3 short sentences, target <u>underlined</u>, Zambian context." }
```
- Author **once per subject**; every note that marks `[[kw:so]]` reuses it.
- Child-level language, not a dictionary definition. Meaning ≤ ~6 words + one emoji; `how` = the usage + the trap.

---

## 7. Validation checklist (auto, before human review)

Reject/repair if any fail:

- [ ] Valid JSON; only allowed block types; required fields present.
- [ ] Every section (each `heading`) is followed by a `keypoints` and ends with a `sectionCheck` that has `remediation.explain`, `remediation.examples`, and a `remediation.retry` **whose answer differs from the check's**.
- [ ] Each `tryit`/`sectionCheck`/quiz question has **exactly one** correct option.
- [ ] Every `[[kw:x]]` has a matching card in `words` (or already exists in the Word Bank).
- [ ] Note ends with a `topicQuiz` whose `quizId` matches `quiz.id`.
- [ ] Quiz has 5–8 questions, all `topic`-tagged, format matches `examPart`.
- [ ] **Fact check:** no fact appears that isn't supported by the supplied textbook text (flag `ambiguous-textbook` if unsure).
- [ ] Reading level: sentences short; no word above Grade 7 unless it's the term being taught (and then it's a `[[kw:]]`).
- [ ] No real minors' data, no unsafe content; examples are age-appropriate.
- [ ] `readMins` roughly matches block count (~1 min per section + 1).

Failing structural checks → auto-repair and re-emit. Failing fact/confidence checks → set `flags` and route to a human.

---

## 8. Constraints & voice

- **Zed** is the tip/feedback voice: warm, encouraging, never sarcastic. British/Zambian spelling ("practise", "colour", "oesophagus/gullet").
- **Never** shame a wrong answer — remediation is "let's look again", and a recovered retry earns praise.
- Keep the child in mind: 12–13 years old, phone screen, possibly weaker reader, limited data (no heavy assets; TTS is device-side).
- **Textbook-faithful**: prefer the book's term even if a more common synonym exists (gullet vs oesophagus, egestion vs excretion) — the exam marks the book's term.

---

## 9. Ready-to-paste prompt template

> **System:** You are a ZedExams content author creating a Grade `{grade}` `{subject}` note for Zambian learners, strictly from the supplied prescribed textbook. Output only the JSON object defined in the schema. Follow every rule.
>
> **Rules:** (1) Facts and vocabulary come ONLY from `TEXTBOOK`; if your knowledge disagrees, the textbook wins; never invent facts — flag `needs-source` if `TEXTBOOK` is empty. (2) Cover every Specific Outcome in `SYLLABUS`; flag any not in the textbook. (3) Structure: one `heading` per sub-concept; each section = `keypoints` → 1–2 `para` (mark key terms `[[kw:]]`) → `example` (Zambian names) → optional `reveal`/`tryit` → a `sectionCheck` with full `remediation` (explain + 2 examples + a *different* retry). (4) Open with a definition `para` + a `tip:trick`; near the end add a `tip:alert` naming the exam part `{examParts}`. (5) Build a 5–8 question quiz matching the style of `PASTPAPERS` for exam part `{examParts}`, options vertical A–D, one correct, `topic`-tagged. (6) Author a Word Bank card for every `[[kw:]]`. (7) End the note with a `topicQuiz`. (8) Child-level language, British/Zambian spelling, encouraging Zed voice. (9) Validate against the checklist; set `meta.flags` and `meta.confidence`.
>
> **TOPIC:** `{topic json}`
> **SYLLABUS:** `{verbatim outcomes}`
> **TEXTBOOK:** `{verbatim prescribed pages}`
> **PASTPAPERS:** `{tagged past-paper questions}`
>
> **Return:** the JSON object `{ note, quiz, words, meta }` only.

---

## 10. Pipeline & human gate

```
for each topic in curriculum:
    inputs = collect(syllabus_outcomes, textbook_pages, past_papers)   # see intake template
    draft  = AI.generate(prompt_template, inputs)                      # this spec
    draft  = autoValidate(draft)                                       # §7 structural repair
    if draft.meta.flags or draft.meta.confidence < 0.8:
        queue_for_teacher_review(draft)                                # human edits
    else:
        queue_for_teacher_approval(draft)                             # quick sign-off
    on approve: publish(topic.status = "published")
```

- **Nothing auto-publishes.** A teacher approves every note (fast for high-confidence, editing for flagged).
- Store the exact `TEXTBOOK` source pages on the note (`sources`) for auditability — so any fact can be traced back to the book.
- Regeneration is idempotent per topic; approved edits are preserved (don't overwrite human changes on re-run).

---

*Companion docs: the Grade 7 English reference (worked example of the output), the content intake template (how to collect the three inputs), and the learner-side app build spec (how the app renders and runs this content).*
