# ZedExams Architecture Documentation

> **Architecture audit date:** 2026-07-17
> **Architecture snapshot audited:** `0cd4c49f084d078738ddd74cdfd4d07d06af93a3`
>
> The original architecture audit was documentation-only and did not change
> production behaviour. P0 security remediation was subsequently implemented,
> behaviourally tested, merged through PR #1774 and deployed to production.
>
> **Independent review result:** Approved with follow-ups.

This documentation set was produced by inspecting the actual repository (routes, config, Firestore/Storage rules, Cloud Functions, exporters, payments, AI, Android). Every claim cites files; inferred/unverifiable items are labelled. The "no production behaviour was changed" statement applies **only** to the original documentation-only audit (docs 01–24); the later P0 remediation (doc 25) deliberately changed backend security rules and functions and was deployed — see the timeline below.

## Documentation status

| Item | Reference |
|---|---|
| Architecture audit date | 2026-07-17 |
| Architecture snapshot audited | `0cd4c49f084d078738ddd74cdfd4d07d06af93a3` |
| Security remediation PR | `#1774` |
| Remediation head commit | `63e796ac4fcbb57e9d3e0cbaab556637d3edb071` |
| Merge commit | `7b0ad2fb90089d61cbb2670c6e975db91e7e0655` |
| Production deployment | Confirmed 2026-07-17 (Deploy Firebase workflow run `29571690692`: Firestore rules, Storage rules, indexes and affected Cloud Functions released to project `examsprepzambia`) |
| Independent review | Approved with follow-ups |
| Web payment provider | Lenco |
| Android payment provider | Google Play Billing |

## Architecture documentation timeline

1. **2026-07-17 — Architecture audit** — snapshot `0cd4c49`; documentation-only (docs 01–24); no production changes.
2. **2026-07-17 — P0 remediation** — PR #1774, head `63e796a`, merge `7b0ad2f`; Firestore rules, Storage rules and backend authorization (`functions/authGuard.js`) corrections; added doc 25.
3. **2026-07-17 — Production deployment** — updated Firestore + Storage rules and the affected Cloud Functions released (project `examsprepzambia`).
4. **Independent review** — result: **Approved with follow-ups**. Residual items: payment-initiation fail-open; previously issued Firebase Storage download tokens.

## Platform summary

ZedExams (zedexams.com, Firebase project `examsprepzambia`) is a **Zambian curriculum-aligned learning platform supporting CBC, OBC/2013 curriculum structures and transitional grade configurations** (e.g. the Grade 7 phase-out), for learners, teachers, admins and parents. It is a **React 19 + Vite SPA** on **Firebase Hosting**, backed by **Firebase** (Auth, Firestore in `africa-south1`, Storage, Cloud Functions v2 on Node 22, App Check), wrapped for **Android via Capacitor**. AI runs on **Anthropic Claude** (generators + quiz verify), **OpenAI** (Zed chat, marking, embeddings, `gpt-image-1`) and **Gemini / Firebase AI Logic** (client helpers). Payments run through **Lenco** (ZMW mobile money, web) and **Google Play Billing** (Android). An internal "AI company" of agents runs the content pipeline and ops on schedules.

## Technology stack

| Layer | Tech |
|---|---|
| Frontend | React 19.2, Vite, react-router-dom 7, Tailwind, TipTap 3, Zod 4, PostHog, Sentry, i18next |
| Exports | `docx` 9, `jspdf` 4 + `html2canvas`, `jszip` (OOXML), `pdfjs-dist` 6 |
| Backend | Cloud Functions v2, Node 22, firebase-admin 13, firebase-functions 7, pdfkit, mammoth, exceljs, nodemailer, google-auth-library |
| Mobile | Capacitor 8, `@capacitor-firebase/*`, `@capgo/native-purchases` |
| Data | Firestore (`africa-south1`), Firebase Storage, Firebase Auth |
| AI (configured/referenced models at the audited snapshot; overridable per-runtime via env vars — see [`09`](./09-ai-architecture.md)) | Anthropic (Sonnet 4.5/4.6, Haiku 4.5), OpenAI (gpt-4o-mini, gpt-image-1, text-embedding-3-small), Gemini 2.5 Flash |

> Note: CLAUDE.md prose says "React 18 / router v6"; the installed versions are **React 19.2 / router v7** ([`02`](./02-repository-map.md)).

## Document index

