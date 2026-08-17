# ZedExams — Grade 7 English: End-to-End Reference

**Purpose.** This is the *worked example* for the whole learner-content system. It shows, for **one subject and grade (Grade 7 English)**, exactly how a subject is turned into shippable content:

1. **Part A —** the full **term-split topic map** (every topic, its strand, syllabus outcome, and which exam part it maps to).
2. **Part B —** the **note content model** (the block types every note is built from).
3. **Part C —** one **fully-authored note (Conjunctions)** expressed as canonical block data — the gold reference the AI copies for every other topic.
4. **Part D —** the topic's **quiz + section checks + word cards**.
5. **Part E —** the **authoring rules** the AI must follow.

Every other subject/grade is produced the same way. Feed the AI a topic's *syllabus outcomes* + the *prescribed-textbook pages* + *past-paper questions*, and it emits the same block structure shown in Part C, which a teacher reviews before it ships.

> Source of truth: facts and vocabulary come from the **prescribed Grade 7 textbook**, not general knowledge — because the ECZ exam marks the textbook's version. Where the two disagree, the textbook wins.

---

## Part A — Grade 7 English term-split topic map

The 2013 syllabus is organised by **strand** (Listening & Speaking `7.1.x`, Reading `7.2.x`, Writing `7.3.x`, Structure `7.4.x`), *not* by term. Topics are spread across the three terms in a **spiral**: foundations first, exam-heavy material last. Each term carries a mix of all four strands.

**Strand key:** `LS` Listening & Speaking · `RD` Reading · `WR` Writing · `ST` Structure

**Exam-part key (PRISCA mock 2026, 60 Q, 90 min):** `P1` Grammar/sentence-completion (Q1–20) · `P2` Spelling (Q21–25) · `P3` Punctuation (Q26–30) · `P4` Word meaning (Q31–38) · `SB` Section B comprehension/cloze.

### Term 1 — foundations
| # | Topic | Strand | Syllabus ref | Exam link |
|---|-------|--------|--------------|-----------|
| 1 | Conversation & Polite Requests | LS | 7.1.6, 7.1.9, 7.1.10 | — |
| 2 | Stories — Legends & Myths | LS | 7.1.11 | SB |
| 3 | Intensive Reading | RD | 7.2.1 | SB |
| 4 | Nouns | ST | 7.4 | P1 |
| 5 | Adjectives — comparing things | ST | 7.4 | P1 |
| 6 | Punctuation | ST | 7.4.12 | **P3** |
| 7 | Dictation & Spelling | WR | 7.3 | **P2** |

### Term 2 — building
| # | Topic | Strand | Syllabus ref | Exam link |
|---|-------|--------|--------------|-----------|
| 8 | Debate | LS | 7.1.7 | — |
| 9 | Figures of Speech — riddles, proverbs, idioms | LS | 7.1.5 | P4 |
| 10 | Reading Aloud | RD | 7.2.2 | — |
| 11 | Using References — dictionary, index, glossary | RD | 7.2.3 | — |
| 12 | Formal Letters | WR | 7.3 | SB |
| 13 | Adverbs | ST | 7.4 | P1 |
| 14 | **Conjunctions — joining words** | ST | 7.4.14 | **P1** |

### Term 3 — exam-heavy
| # | Topic | Strand | Syllabus ref | Exam link |
|---|-------|--------|--------------|-----------|
| 15 | Drama & Messages | LS | 7.1.3, 7.1.4 | — |
| 16 | Extensive Reading | RD | 7.2.4 | SB |
| 17 | Interpreting Charts, Maps & Graphs | RD | 7.2.4 | SB |
| 18 | Guided Essays | WR | 7.3 | SB |
| 19 | Notices, Adverts & Summary | WR | 7.3 | SB |
| 20 | Active & Passive Voice | ST | 7.4 (passive) | P1 |
| 21 | Direct & Indirect Speech | ST | 7.4.13 | P1/P3 |

**Data shape for a topic (Firestore `topics/{id}`):**
```json
{
  "id": "eng-g7-conjunctions",
  "subject": "english", "grade": 7, "term": 2,
  "title": "Conjunctions — Joining Words",
  "strand": "ST",
  "syllabusRefs": ["7.4.14"],
  "examParts": ["P1"],
  "order": 14,
  "status": "published",         // draft | in-review | published
  "noteId": "note-eng-g7-conjunctions",
  "quizId": "quiz-eng-g7-conjunctions"
}
```

---

## Part B — Note content model (block types)

