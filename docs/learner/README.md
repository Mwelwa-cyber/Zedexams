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
