# Deploying zedexams.com

> Last updated 2026-07-05. If the workflow files under `.github/workflows/`
> disagree with anything here, the workflow files win — update this doc.

Every change reaches production through **GitHub Actions**, triggered by a merge
to `main`. There is no manual deploy step and no Netlify — production Hosting
and Cloud Functions ship from CI only. This doc explains the pipeline, the
day-to-day flow, and how to roll back.

---

## The big picture

Two independent workflows watch `main`. A single merge can trigger both.

**1. Hosting (the React frontend) — [`deploy-hosting.yml`](.github/workflows/deploy-hosting.yml)**
On every push to `main` (except pure-docs / Firebase-only paths) it: verifies
the required build secrets are set → `npm ci` → `npm run lint` → `npm run test:all`
→ `npm run build` → prerenders the public SEO routes → deploys `dist/` to
**Firebase Hosting** (`firebase deploy --only hosting`, project `examsprepzambia`).
If the same commit also changed Firebase paths, it first waits for the Firebase
workflow to go green before publishing, so Hosting never ships ahead of a failed
rules/functions deploy.

**2. Firebase backend — [`deploy-firebase.yml`](.github/workflows/deploy-firebase.yml)**
Runs only when a push to `main` touches `firestore.rules`,
`firestore.indexes.json`, `storage.rules`, `storage`, `functions/**`,
`firebase.json`, or `.firebaserc`. It re-runs lint + `test:all`, then deploys
**only the pieces that changed** (Firestore rules/indexes, Storage rules, Cloud
Functions). Authenticates with the `FIREBASE_DEPLOY_SERVICE_ACCOUNT_JSON`
secret (preferred) or the legacy `FIREBASE_TOKEN` — see "One-time setup" below.

Both pipelines are the belt-and-braces layer. The pre-merge gate is
[`ci.yml`](.github/workflows/ci.yml), which runs the same lint + tests + build +
rules-emulator checks on every PR.

---

## Day-to-day: shipping a change

`main` is branch-protected (`enforce_admins` on) — you cannot push to it
directly, and a merge is blocked until the required status checks pass. The flow
is always a PR:

```bash
# 1. Verify locally first — the deploy re-runs these, so failing on CI wastes a slot.
npm run lint && npm run build          # plus the relevant feature tests

# 2. Push your branch.
git push -u origin <branch>

# 3. Open a PR (two identical remotes → -R is required).
gh pr create -R Mwelwa-cyber/Zedexams --fill

# 4. Queue the auto-merge. It fires the moment the required checks go green.
gh pr merge <num> --auto --squash --delete-branch -R Mwelwa-cyber/Zedexams
```

Required checks on `main`: **`Lint`** + **`Tests (importer + sanitize + schema)`**.
Do not wait for a human to merge — `--auto` is the merge gate.

Watch the deploy at
<https://github.com/Mwelwa-cyber/Zedexams/actions>. When the Hosting run (and the
Firebase run, if backend paths changed) go green, zedexams.com is updated.

---

## Allowed direct CLI (the exceptions)

Almost everything ships via CI, but two commands are safe to run directly
because they don't touch the hosted bundle:

- **`npx firebase deploy --only firestore:indexes`** — deploy composite indexes.
  Do this *before* merging code whose queries depend on them, or the queries
  fail with "index building" until the index catches up.
- **`npm run storage:cors`** — one-time (re-run if origins change) push of
  [`cors.json`](cors.json) to the Storage bucket so cross-origin *reads* of
  generated images work in the PDF/Word exporters.

## Off-limits (CI only)

- `firebase deploy --only hosting` — production Hosting goes through CI only
  (also denied in [`.claude/settings.json`](.claude/settings.json)).
- `firebase deploy --only functions` — same; CI ships Cloud Functions.
- Direct pushes to `main` — always open a PR, even for a one-line change.

---

## One-time setup (already done — here for reference)

The deploy pipelines authenticate with ONE of two repo secrets (service
account wins when both are set), plus the `VITE_FIREBASE_*` build secrets:

**1. `FIREBASE_DEPLOY_SERVICE_ACCOUNT_JSON` (preferred).** A Google Cloud
service-account key. Unlike the `login:ci` token below it is not tied to a
personal Google account, so a password change or account security event cannot
revoke it — exactly what silently killed every deploy on 2026-07-12. Create it
once:

1. Google Cloud Console → **IAM & Admin → Service Accounts** (project
   `examsprepzambia`) → **Create service account** (e.g. `github-deploy`).
2. Grant it three roles: **Firebase Admin** (`roles/firebase.admin`),
   **Service Account User** (`roles/iam.serviceAccountUser`), and
   **Secret Manager Admin** (`roles/secretmanager.admin`). The third is not
   optional: the functions deploy reads every bound secret
   (`ANTHROPIC_API_KEY`, `GITHUB_BOT_TOKEN`, …) from Secret Manager and
   manages the runtime account's access grants, and Firebase Admin does not
   include those permissions — without it the deploy fails with
   `403 Permission 'secretmanager.secrets.get' denied` (first hit 2026-07-13).
   If a later deploy fails with `PERMISSION_DENIED` naming a different
   permission, add the role it names. Note: a freshly granted role can lose a
   race against an already-running deploy (IAM propagation takes a minute or
   two) — re-run the failed jobs before assuming the grant didn't work.
3. On the new account: **Keys → Add key → Create new key → JSON** — download it.
4. Paste the **entire file contents** into a new secret named
   `FIREBASE_DEPLOY_SERVICE_ACCOUNT_JSON` at
   <https://github.com/Mwelwa-cyber/Zedexams/settings/secrets/actions>.

**2. `FIREBASE_TOKEN` (legacy fallback — deprecated by firebase-tools).**
Tied to the Google account that mints it, so it dies on password changes /
security checkups. To rotate:

```bash
npx firebase-tools@latest login:ci   # sign in, copy the 1//... token
```

Then replace it at
<https://github.com/Mwelwa-cyber/Zedexams/settings/secrets/actions> →
`FIREBASE_TOKEN`. The full list of build-time secrets (and which are optional)
is documented at the top of `deploy-hosting.yml`.

Backend runtime secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`LENCO_API_KEY`, `GOOGLE_PLAY_SA_JSON`, `EMAIL_SMTP_*`, `META_WHATSAPP_*`) live
in **Google Cloud Secret Manager**, bound to functions at deploy time:

```bash
npx firebase-tools@latest functions:secrets:set ANTHROPIC_API_KEY   # paste sk-ant-...
npx firebase-tools@latest functions:secrets:access ANTHROPIC_API_KEY  # verify it's set
```

A function only picks up a secret if it is deployed *after* the secret exists.

---

## Rolling back

**Hosting (fastest — instant, zero downtime):**
1. Firebase Console → **Hosting** → the `examsprepzambia` site → **Release history**.
2. Find the last good release → **⋮** menu → **Rollback**.

The previous build goes live in seconds; the broken one is preserved for
diagnosis. Alternatively, `git revert <bad commit> && git push` (via a PR)
re-runs the pipeline and re-publishes the prior code.

**Firebase (rules / indexes / functions):**
Less clean — there is no one-click rollback. `git revert` the offending commit
and merge; `deploy-firebase.yml` re-deploys the previous state. For a rules
emergency, you can also edit them directly in the Firebase Console as a hotfix,
then reconcile in git afterward.

---

## Smoke test after a user-facing deploy

1. Open zedexams.com in an incognito window — landing loads.
2. `/teachers` renders; a sample at `/teachers/samples` renders + DOCX downloads.
3. Sign in as admin — teacher dashboard shows the AI tool cards.
4. Generate a Grade 5 Maths Fractions lesson plan — returns in < 30s.
5. Download it as DOCX — opens in Word. Library lists it; re-export works.

The CI build already runs a headless mobile smoke over `/`, `/login`,
`/register`, `/papers`, `/pricing`, so a broken public route is caught before
merge — this manual pass covers the authed AI flow the smoke can't.