| # | Document | Covers |
|---|---|---|
| 00 | **README** (this file) | Navigation, summary, update rules |
| 01 | [System Overview](./01-system-overview.md) | Platform diagram, region topology, comms contracts |
| 02 | [Repository Map](./02-repository-map.md) | Directory layout, two package.json, stack versions |
| 03 | [Route Register](./03-route-register.md) | Every route, guard, layout, legacy/duplicate routes |
| 04 | [Frontend Architecture](./04-frontend-architecture.md) | Providers, routing, build, SW, bundling |
| 05 | [Component Dependencies](./05-component-dependencies.md) | Per-feature dependency maps, shared blocks |
| 06 | [Curriculum Architecture](./06-curriculum-architecture.md) | **The most fragmented area** — 4 vocabularies, drift, canon recommendation |
| 07 | [Teaching Profile](./07-teaching-profile.md) | Profile/assignments, active-assignment sync, studio seeding |
| 08 | [Studio Flows](./08-studio-flows.md) | Shared framework + per-studio generation flows |
| 09 | [AI Architecture](./09-ai-architecture.md) | Providers/models, budget gate, treasury, caps, gaps |
| 10 | [Authentication & Roles](./10-authentication-and-roles.md) | Auth flows, guards, backend authz, security findings |
| 11 | [Firestore Data Model](./11-firestore-data-model.md) | ≈110 referenced collection paths (at the audited snapshot), rules, indexes, hotspots, orphans |
| 12 | [Storage Map](./12-storage-map.md) | Every path, rules, cleanup triggers, orphan gaps |
| 13 | [Cloud Functions Register](./13-cloud-functions-register.md) | ≈167 exported functions (at the audited snapshot) by group, triggers, regions, secrets |
| 14 | [Payments & Subscriptions](./14-payment-and-subscriptions.md) | Lenco, Google Play, entitlements, content-gating gap |
| 15 | [Drafts & Autosave](./15-drafts-and-autosave.md) | 3 draft systems, recovery, work-loss gaps |
| 16 | [Document Generation](./16-document-generation.md) | DOCX/PDF/XLSX pipelines, CORS, mobile delivery |
| 17 | [Android & Capacitor](./17-android-capacitor.md) | Native shell, plugins, build flow, release workflows |
| 18 | [Security Review](./18-security-review.md) | Enforcement map + classified findings |
| 19 | [Testing & Coverage](./19-testing-coverage.md) | Two suites, CI jobs, coverage map, missing tests |
| 20 | [Change-Impact Register](./20-change-impact-register.md) | What breaks per shared system + file-ownership register |
| 21 | [Duplication Register](./21-duplication-register.md) | 18 duplication clusters + canonical picks |
| 22 | [Dead Code Register](./22-dead-code-register.md) | Removal candidates with evidence (nothing deleted) |
| 23 | [Risk Register](./23-risk-register.md) | Prioritised P0–P3 technical risks |
| 24 | [Target Architecture](./24-recommended-target-architecture.md) | Incremental consolidation plan (no rewrite) |
| 25 | [Remediation Plan](./25-remediation-plan.md) | P0 security fixes (merged + deployed) + P1/P2 follow-up roadmap |
| — | [Diagrams index](./diagrams/README.md) | Location of all 26 Mermaid diagrams |

> The original audit consists of documents **01–24**. Document **25** is the subsequent security-remediation and follow-up plan — it is not part of the original documentation-only audit.

> **P0 security remediation — merged and deployed 2026-07-17:**
> Premium quiz questions, protected past-paper access and suspended-account
> restrictions are now enforced through Firestore rules, Storage rules and
> `functions/authGuard.js`.
>
> Behavioural verification included 138/138 Firestore emulator tests and
> 12/12 authentication-guard tests. Storage rules passed in CI.
>
> **Lessons and notes remain free content** in the current client (not premium-gated); only quiz questions and past-paper files are the premium learner content protected here.
>
> Residual follow-ups remain for:
> - Previously issued Firebase Storage download-token URLs
> - The payment-initiation fail-open account-status path
>
> See [`25-remediation-plan.md`](./25-remediation-plan.md) and [`23-risk-register.md`](./23-risk-register.md).

## Main data stores

- **Firestore** (`africa-south1`) — ≈110 referenced collection paths at the audited snapshot (static analysis counts *referenced* paths, which may include legacy/unused ones); core: `users`, `teacherProfiles`(+`teachingAssignments`), `quizzes`(+`questions`), `results`, `exam_attempts`, `assessments`, `lessons`, `aiGenerations`, `agentJobs`, `questionBank`, `pastPapers`, `payments`, `usageMeters`, `classRegisters`, `classes`. See [`11`](./11-firestore-data-model.md).
- **Firebase Storage** (`gs://examsprepzambia.firebasestorage.app`) — papers, quiz/assessment/lesson images, visual-studio, notes, picture-bank, invoices, exports. See [`12`](./12-storage-map.md).
- **Client persistence** — IndexedDB (Firestore multi-tab + drafts), localStorage (seeds, drafts, hints).

## Main external services

