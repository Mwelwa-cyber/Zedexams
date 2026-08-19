# Learner-side design pack

> Snapshot as of 2026-08-19 — verify before acting. The prototype iterates by
> upload; a newer revision from the owner supersedes the file committed here.

The owner's design pack for the learner-experience rebuild (PROMPT 0.A of the
build prompts). The specs are committed **verbatim as shipped**:

| File | What it is |
|---|---|
| `ZedExams_Learner_App_Build_Spec.md` | How the learner app renders and runs the content |
| `ZedExams_AI_Generation_Spec.md` | How note/quiz content is generated (block JSON vocabulary) |
| `ZedExams_Content_Intake_Template.md` | The intake shape content authors fill in |
| `ZedExams_Grade7_English_Reference.md` | Worked Grade 7 English example of the above |
| `zedexams-learner-prototype.html` | The working visual + interaction reference — see below |
| `ZedExams_ClaudeCode_Prompts.md` | The build playbook itself — the ordered prompts the rebuild is run from |
| `zedexams-parent-prototype.html` | The parent app's visual + interaction reference (PROMPT 8g) |
| `zedexams-age-screen-mockup.html` | The age / date-of-birth screen at `/register?step=age` (PROMPT 0c-2) |
| `zedexams-guardian-email-mockup.html` | The four screens of the grown-up's contact step, after the age gate (PROMPT 0c-3) |
| `zedexams-spelling-game.html` | The spelling game, playable (PROMPT 7a) — see below |
| `zedexams-spelling-stages.html` | The spelling stage ladder, mastery and tricky-word pool (PROMPT 7a-2) |
| `zedexams-spelling-coach.html` | The "break it up" coach shown after a missed word (PROMPT 7a-3) |
| `zedexams-maths-game.html` | The maths game, playable (PROMPT 7c) — see below |
| `zedexams-maths-notation.html` | Fractions written the school way, and the one marking rule (PROMPT 7d) |
| `zedexams-fraction-levels.html` | The nine fraction levels and their sub-steps (PROMPT 7e) |
| `zedexams-fractions-level1.html` | Level 1 — pictures before symbols (PROMPT 7e-1) |

The playbook was landed later than the four specs, and carries its own
snapshot header for a reason worth repeating here: it is a PLAN, not a record.
Much of it has already shipped (`git log --oneline --grep "Learner redesign"`),
so reading it as a to-do list re-opens closed work. Two revisions of it exist;
the committed one is the superset — the only one describing the parent app's
activity timeline and co-guardian sharing.

## Which prototype this is

The pack's zip shipped a prototype dated 2026-08-01, but the owner has iterated
the prototype continuously since (v3 → v26, uploaded per step). **The file
committed here is v26** — the newest superset at commit time (it adds the
progress, study-plan, help, plans, skeleton and error views the pack's copy
predates) — because "the working reference" must mean the current design, not
an older build. v13 remains the deepest reference for note-reader *content*
(the fully worked Digestive System note); its blocks are already seeded in
`src/features/notes/seed/grade7Seed.json`.

## The seven playable prototypes

The three spelling files and the four maths files below are, unlike the files
above, **not committed verbatim** — the owner's mockups are the visual
reference, and each of these implements the rules its prompt states on top of
that design. They are working prototypes rather than
screens: every rule that can be demonstrated is driven by real code, so a
reviewer can find out whether a rule holds by using it rather than by reading
about it.

Each carries a prototype CONTROL STRIP above the phone — a grade picker, a
learner switch, a schema saboteur, a chapter lock, a "this question asks for
lowest terms" switch. That strip is not part of the app. It
exists because several of these rules only show themselves across states one
screenshot cannot hold: decoys scaling from Grade 4 to Grade 9, two learners
getting different words for the same stage number, a validator that has to be
seen failing to be worth anything.

What each one actually runs, rather than describes:

- **`zedexams-spelling-game.html`** — decoy count scales by grade; every touch
  target measures 44px+; a miss requeues the word three positions later inside
  the same round; the tricky-word pool and the per-word attempt log persist in
  `localStorage` across a reload; the British-spelling check runs over the word
  list on load; and **Simulate no audio** exercises the fallback (the word
  flashes for two seconds, then hides) so a round never blocks on a missing
  voice. No clock, anywhere.
- **`zedexams-spelling-stages.html`** — `composeStage(bank, pool, stage, grade,
  salt)` is a real pure function, so switching learner genuinely produces a
  different eight words for the same stage number and a replay genuinely
  reshuffles. Mastery needs three corrects in three separate sessions; missed
  words return on a 2 → 5 → 11 stage spacing and are excluded from the "new
  word" draw so their spacing cannot be bypassed; the gold Tricky-words node
  appears at 10+ pooled words; a replay may raise stars and never lowers them;
  and two failed attempts open a shorter round that lets the learner through.
  The dark panel on the map is the **content-gap report** the prompt asks for —
  it prints what the bank actually holds per grade against what ~100 stages a
  grade would need, because the constraint here is content, not code.
- **`zedexams-spelling-coach.html`** — all five cut strategies plus the
  younger-band onset–rime variant, switchable; `validateWord()` enforces
  `chunks.join('') === word` and can be made to fail from the strip; words with
  no `hook` render with no empty gold box; the rebuild rejects out-of-order
  picks without taking anything away; and the skip path still hands the word to
  the pool.
