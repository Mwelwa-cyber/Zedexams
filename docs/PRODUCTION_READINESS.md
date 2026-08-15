# Production Readiness

> Snapshot as of 2026-07-07 — verify before acting. Tick items as they land;
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
| `npm audit` (Cloud Functions runtime) | 0 vulnerabilities (after the `overrides` in this pass) |
| Committed secrets | none (`functions/.env.examsprepzambia` is non-secret config only) |
| Error monitoring | Sentry wired **and** `VITE_SENTRY_DSN` confirmed present in Actions secrets — live in prod |

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
- [x] **Runtime secrets verified (2026-07-07).** `VITE_SENTRY_DSN` and all 14
  `VITE_*` build vars + `FIREBASE_TOKEN` are present in GitHub Actions secrets.
  Backend keys (`OPENAI_API_KEY`, `LENCO_API_KEY`, `GEMINI_API_KEY`,
  `EMAIL_SMTP_*`, `META_WHATSAPP_*`) live in Secret Manager (a different store,
  correctly absent from the Actions list) and are proven set by the working live
  app. Only WhatsApp/Bonga + Google Play billing aren't provable from "the app
  works" — check those directly only if they're meant to be live now.
- [ ] **Delete the dead `RECRAFT_API_KEY` Actions secret** (hygiene). Recraft was
  decommissioned — `functions/index.js:297` explicitly leaves it unbound and
  nothing references it. Revoke it on Recraft's side too if that account exists.

### Operational
- [ ] **Promote `Build + mobile smoke` to a required status check** on `main`
  branch protection (CLAUDE.md flags it as not-yet-required). Consider adding
  the two rules-emulator jobs too.
- [ ] Reminder: deploy new Firestore composite indexes
  (`firebase deploy --only firestore:indexes`) *before* merging code whose
  queries depend on them.

### Hygiene
- [x] **Decide on the committed QA-report baselines — resolved (Phase 6,
  2026-08-15).** `.auth-qa-report.json` + `.authoring-qa-report.json` are
  write-only run outputs — nothing reads them back as a baseline (the smoke
  harness doesn't consume them, and no script or CI job does) — so they were
  removed from tracking and `.gitignore`d, and the two references
  (`src/config/agents.js`, `ORG.md`) now say the reports live untracked where
  a run drops them. Quill still writes them locally on every run.
- [x] **Cloud Functions dependency advisories — resolved (2026-07-07).** All 13
  traced to two transitive leaves: `uuid <11.1.1` (vulnerable only via
  `v3/v5/v6` with a buffer — unused here; everything uses `v4`) and
  `ts-deepmerge <8.0.0` (via the unused `firebase-functions-test` dev dep).
  `npm audit`'s "fixes" were all **downgrades** of `firebase-admin`/
  `firebase-functions`/`exceljs` to ancient majors that would break the Node 22
  backend, so instead an `overrides` block in `functions/package.json` forces
  `uuid@^11.1.1` + `ts-deepmerge@^8.0.0`. Result: `functions/` `npm audit` → **0
  vulnerabilities**, validated by `npm ci` + `test:all` + the exceljs xlsx/docx
  exporter tests + a module-load smoke. Note: CI test jobs use root deps, so
  this override is exercised only locally + at deploy (`deploy-firebase.yml`).
- [ ] Root **dev** tree still has 9 advisories (dev-only, need `--force`/major
  bumps in firebase-tools/emulator tooling — no production impact, low priority).

## Done 2026-07-07
- **Cleared all Cloud Functions dependency advisories** via a tested `overrides`
  block (`uuid@^11.1.1`, `ts-deepmerge@^8.0.0`) — `functions/` audit → 0.
- **Verified deploy secrets** — `VITE_SENTRY_DSN` + all build vars present in
  Actions; backend keys proven by the live app.

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
