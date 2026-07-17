# ZedExams Architecture Documentation

> **Audit date:** 2026-07-17 · **Commit audited:** `0cd4c49f084d078738ddd74cdfd4d07d06af93a3` (branch `claude/zedexams-architecture-audit-con2lc`).
> This set was produced by inspecting the actual repository (routes, config, Firestore/Storage rules, Cloud Functions, exporters, payments, AI, Android). Every claim cites files; inferred/unverifiable items are labelled. **No production behaviour was changed.**

## Platform summary

ZedExams (zedexams.com, Firebase project `examsprepzambia`) is a CBC-aligned learning platform for Zambian learners, teachers, admins and parents. It is a **React 19 + Vite SPA** on **Firebase Hosting**, backed by **Firebase** (Auth, Firestore in `africa-south1`, Storage, Cloud Functions v2 on Node 22, App Check), wrapped for **Android via Capacitor**. AI runs on **Anthropic Claude** (generators + quiz verify), **OpenAI** (Zed chat, marking, embeddings, `gpt-image-1`) and **Gemini / Firebase AI Logic** (client helpers). Payments run through **Lenco** (ZMW mobile money, web) and **Google Play Billing** (Android). An internal "AI company" of agents runs the content pipeline and ops on schedules.

## Technology stack

| Layer | Tech |
|---|---|
| Frontend | React 19.2, Vite, react-router-dom 7, Tailwind, TipTap 3, Zod 4, PostHog, Sentry, i18next |
| Exports | `docx` 9, `jspdf` 4 + `html2canvas`, `jszip` (OOXML), `pdfjs-dist` 6 |
| Backend | Cloud Functions v2, Node 22, firebase-admin 13, firebase-functions 7, pdfkit, mammoth, exceljs, nodemailer, google-auth-library |
| Mobile | Capacitor 8, `@capacitor-firebase/*`, `@capgo/native-purchases` |
| Data | Firestore (`africa-south1`), Firebase Storage, Firebase Auth |
| AI | Anthropic (Sonnet 4.5/4.6, Haiku 4.5), OpenAI (gpt-4o-mini, gpt-image-1, text-embedding-3-small), Gemini 2.5 Flash |

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
| 11 | [Firestore Data Model](./11-firestore-data-model.md) | ~110 collections, rules, indexes, hotspots, orphans |
| 12 | [Storage Map](./12-storage-map.md) | Every path, rules, cleanup triggers, orphan gaps |
| 13 | [Cloud Functions Register](./13-cloud-functions-register.md) | ~167 functions by group, triggers, regions, secrets |
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
| 25 | [Remediation Plan](./25-remediation-plan.md) | ✅ P0 security fixes landed + P1/P2 follow-up roadmap |
| — | [Diagrams index](./diagrams/README.md) | Location of all 26 Mermaid diagrams |

> **P0 security remediation landed 2026-07-17:** premium quiz answer-keys + past-paper PDFs and suspended-account access are now enforced on the backend (Firestore/Storage rules + `functions/authGuard.js`). See [`25-remediation-plan.md`](./25-remediation-plan.md).

## Main data stores

- **Firestore** (`africa-south1`) — ~110 collections; core: `users`, `teacherProfiles`(+`teachingAssignments`), `quizzes`(+`questions`), `results`, `exam_attempts`, `assessments`, `lessons`, `aiGenerations`, `agentJobs`, `questionBank`, `pastPapers`, `payments`, `usageMeters`, `classRegisters`, `classes`. See [`11`](./11-firestore-data-model.md).
- **Firebase Storage** (`gs://examsprepzambia.firebasestorage.app`) — papers, quiz/assessment/lesson images, visual-studio, notes, picture-bank, invoices, exports. See [`12`](./12-storage-map.md).
- **Client persistence** — IndexedDB (Firestore multi-tab + drafts), localStorage (seeds, drafts, hints).

## Main external services

Anthropic · OpenAI · Gemini/Firebase AI Logic · Lenco (payments) · Google Play Billing · Meta WhatsApp (Bonga) · SMTP email (nodemailer) · PostHog · Sentry · reCAPTCHA Enterprise / Play Integrity. CSP `connect-src` in [`firebase.json`](../../firebase.json) is the authoritative egress list.

## Main shared systems (change with care)

Curriculum resolver · Teaching Profile/active-assignment · Auth/role system · Draft manager · AI client (server budget gate + client wrappers) · Usage/credit system · Subscription/entitlement · Payment activation · Document exporters · Calendar/term resolver · Firestore/Storage rules. See [`20`](./20-change-impact-register.md).

## Highest-risk dependencies to change

1. **Firestore rules** + **payment activation** — authorization + money.
2. **Curriculum config** — 4 vocabularies, drifted allowlists ([`06`](./06-curriculum-architecture.md)).
3. **AuthContext / role system** — read by nearly everything.
4. **AI client + budget gate** — spend control.
5. **`functions/index.js`** — ~167 exports in one file.

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

Rules of the road (per CLAUDE.md): (1) put the `> Snapshot as of YYYY-MM-DD` header on any dated doc; (2) update the commit hash below when re-auditing; (3) prefer editing the relevant section over spawning a new snapshot doc; (4) keep diagrams inline (Mermaid) so they render on GitHub and stay editable next to their prose.

Re-run the audit safely with: `npm run lint && npm run build`, plus the relevant `test:*` scripts and the emulator suites ([`19`](./19-testing-coverage.md)).
