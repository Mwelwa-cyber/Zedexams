# Learner-side design pack

> Snapshot as of 2026-08-17 — verify before acting. The prototype iterates by
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
| `zedexams-spelling-game.html` | The spelling game, playable (PROMPT 7a) — see below |
| `zedexams-spelling-stages.html` | The spelling stage ladder, mastery and tricky-word pool (PROMPT 7a-2) |
| `zedexams-spelling-coach.html` | The "break it up" coach shown after a missed word (PROMPT 7a-3) |

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

## The three spelling prototypes

Unlike the files above these are **not committed verbatim** — the owner's
mockups are the visual reference, and each of these implements the rules its
prompt states on top of that design. They are working prototypes rather than
screens: every rule that can be demonstrated is driven by real code, so a
reviewer can find out whether a rule holds by using it rather than by reading
about it.

Each carries a prototype CONTROL STRIP above the phone — a grade picker, a
learner switch, a schema saboteur. That strip is not part of the app. It
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