A **note is an ordered array of typed blocks**. Every note renders through one reader with two modes — **Learn** (paced: one section revealed at a time via *Continue*) and **Revise** (all open; exercises hidden, `keypoints` shown). One content object, two views.

| Block type | Purpose | Key fields |
|------------|---------|-----------|
| `heading` | Section title (starts a Learn "step") | `num`, `text` |
| `para` | Body text; may contain tappable keywords | `text` (with `[[kw:and]]` markers) |
| `tip` | Zed speech box (trick / exam alert) | `text`, `variant` (`trick`\|`alert`) |
| `example` | Worked example card | `html` |
| `reveal` | Tap-to-reveal Q→A (low-pressure) | `prompt`, `answer`, `note` |
| `tryit` | Inline single-question exercise | `prompt`, `options[]`, `feedback` |
| `sectionCheck` | End-of-section check **+ remediation** | `prompt`, `options[]`, `remediation{}` |
| `keypoints` | Compact summary (shown in **Revise** only) | `html` |
| `labelDiagram` | Drag/tap labels onto a diagram (Science etc.) | `image`, `boxes[]`, `bank[]` |
| `tapExplore` | Tap items to open a detail sheet (Science organs) | `items[]` |
| `topicQuiz` | End-of-note quiz button → quiz engine | `quizId` |

**Keyword references** (`[[kw:word]]`) link to the subject's **Word Bank** (glossary). A word is authored once and every note that marks it gets the same tap-to-explain bubble.

Blocks reused across subjects; some are subject-flavoured (`labelDiagram`/`tapExplore` for Science; a future `workedSteps` block for Maths). The reader, Learn/Revise, section-check remediation, keyword bubbles and quizzes come for free with the block set.

---

## Part C — Canonical note: **Conjunctions** (as block data)

`note-eng-g7-conjunctions` — authored from the prescribed textbook. This is the reference every English note copies.

