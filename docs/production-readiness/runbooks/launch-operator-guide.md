# The Launch Guide — explained like you're five 🚀

> Snapshot as of 2026-07-24 — verify before acting.

Hi! 👋 The **code** for ZedExams is ready. But before we tell the whole world
to come in, we have to flip some switches that only a grown-up with the keys can
flip — things like "turn the alarm on" and "make a spare copy of everything."

This guide walks you through **8 steps, in order**. Do them from top to bottom.
Each step tells you: **what it is** (the simple version), **why it matters**,
**exactly what to do**, and **how you know it worked**. 🎉

> ⚠️ **Do them in order.** Step 2 gives the robot permission to set alarms —
> if you skip it, Steps 3–7's alarms never actually turn on, even though
> everything *looks* fine.

## Before you start — the keys you need 🔑
- **GitHub**: admin on the `Mwelwa-cyber/Zedexams` repo (to change settings).
- **Google Cloud / Firebase**: owner/editor on the **`examsprepzambia`** project
  (the console at console.firebase.google.com and console.cloud.google.com).
- **Firebase CLI** logged in (`firebase login`) on your computer, for the couple
  of steps that use a command.

Some steps already have a detailed recipe in this folder — I link to it. This
page is the **map**; those are the **recipes**.

---

## Step 1 — Lock the door so bad code can't sneak in 🔒
**What it is:** Make GitHub *refuse* to merge any change unless all the safety
tests pass first.

**Why it matters:** Right now the tests run, but nothing *forces* them to be
green before merging. This is the switch that protects every future change.

**Do this:** GitHub → the repo → **Settings** → **Branches** → add/edit the
branch protection rule for **`main`** → tick **Require status checks to pass
before merging**, then add these checks by name:
- `Lint`
- `Tests (importer + sanitize + schema)`
- `Tests (Functions coverage)`
- `Tests (Vitest unit + coverage)`
- `Build + mobile smoke`
- `Tests (Firestore rules emulator)`
- `Tests (Storage rules emulator)`
- `Dependency audit (prod deps)`

Also tick **Include administrators** so nobody can bypass it.

**✅ You did it when:** you open a test PR with a deliberately broken test and
GitHub won't let you merge it.

*(More context: `runbooks/ci-supply-chain.md`.)*

---

## Step 2 — Give the robot permission to set alarm clocks ⏰
**What it is:** Let the deploy robot create the scheduled jobs (the "crons") that
run our nightly safety checks.

**Why it matters:** This is the **most important and least obvious** one. Our
backup-checker and health-checkers are built and deployed — but they only *run*
if the deploy account is allowed to create Cloud Scheduler jobs. Without this,
they silently never fire. (Finding CICD-002.)

