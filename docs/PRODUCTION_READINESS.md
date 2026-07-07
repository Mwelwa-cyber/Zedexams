# Production Readiness

> Snapshot as of 2026-07-05 — verify before acting. Tick items as they land;
> prune this doc (or delete it) once the open list is empty.

ZedExams is **already in production** (live at zedexams.com). This is not a
"can we launch" gate — it's the residual hardening + hygiene list. Every
automated gate below was green on the `claude/production-readiness-checklist`
branch when this snapshot was taken.

## Verified green (2026-07-05)

| Gate | Result |
|---|---|
| `npm run lint` | clean |
| `npm run build` | clean (~36s, PWA + 505 precache entries) |
| `npm run test:all` (node suite) | 323 scripts passed |
| `npm run test:unit` (Vitest) | 162 files / 1694 tests passed |
| `npm audit` (frontend bundle, `--omit=dev`) | 0 vulnerabilities |
| Committed secrets | none (`functions/.env.examsprepzambia` is non-secret config only) |
| Error monitoring | Sentry wired (`src/utils/sentry.js`, gated on `VITE_SENTRY_DSN`) |

Emulator suites (`test:rules-emulator`, `test:storage-rules-emulator`) need a
JVM and run in CI — not verified in this snapshot.

## Open items

### Security
- [ ] **Finish the App Check enforcement rollout.** Currently soft-verify
  (observe-only) — public AI endpoints count attestation in
  `appCheckHealth/{date}` but don't block. Drive it from **`/admin/app-check`**:
  enforce the clean web endpoints first via `APPCHECK_ENFORCE_LABELS` in
  `functions/.env.examsprepzambia` (a ready-to-uncomment block is already in
  that file), watch for 24–48h, then widen. Do **not** set the global
  `APPCHECK_ENFORCE=1` until Android Play Integrity is registered
  (`docs/B3-PLAY-INTEGRITY-SETUP.md`) or every Android call will 401.
- [ ] **Verify runtime secrets exist in Secret Manager** before the next
  functions deploy (secrets bind at deploy time): `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LENCO_API_KEY`, `GOOGLE_PLAY_SA_JSON`,
  `EMAIL_SMTP_USER/PASSWORD`, `META_WHATSAPP_*`.
- [ ] **Confirm `VITE_SENTRY_DSN` is set** as a repo secret consumed by
  `deploy-hosting.yml` — if blank, the `@sentry/react` package is tree-shaken
  out and production errors are captured nowhere.

### Operational
- [ ] **Promote `Build + mobile smoke` to a required status check** on `main`
  branch protection (CLAUDE.md flags it as not-yet-required). Consider adding
  the two rules-emulator jobs too.
- [ ] Reminder: deploy new Firestore composite indexes
  (`firebase deploy --only firestore:indexes`) *before* merging code whose
  queries depend on them.

### Hygiene
- [ ] **Decide on the committed QA-report baselines** `.auth-qa-report.json`
  (~100 KB) + `.authoring-qa-report.json` — they're Quill's declared outputs
  (referenced in `src/config/agents.js` + `ORG.md`) and were regenerated
  2026-07-04, so they're not stale, but they bloat the tree. Either `.gitignore`
  them (and update the two references) or keep them as intentional baselines.
- [ ] **Dependency advisories.** Frontend bundle: 0. Root dev tree: 9
  (dev-only, all need `--force`/major bumps). **Cloud Functions runtime: 10
  moderate** in production deps (`firebase-admin`, `firebase-functions`,
  `@google-cloud/*`, `exceljs`, `uuid`, …) — `gaxios` + `js-yaml` fix safely,
  the rest need major upgrades. Handle in a **dedicated deps PR** with the
  functions test suite, not a docs/cleanup change (a bad major bump to
  `firebase-admin`/`firebase-functions` breaks the deployed backend).

## Done in this pass (2026-07-05)
- Rewrote `DEPLOY.md` — it documented a Netlify pipeline that no longer exists;
  now matches the real Firebase Hosting + GitHub Actions flow, with correct
  rollback steps.
- Removed unreferenced stale artifacts: `POLISH_PLAN.md`, `POLISH_PREVIEW.html`,
  `DEBUG_LESSON_PLAN.md`, `games-preview.html`, `redesign-preview.html`,
  `tmp/dashboard-preview.html`, `test.mp3` (and trimmed the dangling
  `DEBUG_LESSON_PLAN.md` pointer from a `teacherTools.js` error message).
- Added a ready-to-uncomment App Check enforcement block to
  `functions/.env.examsprepzambia`.