- **`zedexams-maths-game.html`** — `markMaths()` is the one marking function:
  a listed wrong answer returns its own named misconception, an unlisted one is
  written to `localStorage` with a running count and printed in the review
  queue below the phones, a decimal answer is accepted within its question's
  stated tolerance, and an equivalent form (`180/1` for `180`) passes wherever
  the question is not *about* the form. The working reveals one step at a time
  and then re-asks the same question with the steps gone. `chapterState()`
  gates on the prerequisite list, so picking a locked chapter in the rig
  refuses to start the round and names what opens it. **Exam style** builds its
  A–D options out of the same `traps` map, so the distractors are the
  misconceptions. Nothing in the file calls `setInterval`, `setTimeout` or
  `Date.now` — the no-clock rule is structural, not a setting.
- **`zedexams-maths-notation.html`** — every fraction on both phones comes out
  of one `Frac()`/`Mixed()` pair, sized in `em` so it scales with its sentence,
  with the digits `aria-hidden` and the words as the accessible name (the
  read-aloud button speaks *that* string, so the screen reader and the paid
  voice cannot drift). `markFractionAnswer()` is the single comparison
  function: `2/4` is correct for `1/2` **with** a simplification line, wrong
  only when the question asks for lowest terms; improper and mixed are
  interchangeable unless one is asked for; a decimal is refused unless the
  question allows it. The dark panel is a migration scan that converts only
  unambiguous fractions and hands dates, `km/h`, `and/or`, ratios and scores to
  a human.
- **`zedexams-fraction-levels.html`** — the nine levels are data
  (`{id, order, name, blurb, exampleExpr, prereq[], subSteps[]}`) and nothing in
  the engine is fraction-specific. **No level is skippable**: one opens when
  the level *before* it is passed AND every level it names in `prereq[]` is.
  The sequence is what stops a learner jumping ahead; the declared list is what
  lets a lock say *why* rather than only "it is next" — level 4 cites equal
  fractions, level 7 cites multiplying, level 9 cites all four operations —
  and blockers are named earliest-first, so the lock points at the next thing
  to do rather than the furthest. Seventeen self-checks run on every render and
  are printed, among them one that passes **every other level** and confirms
  each one still refuses to open without its own predecessor. Stars are never
  consulted. `composeStage()` mixes the learner's own due misses into each
  stage, capped at half of it, and switching learner in the rig genuinely
  changes both halves.
- **`zedexams-fractions-level1.html`** — nine acceptance rules run against the
  round data and are printed: no fraction symbol in any stem, caption or option
  (it appears only in the feedback after a correct answer), all four question
  types present in order, two of the three equal-parts oranges cut into
  *unequal* pieces, one half drawn on three different shapes, every wrong
  answer carrying its own explanation with none shared, no "numerator" or
  "denominator" anywhere, and the longest sentence in the level measured
  against a Grade 4 bar. Every drawing is SVG. The rig's **plain worksheet
  shapes** setting renders the version the prompt argues against, so the
  argument can be looked at rather than only read.

## Ground rules the prompts repeat (binding for every learner-side change)

- Night mode via design tokens only — never hardcode a colour.
- Every ranked or awarded score is computed server-side.
- Every counter is a Firestore transaction / `increment` — never read-modify-write.
- Grade taxonomy comes only from `src/config/educationLevels.js`.
- Content auto-filters to the learner's profile grade — no grade browsing on the child UI.
- No child-to-child communication anywhere.
- Nothing auto-publishes — approval gates all content.
- Prototypes are authoritative for what they encode (layout, interaction);
  behaviour they don't encode — pricing, entitlements, data — comes from the
  app's own registries (`src/config/plans.js`, `src/services/entitlements/`),
  and nothing is shown to a learner that the app does not actually measure.

## Where the age-screen mockup does NOT win

`zedexams-age-screen-mockup.html` is authoritative for the age screen's layout
and interaction — three numeric fields that auto-advance, the age echoed back
before Continue enables, the "I'm not sure of my birthday" panel. Three things
in it are deliberately NOT what shipped, and each is a rule from the prompt
overriding a detail the mockup could not know:

- **The guardian-email screen is not the next page.** The mockup numbers it
  "3 of 6" straight after the date. In this codebase the guardian hand-off
  comes AFTER the account exists (`signupFlowCore.stepsForRole`), so the
  learner starts practising in limited mode instead of waiting at a form for
  their parent's address. The substance the prompt asks for holds either way:
  an under-18 answer moves forward with no rejection language, no error state
  and no invitation to guess again.
- **"Ask my grown-up" hands over the DEVICE, not an email.** There is no
  account yet to attach a consent request to, so the only hand-off that
  actually resolves at this point in the flow is the one where the person who
  knows the date types it in. It always returns to a screen that can finish.
- **The "why we need something" copy is neutral.** The mockup's version says a
  learner's age decides "which lessons you get and whether we need to ask a
  grown-up first". That tells a child what a younger answer leads to, which is
  the one thing the screen must never do — so the shipped copy says only that
  we would rather ask than guess.

The step counter reads "Step 2 of 4", not "2 of 6", because it is derived from
the flow machine rather than written down — and it counts the guardian step for
every learner, so the number of screens cannot change with the answer.