**Do this:**
1. Google Cloud Console → **IAM & Admin** → **IAM** (project `examsprepzambia`).
2. Find the **service account the GitHub deploy uses** (the one in the
   `deploy-firebase` workflow's credentials).
3. **Grant it the role** `Cloud Scheduler Admin` (`roles/cloudscheduler.admin`).
4. Re-run the **`deploy-firebase`** workflow in GitHub → Actions (or push a tiny
   change) so it can now create the jobs.

**✅ You did it when:** Cloud Console → **Cloud Scheduler** shows these four jobs:
`firebase-schedule-backupCompletionCheck-…`,
`firebase-schedule-storageBackupCheck-…`,
`firebase-schedule-rateLimitHealthCheck-…`,
`firebase-schedule-opsHeartbeatCheck-…`.

---

## Step 3 — Make sure the nightly "save everything" actually happens 💾
**What it is:** Confirm the database is being copied to a safe bucket every
night, and that a copy could be brought back.

**Why it matters:** If a bad day ever wipes data, this is what saves the company.
The restore has already been rehearsed once (27,192 documents came back,
~26 minutes) — now confirm the *nightly copy* is really running.

**Do this:**
1. Make sure the backup destination is set: the env var **`FIRESTORE_BACKUP_BUCKET`**
   must point at a real Cloud Storage bucket (see the exact recipe in
   `runbooks/firestore-restore.md`, Part 1).
2. In Firestore, open today's **`opsBackups/{date}`** document. It should go
   `started` → **`completed: true`**, matching an `opsBackupRuns/{id}` entry.

**✅ You did it when:** today's `opsBackups` doc says `completed: true`. (If it's
stuck on `started`, Step 2 probably wasn't finished — the completion-checker
cron isn't running.)

*(Full recipe: `runbooks/firestore-restore.md`.)*

---

## Step 4 — Turn on the "tell me when something breaks" phone ☎️
**What it is:** Point the alarm system at a Slack/Discord channel *and* email, so
if a backup fails or a robot trips, a human hears about it.

**Why it matters:** Alarms that only go to one place fail silently if that place
is broken. Two independent channels means the message always gets out. (OBS-004,
already built — you just plug in the phone number.)

**Do this:**
1. Make a Slack (or Discord) **incoming webhook URL** for your ops channel.
   *Slack: Apps → Incoming Webhooks → Add to a channel (e.g. `#zedexams-ops`).*
2. Store it as a **secret**, not an env var — the URL is a credential:
   `firebase functions:secrets:set OPS_ALERT_WEBHOOK_URL` and paste it.
3. That's it — the binding is in code (`functions/opsAlertSecrets.js`), so the
   next functions deploy picks the secret up. Keep the secret in place: because
   every alerting function binds it, destroying it hard-fails *every* functions
   deploy until the binding is removed in code first.
4. Make sure **`OPS_ALERT_EMAILS`** is set too (the email channel). Do NOT use
   `ADMIN_EMAILS` for this — it is an admin-bootstrap allowlist, not a mailing
   list (#1993; see `functions/opsAlertRecipients.js`).
5. Open **/admin → Developer tools → Test the ops alarm** and press **Send test
   alert**. It fires one real alert (marked *info*) down both channels and tells
   you, per channel, whether it arrived — and if not, why.

**✅ You did it when:** the test alert lands in **both** the chat channel **and**
the admin email.

---

## Step 5 — Set the AI's pocket-money limit 💰
**What it is:** Give the AI a monthly spending cap so it can never run up a scary
bill.

**Why it matters:** Without a cap set, the budget "fails open" — meaning there's
no ceiling. This protects the company wallet. (AI-001 / B3.)

**Do this:**
1. Set **`AI_MONTHLY_BUDGET_USD`** to a dollar amount (or set
   **`AI_BUDGET_MODE=revenue_linked`** to cap spend to a fraction of real
   subscription revenue).
2. While you're here, turn on **App Check** enforcement for the clean web labels
   (`APPCHECK_ENFORCE_LABELS`) and confirm the Android **Play Integrity**
   provider is registered — this stops fake clients from burning the budget.

**✅ You did it when:** an intentionally-over-budget AI call is refused with a
"resource-exhausted" error, and a request without App Check gets a 401 on an
enforced label.

---

## Step 6 — Make a spare copy of the pictures 🖼️
**What it is:** Back up the uploaded/generated **images** (Storage), not just the
database.

**Why it matters:** Step 3 copies the database; this copies the files. Both
matter for a full recovery. (DR-003.)

**Do this:** one script does the whole setup — the second bucket, the daily
**Storage Transfer** job that mirrors the main bucket into it, and the
permissions both need. It shows you the plan first and changes nothing until you
add `--live`:

```bash
npm run provision:storage-backup              # look at what it will do
npm run provision:storage-backup -- --live    # do it
```

Then uncomment **`STORAGE_BACKUP_BUCKET`** in `functions/.env.examsprepzambia`
(the line is already there, commented) and merge a PR so it deploys.

**✅ You did it when:** the **`opsStorageBackups`** status reads **`fresh`**, and
the "Storage backup MISCONFIGURED" email stops arriving each morning. It reads
`empty` until the first overnight transfer finishes — that's expected on day one.

---

## Step 7 — Protect the logbook and the spare keys 📒🗝️
**What it is:** Two safety nets: (a) confirm the "who-did-what" logbook shouts if
it ever fails to write, and (b) keep spare copies of the important secret keys
somewhere safe.

**Why it matters:** Admin actions must always be recorded (OBS-002 — already
built to alert on a failed write), and if a key is ever lost you need a way back
in (DR-006).

**Do this:**
1. Confirm a **failed audit write raises an alert** (do one controlled test; the
   code is already there).
2. Put the critical secrets into your **escrow vault**, confirm **Play App
   Signing** is enabled, and run the non-prod **recovery drill**.

**✅ You did it when:** the audit-failure test produces an alert, and you've done
one secrets-recovery dry run.

*(Full recipe: `runbooks/secrets-recovery.md`.)*

---

## Step 8 — Check a homework file still opens 📄
**What it is:** Run one real Word document (`.docx`) through the admin quiz-import
on the live site.

**Why it matters:** We hardened the file-reading code against nasty files
(SEC-007); this confirms we didn't accidentally break *normal, good* files.

**Do this:** On the deployed site, as an admin, import a valid `.docx` past paper.

**✅ You did it when:** the text **and** any images come through correctly.

---

## 🎉 You finished the 8 switches!

After these, also do these two quick confirmations (they aren't dangerous, just
tick them off):
- **Crash reporting**: confirm **`VITE_SENTRY_DSN`** is set in the production
  build so client crashes are captured (OBS-001).
- **Practice the "undo" button**: run the rollback rehearsal once and write down
  how long it took (`runbooks/deploy-rollback.md`, §7).

---

## ⛔ Two things this guide can't finish for you (they need grown-ups outside engineering)

The 8 steps get the **machine** ready. Opening to the **whole public** also needs
two things a runbook can't do:

1. **Permission slip from parents (LEGAL-001).** ZedExams is for children, so a
   lawyer needs to set up **verifiable parental consent**. Blocking for a public
   launch.
2. **Permission to use the past papers (LEGAL-002).** Confirm the **ECZ
   past-paper licensing** basis with counsel.

And two things need a **test deploy** to measure (a preview/staging site):
- Mobile speed score (Lighthouse) ≥ 75.
- One real end-to-end **payment** from start to finish.

---

## Quick tick-list (print this) ✅

```
[ ] 1. GitHub branch protection: required checks ON for main
[ ] 2. Deploy SA gets Cloud Scheduler Admin → 4 cron jobs exist
[ ] 3. FIRESTORE_BACKUP_BUCKET set → opsBackups completed:true
[ ] 4. OPS_ALERT_WEBHOOK_URL + OPS_ALERT_EMAILS set → test alert in chat + email
[ ] 5. AI_MONTHLY_BUDGET_USD (or revenue_linked) + App Check enforced
[ ] 6. STORAGE_BACKUP_BUCKET set → opsStorageBackups=fresh
[ ] 7. Audit-failure alert tested + secrets escrow/recovery drill done
[ ] 8. Valid .docx imports cleanly on the live site
[ ] +  VITE_SENTRY_DSN live; rollback rehearsal done
[ ] ⚖  Parental consent + ECZ licensing (lawyer); perf + payment (staging)
```
