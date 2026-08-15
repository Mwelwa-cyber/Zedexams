# ZedExams

CBC-aligned learning platform for Zambian learners, teachers, and administrators. Live at **[zedexams.com](https://zedexams.com)**.

## What the platform does

- **Learners** — daily exams, subject quizzes, past-paper archive with timed practice, lesson library, notes, games with a live leaderboard, CBC-aligned progress tracking, and AI study help via Zed.
- **Teachers** — the Assessment Paper Studio (every test and examination type), plus AI generators for lesson plans, worksheets, flashcards, schemes of work, rubrics, notes, homework, and SBA tasks; a class register with attendance; a personal library. Output exports to DOCX/PDF with editor → preview → export parity.
- **Admins** — content pipeline with agent review and approvals, question bank review, learner monitoring, past-paper studio, visual/diagram studio, CBC knowledge-base editor, ops dashboards.
- **Parents** — a portal with weekly digests.

## Tech stack

- **Frontend**: React 19 + Vite 8, React Router 7, Tailwind CSS, lazy-loaded routes, TipTap rich-text editor, KaTeX for maths. PWA service worker on the web build.
- **Backend**: Firebase — Auth, Firestore (`africa-south1`), Storage, Cloud Functions v2 on Node 22. Hosting forwards `/api/*` to specific Cloud Functions per the `rewrites` block in [firebase.json](./firebase.json).
- **AI** (server-side): Anthropic Claude (Sonnet 4.5 default for generators, Haiku 4.5 for quiz verification), OpenAI for Zed chat and short-answer marking, gpt-image-1 (plus a Gemini path) for image generation, and Firebase AI Logic / Gemini for client-side helpers.
- **Payments**: Lenco (MTN, Airtel, and Zamtel mobile money plus cards, in ZMW) on the web; Google Play Billing for in-app subscriptions on Android.
- **Android**: a [Capacitor](https://capacitorjs.com) wrapper (`appId: com.zedexams.android`, native project in [`android/`](./android)).

## Repo layout (high level)

```
src/
├── app/           Route tables + route guards (teacherRoutes, StudioGate, …)
├── features/      Feature slices (pages/, components/, services/, lib/) behind public index.js front doors —
│                  quiz, quizEditor, papers, games, dailyExams, flashcards, lessons, notes, teacherShell,
│                  teacherHome, teacherSettings, assessmentStudio, visualStudio, admin*, …
├── engines/       Cross-feature engines (export-engine, …)
├── shared/        Shared components/hooks/utils/styles with no Firebase reach
├── components/    Remaining legacy tree (layout, subscription, ui) — shrinking, not growing
├── contexts/      Auth, Theme, DataSaver, PlatformSettings providers
├── editor/        TipTap-based rich-content editor shared by quiz/notes/lessons
├── schemas/       Zod schemas (quiz, attempt, result)
├── config/        curriculum.js + canonical education taxonomy
├── firebase/      SDK init (config.js) + Firebase AI Logic client (ai.js)
└── utils/         Firestore services, AI clients, exporters, payments, permissions (the catch-all bucket)

functions/         Cloud Functions v2 (separate package.json) — index.js exports, teacherTools/ generators,
                   agents/ pipeline, payments, grading, shared/ (ESM contract package shared with src/)
scripts/           Plain-node test/audit/backfill utilities (test:all auto-discovers test:* scripts)
docs/              The long-form reference set — docs/architecture.md is the binding target architecture
firestore.rules / firestore.indexes.json / storage.rules / firebase.json / capacitor.config.json
```

The layering is one-way — `app → features → engines/curriculum → shared/services/config` — enforced by ESLint plus `npm run test:import-boundaries`.

## Local development

```bash
# 1. Install dependencies (repo root AND functions)
npm install
cd functions && npm install && cd ..

# 2. Create .env from the template
cp .env.example .env
# Fill in your Firebase project values (VITE_FIREBASE_*).

# 3. Run the dev server
npm run dev
# → http://localhost:5173
```

Backend secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LENCO_API_KEY`, …) live as Firebase Functions secrets (`firebase functions:secrets:set …`), never in `.env`. Non-secret runtime config for functions lives in `functions/.env.<projectId>` — see the standing rule in [docs/architecture.md](./docs/architecture.md).

## Testing & linting

Two test suites, split by filename:

```bash
npm run lint             # flat-config ESLint over src/ + functions/
npm run test:all         # the plain-node suite (*.test.js / test-*.mjs) — what CI's "Tests" job runs
npm run test:unit        # Vitest (jsdom) over src/**/*.spec.{js,jsx}
npm run test:coverage    # Vitest + v8 coverage of src/
npm run check:integrity  # byte-level file integrity (also runs pre-commit via husky)
npm run smoke            # build + phone-sized headless-Chromium smoke over the key routes
```

The pre-commit hook runs **only** `check:integrity` against staged files — run `npm run lint` yourself before pushing.

## Deployment

**Everything ships through GitHub Actions — never run `firebase deploy --only hosting` or `--only functions` directly.** Open a PR into `main` (branch-protected, nine required checks); the merge triggers [`deploy-hosting.yml`](./.github/workflows/deploy-hosting.yml) (frontend) and, when relevant paths changed, [`deploy-firebase.yml`](./.github/workflows/deploy-firebase.yml) (Firestore rules + indexes, Storage rules, Cloud Functions). The one allowed direct deploy is `npx firebase deploy --only firestore:indexes`, so new composite indexes can land before the code that queries them.

## Android builds

```bash
npm run android:apk:debug   # vite build + cap sync + gradle assembleDebug
npm run android:run         # launch on a connected device
```

CI equivalents live in [`android-debug-apk.yml`](./.github/workflows/android-debug-apk.yml) and the release workflows (`android-release.yml`, `android-play-release.yml`). See [docs/ANDROID-RELEASE.md](./docs/ANDROID-RELEASE.md) and [docs/GOOGLE-PLAY-BILLING.md](./docs/GOOGLE-PLAY-BILLING.md) for signing, Play setup, and billing. WebView caveats (Google sign-in popups, App Check via Play Integrity) are documented in [CLAUDE.md](./CLAUDE.md).

## Other docs in this repo

- [docs/architecture.md](./docs/architecture.md) — the binding target architecture + migration contract, with the numbered reference set in [docs/architecture/](./docs/architecture)
- [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) — binding standards for AI coding sessions (enforced in CI)
- [DEPLOY.md](./DEPLOY.md) — deeper deploy playbook
- [ORG.md](./ORG.md) — the internal AI-agent org chart
- [SECURITY.md](./SECURITY.md) — security policy; [docs/security/](./docs/security) for audit records
- [BUG_REPORT.md](./BUG_REPORT.md) — curated known-issue tracker
