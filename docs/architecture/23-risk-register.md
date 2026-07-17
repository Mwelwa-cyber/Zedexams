# 23 — Risk Register

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.
> Severity = worst-case impact; Probability = likelihood of occurrence/exploitation given current code. Priority is severity×probability adjusted for blast radius.

| ID | Title | Sev | Prob | Impact | Evidence | Affected | Immediate mitigation | Long-term fix | Tests | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| RISK-1 | **Curriculum data divergence** (4 vocabularies, 13 drifted server allowlists, shared KB seed) | High | High | Wrong-grade/subject content generated; "unsupported subject" errors that vary by studio; 2023 gen grounded on 2013 data | [`06`](./06-curriculum-architecture.md) §D/§E | all studios, AI grounding | Extract 13 server `ALLOWED_*` into `assessmentAllowlists.js` | Canonical curriculum module (curriculum.js + teacherTaxonomy.js), G-code wire vocab | `test:curriculum-canon` (new) | **P0** |
| RISK-2 | **Learner premium content readable without paywall** | High | High | Free/expired users read premium quizzes + answers + lessons directly from Firestore | [`14`](./14-payment-and-subscriptions.md) PAY-1; `firestore.rules` 489–534, 593–596 | learner content, revenue | Move premium content behind a CF delivery (like daily exams) or a rules premium check | Server-gated content service | rules-emulator denial test | **P0** |
| RISK-3 | **Suspension not enforced in rules** | High | Med | Suspended user keeps backend access ~1h (token not checked for revocation) | [`10`](./10-authentication-and-roles.md) AUTH-H1 | admin moderation, abuse | Gate sensitive rules on `status=='active'` | `checkRevoked` on HTTP endpoints + status in rules | rules-emulator | **P0** |
| RISK-4 | **Client-side Gemini bypasses AI budget/quota/cost** | High | Med | Uncapped AI spend + no cost visibility; abuse vector while App Check observe-only | [`09`](./09-ai-architecture.md) AI-1 | AI budget, treasury | Route client Gemini via a CF, or disable until App Check enforced | Server AI gateway for all providers | attribution test | **P1** |
| RISK-5 | **App Check / reCAPTCHA fail-open** | Med | High | Anti-bot/scraping on paid AI + auth is advisory only | AUTH-M3 | AI endpoints, auth | Complete staged enforcement rollout | Enforce App Check + raise reCAPTCHA threshold | appcheck tests | **P1** |
| RISK-6 | **Draft loss on unmigrated surfaces** (CreateQuizV2, EditQuizV2, learner exam device-switch) | Med | Med | Teacher/learner work lost on refresh/crash/device-switch | [`15`](./15-drafts-and-autosave.md) DRAFT-1/2/4 | quiz authoring, exams | Add `beforeunload` guards | Migrate onto `draftCore` universal manager | recovery specs | **P1** |
| RISK-7 | **Parent signup role mismatch** | Med | Med (if live) | Parent `setDoc` permission-denied → broken signup | AUTH-M2 | parent onboarding | Verify path; align create rule or client role | Single role-assignment contract | rules test | **P1** |
| RISK-8 | **Firestore hotspots / unbounded collections** | Med | Med | Contention on `classes.learners[]`, `agentControl.recentFailures`; unbounded `scores`/`notifications feed`; leaderboard read load | [`11`](./11-firestore-data-model.md) FS-4 | classes, agents, gamification | Add pagination + TTLs; shard hot docs | Membership subcollection; counter shards | load tests | **P2** |
| RISK-9 | **Storage orphans / no cleanup** (`note-pictures/`, `slide-notes-images/`, visual-studio on user delete) | Med | High | Unbounded storage growth, cost creep | [`12`](./12-storage-map.md) STO-1/2 | storage cost | Add prefixes to `USER_KEYED_PREFIXES` + reaper | Rules match + cascade cleanup for all image prefixes | reaper tests | **P2** |
| RISK-10 | **Denormalization drift** (quizSummaries, pastPapersIndex, users subscription mirror, dangling assignment ids) | Med | Med | Stale/incorrect derived data on trigger misfire | FS-3 | search, papers, subscription UI | Reconciliation crons/audits | Single-writer + verified projections | mirror tests | **P2** |
| RISK-11 | **assessmentToPdf print-only / export CORS fragility** | Med | Med | Diagrams missing from downloads; no real PDF file for assessments | [`16`](./16-document-generation.md) DOC-1 | teacher exports | Keep DOCX as primary; ensure `storage:cors` applied | Migrate assessmentToPdf onto `htmlToPdf` | export tests | **P2** |
| RISK-12 | **Duplicate grade/subject/role sources** | Med | High | Edits applied in one copy, not others → silent inconsistency | [`21`](./21-duplication-register.md) D1/D2/D3 | studios, dropdowns | Consolidate high-value clusters first | Canonical config + guard tests | canon guard | **P2** |
| RISK-13 | **Custom claim `role` never re-synced** | Low | Med | Promoted admin denied claim-based paths | AUTH-M4 | admin ops | Re-mint claim on role change | Single source (Firestore role) everywhere | — | P3 |
| RISK-14 | **agentControl world-readable** | Low | Low | Breaker/autoPublish state visible to any verified user | FS-2 | agents ops | Restrict read to admin | Per-collection ownership | rules test | P3 |
| RISK-15 | **No HTTP retry on OpenAI/Gemini** | Low | Med | 429 fails a generation immediately | AI-4 | AI availability | Add retry wrapper | Shared retry in AI gateway | — | P3 |
| RISK-16 | **Legacy collections/indexes carried** | Low | Low | Index maintenance cost, collision risk, confusion | [`22`](./22-dead-code-register.md) R7 | ops | Drop after writer-confirmation | Prune indexes/rules | — | P3 |
| RISK-17 | **Android lifecycle / no native tests + no App Links** | Low | Med | Deep-link/back-button/native-auth regressions ship unseen | [`17`](./17-android-capacitor.md) AND-1/2 | Android | Manual release smoke | Instrumented tests + App Links | Espresso smoke | P3 |
| RISK-18 | **Play revenue counted at list price in treasury** | Low | Low | AI budget ceiling slightly over-stated | PAY-3 | budgeting | Note in dashboard | Use Google net revenue | — | P3 |

## Priority buckets

- **P0 (do first):** RISK-1 (curriculum divergence), RISK-2 (content paywall), RISK-3 (suspension). These are correctness/authorization boundaries with high probability.
- **P1:** RISK-4/5 (AI budget + App Check enforcement), RISK-6 (draft loss), RISK-7 (parent signup).
- **P2:** RISK-8/9/10/11/12 (hotspots, storage cleanup, drift, exports, duplication).
- **P3:** RISK-13–18 (latent inconsistencies, ops hygiene).

Cross-reference: security detail in [`18`](./18-security-review.md); what to centralise in [`24`](./24-recommended-target-architecture.md).
