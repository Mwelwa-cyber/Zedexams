# ZedExams

CBC-aligned learning platform for Zambian learners, teachers, and administrators. Live at **[zedexams.com](https://zedexams.com)**.

## What the platform does

- **Learners** — daily exams, subject quizzes, lesson library, games, live leaderboard, CBC-aligned progress tracking, AI study help via Zed.
- **Teachers** — AI generators for lesson plans, worksheets, flashcards, schemes of work, and rubrics (CBC-format, Zambian). All output exports to DOCX/PDF.
- **Admins** — learner activity monitoring (per-learner profiles, CSV export), content approvals, teacher verification, waitlist, AI generation logs, CBC knowledge-base editor.

## Tech stack

- **Frontend**: React 18 + Vite 5, Tailwind CSS, React Router 6, lazy-loaded routes, TipTap rich-text editor, KaTeX for math.
- **Backend**: Firebase Cloud Functions v2 (Node 20), Firestore, Firebase Auth, Firebase Storage.
- **AI**: Anthropic Claude Sonnet 4.5 for generators and Zed chat (server-side via Cloud Functions, SSE streaming for chat, prompt caching + CBC-context caching for generators). OpenAI GPT for short-answer quiz marking. Firebase AI Logic (`firebase/ai`) is wired up in [src/firebase/ai.js](./src/firebase/ai.js) for client-side Gemini calls — see [src/utils/aiLogic.js](./src/utils/aiLogic.js) for the `generateText` / `streamText` / `generateJSON` helpers.
- **Payments**: MTN MoMo (Zambia live + sandbox environments).
- **Hosting**: Firebase Hosting for the frontend at `zedexams.com`; Firebase for Functions/Firestore/Auth/Storage. Hosting forwards `/api/*` to Cloud Functions per the `rewrites` block in [firebase.json](./firebase.json).

## Repo layout

```
src/
├── components/
│   ├── admin/           Admin dashboard — learners, results, approvals, CBC KB, waitlist, generation logs
│   ├── ai/              Zed study assistant (learner) and floating button
│   ├── auth/            Login, Register, password reset
│   ├── dashboard/       Learner dashboards — StudentDashboard, GradeHub, MyResults, Badges, Profile
│   ├── exams/           Daily exams hub, runner, results, live leaderboard
│   ├── games/           Games hub, subject picker, game engines (TimedQuizGame, MemoryMatchGame, WordBuilderGame, …)
│   ├── lessons/         Lesson library, player, editor, slide renderer, PowerPoint viewer
│   ├── marketing/       Teacher landing page, samples gallery (public, no auth)
│   ├── quiz/            Quiz list, editor (v2), runner (v2), results, document-quiz parser
│   ├── teacher/         Teacher dashboard, generators (lesson plan / worksheet / flashcards / scheme of work / rubric), library
│   └── ui/              Shared — Logo, Button, Icon, ErrorBoundary, PageLoader, ComingSoon
├── contexts/            AuthContext, ThemeContext, DataSaverContext
├── config/              curriculum.js (SUBJECTS / GRADES)
├── utils/               Firestore services, exam service, AI assistant client, waitlist, teacher tools
├── firebase/config.js   Firebase SDK init (reads VITE_FIREBASE_* env vars)
└── main.jsx             Entry — wraps <App /> in ErrorBoundary + providers

functions/
├── index.js             Cloud Function exports (aiChat SSE, generateQuiz, checkShortAnswer, MTN MoMo webhooks, …)
├── aiService.js         Anthropic client — streaming + non-streaming, prompt caching
├── teacherTools/        Generator Cloud Functions + prompt templates + CBC KB resolver
├── momoService.js       MTN MoMo payment integration
└── tts.js               Text-to-speech helper

firestore.rules          Security rules
firestore.indexes.json   Composite indexes for leaderboard + results queries
netlify.toml             Netlify redirects — /api/* → Cloud Function URLs
```

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

For AI features, the Anthropic and OpenAI keys live server-side as Firebase Functions secrets — see **Environment variables** below.

## Environment variables

### Frontend (`.env`)

Required for the React app to reach Firebase. All must start with `VITE_` so Vite exposes them to the browser bundle.

| Variable | Purpose |
|----------|---------|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase web app ID |
| `VITE_FIREBASE_MEASUREMENT_ID` | Google Analytics measurement ID (optional) |
| `VITE_FIREBASE_AI_MODEL` | Override the Firebase AI Logic Gemini model (optional, defaults to `gemini-2.5-flash`) |

> **Firebase AI Logic** — Enable it in the Firebase console under *Firebase AI Logic*, register the web app, and turn on App Check (reCAPTCHA Enterprise) before flipping enforcement on. Without App Check enforcement, the API quota is exposed to anyone with your public web config.

### Backend (Firebase Functions secrets)

Set via `firebase-tools`, not `.env`:

```bash
# AI features
npx -y firebase-tools@latest functions:secrets:set ANTHROPIC_API_KEY
npx -y firebase-tools@latest functions:secrets:set OPENAI_API_KEY

# MTN MoMo payments
npx -y firebase-tools@latest functions:secrets:set MTN_API_USER
npx -y firebase-tools@latest functions:secrets:set MTN_API_KEY
npx -y firebase-tools@latest functions:secrets:set MTN_SUBSCRIPTION_KEY
npx -y firebase-tools@latest functions:secrets:set MTN_ENV
```

`MTN_ENV` values: `sandbox` (EUR test) or `mtnzambia` (ZMW live).

Optional override: `ANTHROPIC_MODEL` — defaults to `claude-sonnet-4-5`. Set in the Functions runtime env to swap models without redeploying prompt code.

## Deployment

**App deploys go through GitHub — never run `firebase deploy --only hosting` directly.** The live site is on Firebase Hosting. Open a PR, get it merged to `main`, and the `Deploy Hosting` GitHub Actions workflow (`.github/workflows/deploy-hosting.yml`) builds the Vite frontend and publishes `zedexams.com` automatically. The sibling `Deploy Firebase` workflow handles Firestore rules, Storage rules, and Cloud Functions on the same trigger.

Useful npm scripts:

| Script | What it does |
|--------|--------------|
| `npm run build` | Build the Vite frontend into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run deploy:firebase:functions` | Deploy only Cloud Functions (use when backend code changes but the app doesn't need a release) |
| `npm run deploy:firebase:firestore` | Deploy Firestore rules + indexes |

## Android wrapper (Capacitor) + Firebase App Distribution

The web app is wrapped with [Capacitor](https://capacitorjs.com) so we can ship pre-release Android builds to testers via [Firebase App Distribution](https://firebase.google.com/docs/app-distribution). Config lives in [`capacitor.config.json`](./capacitor.config.json) (`appId: com.zedexams.app`) and the generated native project is in [`android/`](./android).

### Prerequisites (one-time)

- **JDK 21** and **Android SDK 35+** — easiest via [Android Studio](https://developer.android.com/studio).
- `firebase-tools` (already used by the project) for App Distribution uploads.
- An Android app registered in the Firebase console under *App Distribution* — copy its App ID (looks like `1:123…:android:abc…`).

### Build a debug APK

```bash
npm run android:apk:debug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

`android:apk:debug` runs `vite build`, syncs `dist/` into the Android project, and shells into Gradle. Use `npm run android:open` to inspect or run on an emulator from Android Studio, or `npm run android:run` to launch on a connected device.

### Upload to App Distribution

```bash
npx -y firebase-tools@latest appdistribution:distribute \
  android/app/build/outputs/apk/debug/app-debug.apk \
  --app <FIREBASE_ANDROID_APP_ID> \
  --groups testers \
  --release-notes "Capacitor wrapper smoke test"
```

For release-signed builds run `npm run android:apk:release` after configuring a keystore in `android/app/build.gradle` (`signingConfigs.release`).

### Known caveats before wider beta

- **Auth persistence** — `src/firebase/config.js` uses `browserSessionPersistence`, which logs the user out every time the wrapper is killed. Switch to `indexedDBLocalPersistence` for the native shell only (detect via `Capacitor.isNativePlatform()`).
- **Google sign-in** — popup auth doesn't work in Android WebView. Use `signInWithRedirect` or the [`@capacitor-firebase/authentication`](https://github.com/capawesome-team/capacitor-firebase) plugin.
- **App Check** — the web reCAPTCHA provider won't work in the WebView. Configure the Play Integrity provider on the Android app before enabling enforcement on Firebase AI Logic / Functions.

## Testing & linting

```bash
npm run lint             # ESLint on src/
npm run lint:fix         # ESLint autofix
npm run test:importer    # Quiz-document-parser unit tests
npm run check:integrity  # Byte-level file integrity check (pre-commit guard)
```

Husky + lint-staged run `check:integrity` on every commit and `eslint --fix` on staged `src/**/*.{js,jsx}`.

## Other docs in this repo

- [DEPLOY.md](./DEPLOY.md) — deeper deploy playbook
- [TEACHER_TOOLS_ARCHITECTURE.md](./TEACHER_TOOLS_ARCHITECTURE.md) — how generators, prompts, and the CBC KB fit together
- [CBC_PRIVATE_KB_SETUP.md](./CBC_PRIVATE_KB_SETUP.md) — seeding the CBC knowledge base
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) — pre-launch verification steps
- [BUG_REPORT.md](./BUG_REPORT.md) — known-issue tracker
<!-- zed was here -->