```json
{
  "id": "note-eng-g7-conjunctions",
  "topicId": "eng-g7-conjunctions",
  "title": "Conjunctions — the joining words 🔗",
  "readMins": 7,
  "sources": ["G7 English textbook pp. (Structure: Conjunctions)"],
  "blocks": [
    { "type": "para",
      "text": "A [[kw:conjunction]] is a **joining word**. It works like glue — it sticks two words or two sentences together to make one longer, smoother sentence." },
    { "type": "para",
      "text": "The joining words you will use most are [[kw:and]], [[kw:but]], [[kw:because]], [[kw:so]] and [[kw:although]]." },
    { "type": "tip", "variant": "trick",
      "text": "Zed's trick: if your sentence answers **WHY**, use *because*. If the two ideas fight each other, use *but* or *although*." },

    { "type": "heading", "num": 1, "text": "Coordinating — joining equals" },
    { "type": "keypoints",
      "html": "<b>and</b> adds · <b>but</b> contrast · <b>or</b> choice · <b>so</b> result · <b>yet</b> surprise. Both sides are <b>equal</b>." },
    { "type": "para",
      "text": "These join words or sentences of **equal importance** — two ideas that could each stand on their own." },
    { "type": "example",
      "html": "Mutale went to the market. + She bought tomatoes.<br>→ Mutale went to the market <u>and</u> bought tomatoes. ✨" },
    { "type": "reveal",
      "prompt": "Bwalya was tired. He kept on studying. Which joining word fits best?",
      "answer": "Bwalya was tired <u>but</u> he kept on studying.",
      "note": "The two ideas fight each other — so we use *but*." },
    { "type": "tryit",
      "prompt": "I like mangoes …… I do not like lemons.",
      "options": [ {"label":"but","correct":true}, {"label":"because","correct":false}, {"label":"so","correct":false} ],
      "feedback": { "correct": "The two ideas pull against each other." } },
    { "type": "sectionCheck",
      "prompt": "It started raining, …… we ran inside.",
      "options": [ {"label":"or","correct":false}, {"label":"so","correct":true}, {"label":"yet","correct":false} ],
      "remediation": {
        "explain": "**so** shows a result. The rain is the reason — running inside is what happened because of it.",
        "examples": "I was hungry, <u>so</u> I ate my nshima.<br>The sun was hot, <u>so</u> we sat under the mango tree.",
        "retry": { "prompt": "The test was easy, …… everyone passed.",
          "options": [ {"label":"yet","correct":false}, {"label":"so","correct":true}, {"label":"or","correct":false} ] } } },

    { "type": "heading", "num": 2, "text": "Subordinating — one idea depends on the other" },
    { "type": "keypoints",
      "html": "Join a <b>main clause</b> to a <b>dependent clause</b>. <b>because</b>=why · <b>if/unless</b>=condition · <b>when/while/before/after/since</b>=time · <b>although</b>=surprise." },
    { "type": "para",
      "text": "These join a **main clause** to a **dependent clause** — one part leans on the other, telling us **why**, **when** or **on what condition**." },
    { "type": "para",
      "text": "[[kw:because]] [[kw:although]] [[kw:if]] [[kw:when]] [[kw:while]] [[kw:before]] [[kw:after]] [[kw:since]] [[kw:unless]]" },
    { "type": "example",
      "html": "Chipo stayed at home <u>because</u> she was sick.<br><u>Although</u> it was raining, we continued playing.<br>Wash your hands <u>before</u> you eat." },
    { "type": "tryit",
      "prompt": "Zacheus climbed a tree …… he was short.",
      "options": [ {"label":"and","correct":false}, {"label":"because","correct":true}, {"label":"but","correct":false} ],
      "feedback": { "correct": "because tells us WHY he climbed." } },
    { "type": "tryit",
      "prompt": "The learners became quiet …… the teacher entered.",
      "options": [ {"label":"when","correct":true}, {"label":"or","correct":false}, {"label":"yet","correct":false} ],
      "feedback": { "correct": "when tells us the TIME it happened." } },
    { "type": "sectionCheck",
      "prompt": "…… you study hard, you will pass the exam.",
      "options": [ {"label":"But","correct":false}, {"label":"If","correct":true}, {"label":"So","correct":false} ],
      "remediation": {
        "explain": "**if** sets a condition — passing depends on studying.",
        "examples": "<u>If</u> you water the plant, it will grow.<br>You will be late <u>unless</u> you hurry. (unless = if you do not)",
        "retry": { "prompt": "You will miss the bus …… you run.",
          "options": [ {"label":"unless","correct":true}, {"label":"although","correct":false}, {"label":"when","correct":false} ] } } },

    { "type": "heading", "num": 3, "text": "Conjunction pairs — words that work as a team" },
    { "type": "keypoints",
      "html": "<b>either … or</b> · <b>neither … nor</b> · <b>both … and</b> · <b>not only … but also</b>. Pairs always travel together." },
    { "type": "para",
      "text": "Some conjunctions are always used **in pairs**. If you see the first, its partner must follow!" },
    { "type": "para",
      "text": "[[kw:either … or]] [[kw:neither … nor]] [[kw:both … and]] [[kw:not only … but also]]" },
    { "type": "example",
      "html": "<u>Both</u> Chanda <u>and</u> Mutale passed the test.<br><u>Not only</u> did it rain, <u>but</u> it <u>also</u> hailed." },
    { "type": "tryit",
      "prompt": "Neither Bwalya …… Chipo was late for class.",
      "options": [ {"label":"nor","correct":true}, {"label":"or","correct":false}, {"label":"and","correct":false} ],
      "feedback": { "correct": "neither always brings its partner nor." } },
    { "type": "sectionCheck",
      "prompt": "…… only did Mwansa sing, but she also danced.",
      "options": [ {"label":"Both","correct":false}, {"label":"Not","correct":true}, {"label":"Either","correct":false} ],
      "remediation": {
        "explain": "The pair is **not only … but also**. When you see *but also* later, its partner *not only* must come first.",
        "examples": "<u>Not only</u> is Zed clever, <u>but</u> he is <u>also</u> friendly.<br><u>Either</u> you come now, <u>or</u> we leave.",
        "retry": { "prompt": "…… Chanda or Taonga will bring the ball.",
          "options": [ {"label":"Neither","correct":false}, {"label":"Either","correct":true}, {"label":"Both","correct":false} ] } } },

    { "type": "tip", "variant": "alert",
      "text": "**Exam alert!** Conjunction questions appear in **every** Grade 7 English paper (Part 1). Master these and those marks are yours." },
    { "type": "topicQuiz", "quizId": "quiz-eng-g7-conjunctions" }
  ]
}
```

---

## Part D — Quiz, section checks & word cards

