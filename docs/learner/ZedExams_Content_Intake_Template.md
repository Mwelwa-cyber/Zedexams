# ZedExams — Content Intake Template

**What this is.** The checklist you fill **once per subject × grade** to collect the three inputs the generation pipeline needs, so nothing is missing when you hand a subject over. Fill it, and every topic can be generated one at a time without going back for materials.

**Rule of three.** For every topic the AI needs: **① Syllabus** (structure & outcomes) · **② Prescribed textbook** (facts & vocabulary — the source of truth) · **③ Past papers** (question style & topic weighting). Missing ② for a topic = do not generate; flag `needs-source`.

---

## 0. Subject cover sheet

```yaml
subject:            English            # english | integrated-science | mathematics | social-studies | ...
grade:              7
curriculum:         "2013 ECZ (revised)"      # exact syllabus edition
exam_board:         PRISCA / ECZ
exam_format:        "60 MCQ, 90 min, Sections A(4 parts)+B"
prescribed_books:                       # the book(s) notes are authored FROM
  - title:         "<Grade 7 English pupil's book>"
    publisher:     "..."
    edition:       "..."
    file:          "textbooks/eng-g7-<title>.pdf"     # uploaded to Notes Studio
default_language:   en-GB               # British/Zambian spelling
mascot_voice:       Zed
owner:              "<teacher/reviewer name>"
status:             collecting          # collecting | ready | in-generation | published
```

---

## 1. Term split (do this first)

Assign every syllabus topic to a term (spiral: foundations → exam-heavy). One row per topic.

| # | Topic title | Term | Strand | Syllabus ref | Exam part | Textbook pages | Past-paper Qs (ids) | Diagram needed? | Status |
|---|-------------|------|--------|--------------|-----------|----------------|---------------------|-----------------|--------|
| 1 | Conversation & Polite Requests | 1 | LS | 7.1.6/9/10 | — | pp. 3–7 | — | no | ready |
| … | … | … | … | … | … | … | … | … | … |
| 14 | Conjunctions | 2 | ST | 7.4.14 | P1 | pp. 51 | eng-2026-Q1,Q7,Q10 | no | ready |

> Keep this table as the subject's **manifest**. A topic is `ready` only when its textbook pages, exam-part mapping and (if needed) diagram asset are all filled.

---

## 2. Per-topic intake (repeat for each topic)

This is the exact object handed to the generation pipeline.

```yaml
topic:
  id:            eng-g7-conjunctions
  subject:       english
  grade:         7
  term:          2
  title:         "Conjunctions — Joining Words"
  strand:        ST                      # LS | RD | WR | ST
  syllabus_refs: ["7.4.14"]
  exam_parts:    ["P1"]                   # P1..P4 | SB
  order:         14

# ① SYLLABUS — paste verbatim (Specific Outcomes / Knowledge / Skills / Values)
syllabus_text: |
  7.4.14.1 Connect sentences using conjunctions.
  Knowledge: Therefore, Because of, As a result, since…, either…or…,
  neither…nor…, too…to…, so…, that…

# ② TEXTBOOK — paste verbatim the prescribed pages for THIS topic (source of truth)
textbook_text: |
  Conjunctions are joining words... Coordinating conjunctions join words or
  clauses of equal importance: and, but, or, so, yet...
  Subordinating conjunctions join a main clause to a dependent clause:
  because, although, if, when, while, before, after, since, unless...
  These conjunctions are used in pairs: either…or, neither…nor, both…and,
  not only…but also.
textbook_source: "eng-g7-<title>.pdf pp. 51"

# ③ PAST PAPERS — tagged questions for this topic (style + weighting)
past_papers:
  - part: P1
    stem: "I enjoyed the play …… I have seen it before."
    options: ["after","and","although","but"]
    answer: 3
    source: "PRISCA-2026 Q1"

# ASSETS — only if a block needs a diagram/image
assets:
  diagram_unlabelled: null              # required for labelDiagram blocks
  box_coordinates:    null              # [{id,x,y}] label positions
  images:             []                # {id, file, caption} for tapExplore
```

### Field notes
- **`textbook_text`** is mandatory. If the topic isn't in the prescribed book, either supply an approved supplementary source or mark the topic `blocked: no-source`.
- **`exam_parts`** drives the quiz style. If a topic maps to no exam part (e.g. Listening & Speaking), the quiz is optional/comprehension-style; note it.
- **`past_papers`** — 2–5 tagged examples per exam-linked topic is enough to set the style. Don't copy whole papers; the AI regenerates in-style.
- **Never paste** real learner data, or anything under the platform's blocked categories, into any field.

---

## 3. Diagram/asset intake (Science, Geography, Maths figures)

Only for topics whose notes use `labelDiagram` or `tapExplore`.

```yaml
diagram:
  topic_id:       sci-g7-digestive-system
  labelled_ref:   "digestive-labelled.png"     # teaching reference (shown in note)
  unlabelled:     "digestive-blank.png"         # REQUIRED for the label game
  boxes:                                        # where each label sits (% of image)
    - { id: mouth,   x: 18.7, y: 18.8 }
    - { id: stomach, x: 84.5, y: 53.0 }
    # ...
  answers:        { mouth: "Mouth", stomach: "Stomach" }   # id → correct label
  tap_items:                                     # for tapExplore organ cards
    - { label: "Stomach", image: "stomach.png",
        role: "Food mixes with gastric juices that break down proteins..." }
```

> **Key gap to close in tooling:** label activities need an **unlabelled** diagram + box coordinates. Either the diagram pipeline auto-detects boxes (as prototyped) or the teacher marks them in Notes Studio. Capture both `labelled_ref` and `unlabelled` at intake.

---

## 4. Word Bank seed (optional but recommended)

List the key terms the subject will teach so cards are authored once and shared.

```yaml
word_bank_seed:
  - so
  - because
  - although
  - conjunction
  # ... the AI will also add any [[kw:]] it introduces
```

---

## 5. Readiness gate (before handing to generation)

A subject is `ready` when, for every topic:

- [ ] Term assigned, strand + syllabus ref + exam part filled.
- [ ] `syllabus_text` pasted.
- [ ] `textbook_text` pasted (or explicitly `blocked: no-source`).
- [ ] ≥2 tagged past-paper questions for exam-linked topics.
- [ ] Diagram assets supplied where a note needs them (`unlabelled` + boxes).
- [ ] Owner/reviewer assigned.

When all topics pass → set subject `status: ready`, run generation topic-by-topic, teacher approves, publish.

---

## 6. Collection order (fastest path)

1. **Term split** (Section 1) — 1 sitting per subject.
2. **Textbook slice** — for each topic, note the page range (Section 1 column) and paste text (Section 2). This is the long pole; do it in book order.
3. **Past-paper tagging** — go through 2–3 past papers once, tagging each question to a topic + exam part. Reuse across topics.
4. **Assets** — only the science/geography/maths topics that need diagrams.
5. **Gate** (Section 5) → generate.

*Companion docs: the AI generation spec (what happens after intake), the Grade 7 English reference (a fully-collected + generated example), and the learner-side app build spec.*