Anthropic · OpenAI · Gemini/Firebase AI Logic · Lenco (payments) · Google Play Billing · Meta WhatsApp (Bonga) · SMTP email (nodemailer) · PostHog · Sentry · reCAPTCHA Enterprise / Play Integrity.

The CSP `connect-src` directive in [`firebase.json`](../../firebase.json) is the authoritative **browser-side network allowlist** (it governs connections the SPA can make). It is **not** the full backend egress list: server-side Cloud Functions may contact additional external services (Lenco, the Google Play Developer API, Anthropic/OpenAI/Gemini, SMTP, GitHub, etc.) that are not represented in the browser CSP. Treat "browser-side network allowlist" and "server-side outbound integrations" as separate registers.

## Main shared systems (change with care)

Curriculum resolver · Teaching Profile/active-assignment · Auth/role system · Draft manager · AI client (server budget gate + client wrappers) · Usage/credit system · Subscription/entitlement · Payment activation · Document exporters · Calendar/term resolver · Firestore/Storage rules. See [`20`](./20-change-impact-register.md).

## Highest-risk dependencies to change

1. **`firestore.rules` and `storage.rules`** — the primary data and file **authorization boundaries** (server-enforced).
2. **`functions/authGuard.js`** — centralized backend account-status + authentication enforcement (the P0 suspension chokepoint).
3. **`functions/subscriptionActivation.js` + subscription/entitlement configuration** — payment-derived entitlement and access; the fields `hasValidEntitlement()` reads.
4. **Curriculum configuration and taxonomy** (`config/curriculum.js`, `config/teacherTaxonomy.js`, server allowlists) — shared by pickers, studios and server validators; 4 vocabularies + drifted allowlists ([`06`](./06-curriculum-architecture.md)).
5. **`AuthContext.jsx` and role resolution** — consumed by most frontend workflows. **Not** a security boundary: frontend role/entitlement state drives application behaviour and UX only; enforcement lives in Firestore/Storage rules and Cloud Functions.
6. **AI budget gate** (`aiCostTracking.js` / `aiBudgetReservation.js`) — spend, rate and quota enforcement.
7. **`functions/index.js`** — large centralized function export surface (≈167 exports at the audited snapshot).

## Updating this documentation

**Whenever you change code, update the matching doc(s):**

| If you change… | Update |
|---|---|
| A route in `App.jsx` | [`03`](./03-route-register.md) |
| A Cloud Function export | [`13`](./13-cloud-functions-register.md) |
| A Firestore collection / rule | [`11`](./11-firestore-data-model.md), [`18`](./18-security-review.md) |
| A Storage path / rule | [`12`](./12-storage-map.md) |
| Curriculum lists / resolvers | [`06`](./06-curriculum-architecture.md), [`20`](./20-change-impact-register.md) |
| A studio / generator | [`08`](./08-studio-flows.md), [`05`](./05-component-dependencies.md) |
| Payments / plans / entitlement | [`14`](./14-payment-and-subscriptions.md) |
| Auth / roles | [`10`](./10-authentication-and-roles.md) |
| A shared system | [`20`](./20-change-impact-register.md) (impact + ownership) |

Rules of the road (per CLAUDE.md): (1) put the `> Snapshot as of YYYY-MM-DD` header on any dated doc; (2) update the commit hash and status table above when re-auditing; (3) prefer editing the relevant section over spawning a new snapshot doc; (4) keep diagrams inline (Mermaid) so they render on GitHub and stay editable next to their prose.

> **Standalone-README note:** the relative document links above (e.g. `./01-system-overview.md`, `./25-remediation-plan.md`) resolve when this README is viewed inside `docs/architecture/` in the repository. When sharing the documentation outside GitHub, export or share the complete `docs/architecture/` directory, not this README alone. (Relative links are kept deliberately so forks and branches work.)

## Validation

Match the validation to the change type — do **not** require a full `test:all` run for a one-line documentation edit.

| Change type | Minimum validation |
|---|---|
| Documentation only | Link checks, Mermaid fence checks, and the repository's documentation-integrity check (`npm run check:integrity`) |
| Firestore rules | `test:rules-text`, `test:rules-emulator` |
| Storage rules | `test:storage-rules-text`, `test:storage-rules-emulator` |
| Auth guard | `test:auth-guard` |
| Broad shared-system change | `lint`, `build`, `test:all` and relevant focused suites |

Security-critical commands (used to verify the P0 remediation):

```bash
npm run lint
npm run build
npm run test:all
npm run test:auth-guard
npm run test:rules-text
npm run test:storage-rules-text
npm run test:rules-emulator
npm run test:storage-rules-emulator
```

The Firestore and Storage **emulator suites require a compatible Java runtime** (the emulators are JVM processes). Use the repository's package scripts rather than manually re-creating emulator commands.