### Topic quiz (`quiz-eng-g7-conjunctions`)
MCQ options render **vertically with A–D letter badges** (ECZ past-paper style). One question object:
```json
{
  "id": "quiz-eng-g7-conjunctions",
  "topicId": "eng-g7-conjunctions",
  "examPart": "P1",
  "questions": [
    { "q": "Chanda was hungry, …… she cooked nshima.", "help": "Reason → result.",
      "options": ["so","yet","or","and"], "answer": 0, "topic": "Conjunctions" },
    { "q": "…… it was cold, we swam in the river.", "help": "A surprising contrast.",
      "options": ["Because","Although","If","So"], "answer": 1, "topic": "Conjunctions" },
    { "q": "You will pass …… you practise every day.", "help": "A condition.",
      "options": ["but","nor","if","and"], "answer": 2, "topic": "Conjunctions" },
    { "q": "Neither Mutale …… Bwalya came to class.", "help": "Pairs travel together.",
      "options": ["nor","or","and","but"], "answer": 0, "topic": "Conjunctions" },
    { "q": "I wanted to play, …… it started to rain.", "help": "Two ideas that fight each other.",
      "options": ["and","but","so","or"], "answer": 1, "topic": "Conjunctions" }
  ]
}
```
The `topic` tag on each question is what powers **results advice** ("Topics to improve: Conjunctions") and lets weak topics feed back into games.

### Word Bank cards used by this note (`wordbank/english/*`)
Each keyword `[[kw:x]]` resolves to a card. Authored once; reused everywhere.
```json
[
  { "w": "so", "meaning": "Shows a result ➡️",
    "how": "First part is the reason; what comes after 'so' is the result. Careful: because gives the reason, so gives the result.",
    "examples": "It was hot, <u>so</u> we opened the windows.<br>Bwalya studied hard, <u>so</u> he passed." },
  { "w": "because", "meaning": "Gives the reason — WHY 🎯",
    "how": "Use it when the second part explains why the first happened.",
    "examples": "Chipo stayed home <u>because</u> she was sick." },
  { "w": "although", "meaning": "A surprise between two ideas 🎭",
    "how": "The second part is surprising after the first. It can start the sentence — then add a comma.",
    "examples": "<u>Although</u> it was raining, we played." },
  { "w": "unless", "meaning": "Means 'if you do not' 🚫",
    "how": "A negative condition — happens except when the second is done.",
    "examples": "You will miss the bus <u>unless</u> you hurry." },
  { "w": "neither … nor", "meaning": "A negative pair 🚫",
    "how": "neither = not one; nor brings the second not. Never pair neither with or!",
    "examples": "<u>Neither</u> Bwalya <u>nor</u> Chipo was late." }
]
```
*(Full note also authors cards for: and, but, or, yet, if, when, while, before, after, since, either … or, both … and, not only … but also.)*

---

## Part E — Authoring rules (the recipe the AI follows)

Given a topic's **syllabus outcomes** + **prescribed-textbook pages** + **relevant past-paper questions**, generate the note as blocks in this order and obey these rules:

1. **Textbook is the source of truth.** Every fact and every term comes from the prescribed book. If general knowledge disagrees, use the book (e.g. "small intestine = 2 parts" if the book says so). Never invent facts.
2. **Rhythm = Learn → See → Try → Check.** Never more than ~2 `para` blocks before a `tip`, `example`, `tryit` or `sectionCheck`.
3. **Every section ends in a `sectionCheck` with `remediation`** — a re-explanation, 2 fresh examples, and a *different* retry question. Remediation targets the exact confusion (e.g. so vs because).
4. **Every section has a `keypoints` block** — the compact summary shown in Revise mode and used for the Word Bank / offline card.
5. **Mark key terms as `[[kw:...]]`** and author each as a Word Bank card (meaning + how-to-use + 2–3 examples + common mistake). Author once per subject.
6. **Use Zambian names & settings** in examples (Mutale, Chipo, nshima, the market) — familiarity is half of readability.
7. **Add an `alert` tip** linking the topic to its exam part ("appears in every paper, Part 1").
8. **Every note ends with a `topicQuiz`** whose questions are **topic-tagged**, drawn from / styled like the mapped past-paper part, options vertical A–D.
9. **Reading level:** short sentences, concrete words, Grade 7 vocabulary. Long definitions become `keypoints` tables, not paragraphs.
10. **Output = validated block JSON.** A teacher reviews and approves (`status: in-review → published`) before it ships. Nothing auto-publishes.

**Pipeline per topic:** `syllabus outcomes + textbook pages + past papers` → AI drafts block JSON (this shape) → teacher review/edit → publish. Repeat for all 21 English topics, then every subject × grade.

---

*This document is the reference for one subject (Grade 7 English). The companion deliverables are: the AI generation spec (the block recipe in full), the per-subject content intake template (what to collect), and the learner-side app build spec (screens, data model, engines).*
