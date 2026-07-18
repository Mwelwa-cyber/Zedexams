# AI Response Validation (Prompt 14 — Phase 1 core)

Shared, deterministic building blocks that stop a raw AI response from being
trusted, saved, published, exported, or charged as successful before it passes
validation. Everything here is **pure** (no `firebase-admin` /
`firebase-functions` imports) so each module runs under plain `node` and is unit
tested — `npm run test:ai-validation`.

This is the **Phase 1 core infrastructure** from the prompt's rollout order
(shared parser, shared validation-result format, schema/version registry, safe
provenance). It is wired into the highest-cost operation (`generateAssessment`)
as the reference integration; the remaining operations adopt it incrementally by
following that pattern.

## Modules

| File | Responsibility | Spec §§ |
|------|----------------|---------|
| `validationResult.js` | The one issue/severity/acceptance-state vocabulary. `issue()`, `deriveAcceptanceState()`, `buildReport()`. Only `validated` / `validated_with_warnings` are saveable. | §6, §27, §31 |
| `responseParser.js` | Hardened parse: fence-strip, prose-trim, **explicit truncation detection** (stop-reason, bracket balance, declared-count shortfall), refusal detection, size guard, opt-in controlled recovery that never trusts silently. Returns a structured result, never throws. | §5, §10, §26 |
| `operationRegistry.js` | The AI-operation inventory + response contracts, and `buildProvenance()` for the prompt/schema/validator/catalogue version quadruple. | §2, §35 |
| `curriculumGuard.js` | Deterministic curriculum-context validation: framework echo mismatch, CBC↔2013/OBC field contamination, grade + subject mismatch. Fail-open on omission, fail-closed on contradiction. | §7, §8, §9 |

## Acceptance-state contract (§31)

```
raw → parsing → parsed → validating → repairing →
  validated | validated_with_warnings   ← the only two that may be saved as a draft
  requires_review                        ← quarantined for a human
  rejected | failed                      ← never surfaced as a successful generation
```

`deriveAcceptanceState()` is the single place that maps a set of validation
issues to a terminal state, so no caller re-implements "does this have a
blocking issue?" ad hoc. A `critical` issue → `rejected`; a repairable `error`
→ `requires_review` (only when repair is allowed) else `rejected`; warnings only
→ `validated_with_warnings`; nothing → `validated`.

## Reference integration — `generateAssessment`

`functions/teacherTools/generateAssessment.js` now:

1. stamps a **`provenance`** block (from `buildProvenance`) and an
   **`acceptanceStatus`** field on the `aiGenerations` doc — both server-managed,
   never client-writable;
2. runs **`validateCurriculumContext`** on the validated paper against the
   teacher's selected `{framework, grade, subject}`. A response that echoes the
   wrong grade/subject/framework (or leaks a framework-incompatible field) is
   **flagged for review** with `acceptanceStatus: "rejected"` — it is never
   saved as a clean `complete` paper, even when it passes the shape validator;
3. records the guard's issues as `curriculumIssues` for observability.

Usage is still charged exactly once per logical request (via the existing
`aiOperations` idempotency reservation), a flagged/guard-rejected paper is a
completion-for-billing not a failure (no retry, no double charge), and a hard
provider failure still refunds — unchanged behaviour, now with an honest
acceptance state attached.

## Adding a new validator / operation

1. Add the operation to `OPERATIONS` in `operationRegistry.js` (the test asserts
   the shape, so a malformed entry fails CI).
2. Parse with `parseAiJsonResponse(...)` — pass `parsed` for tool/structured
   output, `raw` + `stopReason` for text, and `declaredCount` + `countItems`
   when the model states how many items it produced.
3. Run the operation's schema validator, then `validateCurriculumContext(...)`
   for curriculum-bearing content.
4. Fold every issue through `deriveAcceptanceState(...)` and persist only when
   `isSaveable(state)`.
5. Stamp `buildProvenance(operation, {model, promptVersion, curriculumVersion})`.
