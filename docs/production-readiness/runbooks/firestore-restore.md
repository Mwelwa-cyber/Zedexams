# Runbook — Firestore Backup & Restore (DR-001)

> Snapshot as of 2026-08-04 (Parts 1–2 as of 2026-07-19; **Appendix A** added
> 2026-08-04 for the Phase 0B migration baseline). Owner: platform/reliability. Companion code:
> `functions/firestoreBackup.js`, `functions/firestoreBackupCore.js`,
> `scripts/restore-firestore.mjs`. Audit finding: [`../14-backup-and-disaster-recovery.md`](../14-backup-and-disaster-recovery.md).

This runbook turns the daily export **on** and documents a **non-destructive,
rehearsable restore**. Nothing here should be run against production data
without the explicit go/no-go step called out below. **Do not perform a
destructive production restore as part of a drill.**

### ⚠️ Deployed resource regions (read first — commands depend on these)
The backup **function and its Scheduler job run in `us-central1`**, while the
**Firestore database and backup bucket are in `africa-south1`**. This split is
intentional and matches the repo convention (only Firestore *triggers* pin to
`africa-south1`; HTTP/callable/scheduled functions stay in `us-central1`).

| Resource | Region |
|---|---|
| `dailyFirestoreBackup` function | **us-central1** |
| `extractAssessmentFormat` function | **us-central1** |
| Scheduler job `firebase-schedule-dailyFirestoreBackup-us-central1` | **us-central1** |
| Firestore `(default)` database | **africa-south1** |
| Backup bucket `gs://zedexams-backups` | **africa-south1** |

- Use `--location=us-central1` for **function and Scheduler** `gcloud`/log
  commands; use `--location=africa-south1` when **creating a scratch database**
  (it must match the source DB's location).
- **Moving the functions to `africa-south1` is a separate architecture task**
  and is explicitly out of scope here — do not change the deployed region as
  part of this runbook.
- **UTC date-key caveat:** the export folder + `opsBackups/{date}` doc id use
  the **UTC** date (`dateKeyUtc`). The cron fires at **01:30 Africa/Lusaka
  (UTC+2) = 23:30 UTC the *previous* calendar day**, so a run "on the morning
  of the 20th" writes to the **`YYYY-MM-19`** export folder. Always confirm the
  actual folder with `gsutil ls` (Part 1.6) before choosing a `--date=` to
  restore.

---

## Part 1 — Turn backups on (one-time setup)

### 1.1 Prerequisites & roles
- A GCP principal with `roles/owner` or the combination of
  `roles/datastore.owner` + `roles/storage.admin` to perform setup.
- The **Cloud Functions runtime service account** (the one `dailyFirestoreBackup`
  runs as) needs, and only needs:
  - `roles/datastore.importExportAdmin` on the project (create/manage exports)
  - `roles/storage.objectAdmin` on the **backup bucket only** (not project-wide)
- `gcloud` authenticated to the `examsprepzambia` project.

### 1.2 Create a cross-region bucket with lifecycle retention
The bucket **must be in a different region** from the `africa-south1` database
so a regional incident can't take both down.

```bash
gsutil mb -l europe-west1 -b on gs://zedexams-backups
gsutil versioning set on gs://zedexams-backups
# Retention: expire exports after 30 days (primary retention mechanism).
cat > /tmp/lifecycle.json <<'JSON'
{ "rule": [ { "action": {"type": "Delete"}, "condition": {"age": 30} } ] }
JSON
gsutil lifecycle set /tmp/lifecycle.json gs://zedexams-backups
```

Rationale for **30 days**: covers a month of daily exports so a slow-to-detect
corruption is still recoverable, while bounding storage cost. PITR (below)
covers fine-grained recovery within the last 7 days. The code-level
`selectExportsToDelete`/`runBackupRetention` (dry-run by default, never deletes
the newest or an incomplete export) is a **secondary** safeguard — the bucket
lifecycle rule is authoritative.

### 1.3 Grant the runtime SA least-privilege
```bash
RUNTIME_SA="<functions-runtime-sa>@examsprepzambia.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding examsprepzambia \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.importExportAdmin"
gsutil iam ch "serviceAccount:${RUNTIME_SA}:roles/storage.objectAdmin" \
  gs://zedexams-backups
```

### 1.4 Configure the destination (no secrets committed)
`FIRESTORE_BACKUP_BUCKET` is **non-secret config** — it is committed in the
per-project env file (already present in the repo), not Secret Manager:

```
# functions/.env.examsprepzambia  (tracked; auto-loaded by `firebase deploy`)
FIRESTORE_BACKUP_BUCKET=gs://zedexams-backups
```

Deploy functions via the normal CI path (`deploy-firebase.yml` runs
`firebase deploy --only functions`, which auto-loads `.env.<project>` and
passes the value to the deployed `us-central1` function). Do **not** commit any
service-account key. Confirm the deployed function received it:
```bash
gcloud functions describe dailyFirestoreBackup \
  --region=us-central1 --gen2 \
  --format='value(serviceConfig.environmentVariables.FIRESTORE_BACKUP_BUCKET)'
# → gs://zedexams-backups
```

### 1.5 Enable PITR + deletion protection
```bash
gcloud firestore databases update --database='(default)' --enable-pitr
gcloud firestore databases update --database='(default)' --delete-protection
```

### 1.6 Verify backups are running
Trigger the backup on demand (it runs in **us-central1**) or wait for the
01:30 Africa/Lusaka schedule:
```bash
# Manually run the scheduled backup now (us-central1):
gcloud scheduler jobs run firebase-schedule-dailyFirestoreBackup-us-central1 \
  --location=us-central1
# Inspect the run log (us-central1):
gcloud functions logs read dailyFirestoreBackup --region=us-central1 --gen2 --limit=20
```
Then confirm (remember the **UTC date-key** caveat above — a 01:30 Lusaka run
writes to the *previous* UTC day's folder):
- Firestore `opsBackups/{dateKeyUtc}`.`status` == **`started`** (not
  `misconfigured` / `skipped-non-production`), with `exportPath`,
  `operationName`, `correlationId`, `completed: false`.
- The export operation reached completion:
  ```bash
  gcloud firestore operations list --project=examsprepzambia
  # find the export operation; confirm done: true, no error
  gsutil ls gs://zedexams-backups/firestore-exports/<YYYY-MM-DD>/
  ```
- Capture this as **backup export evidence** (operation name + object listing).

> Status meaning: `started` = the export operation was **accepted**. True
> completion is asynchronous; confirm via the operation list above. A future
> enhancement is a completion checker that stamps `completed: true`.

---

## Part 2 — Restore (disaster recovery)

> **Restore is a MERGE-BY-OVERWRITE, not a clean replace.** `importDocuments`
> writes every exported doc into the target, overwriting same-path docs and
> leaving target-only docs in place. It can resurrect deleted docs and clobber
> newer writes. **Always restore into a fresh scratch database first.**

### 2.1 Identify a valid backup
- List available days: `gsutil ls gs://zedexams-backups/firestore-exports/`.
- Prefer a day whose `opsBackups/{day}.status == "started"` **and** whose
  export operation completed with no error (Part 1.6).
- Verify the export folder is non-empty and contains
  `<...>.overall_export_metadata`.

### 2.2 Restore into a NON-PRODUCTION database first
```bash
# Create an isolated scratch database (same location as the source DB).
gcloud firestore databases create \
  --database=restore-20260718 --location=africa-south1

# Dry run — prints the exact import request, changes nothing.
node scripts/restore-firestore.mjs --date=2026-07-18

# Execute the restore into the scratch database.
node scripts/restore-firestore.mjs --date=2026-07-18 \
  --database=restore-20260718 --live

# Track to completion.
gcloud firestore operations list --project=examsprepzambia
```

### 2.3 Validate the restored data (in the scratch DB)
- **Collections**: spot-check row counts for `users`, `payments`,
  `subscriptions`/entitlement fields, `results`, `exam_attempts`,
  `classRegisters`, `aiGenerations` against expectations for the chosen day.
- **Auth-linked references**: pick 5–10 `users/{uid}` and confirm the uid
  matches a real Firebase Auth user (Auth is **not** part of the Firestore
  export — see 2.6). Confirm `role`/entitlement fields look sane.
- **Storage references**: pick docs that carry `storagePath`/download URLs
  (past papers, assessment exports, branding) and confirm the referenced
  objects still exist in Storage (Storage is **not** covered by this export —
  DR-003).
- **Indexes**: composite indexes are defined by `firestore.indexes.json`, not
  by the export. Deploy indexes to the scratch DB (or accept that
  index-dependent queries need `firebase deploy --only firestore:indexes`)
  before validating query-driven views.

### 2.4 Production restore — go/no-go (requires explicit authorisation)
Only after 2.3 passes **and** an incident owner authorises:
- **Freeze client writes** for the affected scope. Options, least-disruptive
  first: put the app in maintenance mode (`settings/global.maintenance`), and/or
  temporarily deploy a Firestore rules build that denies writes to the affected
  collections. Confirm writes are actually blocked before importing.
- Importing straight into `(default)` requires the explicit
  `--i-understand-this-overwrites-production` flag on `restore-firestore.mjs`
  (the script refuses otherwise).
- Prefer restoring into a **new** database and repointing the app over
  overwriting `(default)` in place, when feasible.

### 2.5 Data written after the recovery point (RPO gap)
The daily export gives an RPO of up to 24h; PITR narrows this to minutes within
7 days. For writes between the recovery point and the incident:
- If PITR is enabled and the window is <7 days, prefer a **PITR read**
  (`--read-time`) over the daily export to minimise the gap.
- Reconcile payment/subscription state from the **provider** (Lenco / Google
  Play) via the existing reconcile paths (Till, `verifyGooglePlayPurchase`)
  rather than trusting the restored snapshot.

### 2.6 What this restore does NOT cover
- **Firebase Auth users** (separate export: `gcloud firestore` does not include
  Auth; use `firebase auth:export`/`:import` on its own cadence — a gap to close
  in Phase 1/2).
- **Cloud Storage objects** (DR-003 — enable bucket versioning + a mirror).
- **Secrets** (Secret Manager — document sources separately, DR-006).

### 2.7 Rollback / abort
- A restore into a **scratch** database has no production impact — abort by
  deleting the scratch database: `gcloud firestore databases delete --database=restore-20260718`.
- If a production import was started in error, **cancel the operation**
  (`gcloud firestore operations cancel <op>`) and restore from the pre-restore
  snapshot (take one before any production import — see 2.4). This is why a
  production import must be preceded by its own fresh export.

### 2.8 Evidence to capture during a drill
Record and attach to the DR ticket:
- chosen export day + operation name + `gsutil ls` of the export folder
- scratch database name + import operation name + `done:true`
- collection row-count spot-checks (before/after expectations)
- **measured RTO** (wall-clock from decision to validated scratch DB) — this
  is the number that closes the RTO gap in the audit.

---

## Appendix A — Migration restore rehearsal (Phase 0B / post-Phase 5)

> Added 2026-08-04 for the Phase 0B migration baseline (`docs/architecture.md`
> §11.2, §13). The **Phase 0B gate itself is already closed** by the restore
> drill of 2026-07-22 (27,192 docs, RTO 25m50s — DR-001 §13); this appendix is
> the ready-to-run sequence for the **post-Phase-5 rehearsal**, and for any
> re-run triggered by a change to the export destination, the database region,
> or `scripts/restore-firestore.mjs`.
>
> **Run it in an authorised operator's Cloud Shell session.** Cloud Shell is
> already authenticated as the operator, so no service-account key is needed and
> none should be created. Nothing in this appendix may be executed from a CI job
> or an agent session.
>
> **The import target must be a scratch database — never `(default)`.** Every
> command below names the scratch database explicitly. `importDocuments` is a
> merge-by-overwrite (Part 2's warning), so an unqualified import is not a
> "restore" but a silent overwrite of live data.

### A.1 Pick the export day and confirm it is complete

```bash
PROJECT=examsprepzambia
BUCKET=gs://zedexams-backups

gcloud config set project "$PROJECT"

# Which days exist? (Remember the UTC date-key caveat at the top of this file:
# a 01:30 Africa/Lusaka run writes the PREVIOUS UTC day's folder.)
gsutil ls "$BUCKET/firestore-exports/"

# Pick one, then prove it finished — the metadata object only appears on a
# completed export. An export folder with no metadata object is NOT restorable.
DATE=<YYYY-MM-DD>
gsutil ls -l "$BUCKET/firestore-exports/$DATE/" | grep overall_export_metadata
```

Cross-check `opsBackups/{DATE}.status` is `started` or `completed`. A `failed`
status on a date that *also* has a metadata object is the known same-UTC-date
collision artifact (§12 of the DR-001 record), not a bad export — but confirm
the metadata object before relying on that.

### A.2 Create the scratch database

It must be in **`africa-south1`**, matching the source database's location.
Give it a name that says what it is and when, so an abandoned one is obvious.

```bash
SCRATCH="restore-$(echo "$DATE" | tr -d '-')-drill"

gcloud firestore databases create \
  --database="$SCRATCH" \
  --location=africa-south1 \
  --type=firestore-native \
  --project="$PROJECT"
```

### A.3 The import command

**Dry run first** — the repo script prints the exact request and exits without
writing. It reuses `buildImportRequest` from `functions/firestoreBackupCore.js`,
so the request shape provably cannot drift from what the backup wrote:

```bash
node scripts/restore-firestore.mjs --date="$DATE"
```

Then the import itself. Either form is fine; they issue the same
`importDocuments` operation against the same prefix:

```bash
# Form 1 — gcloud (preferred in Cloud Shell: uses your own credentials).
gcloud firestore import "$BUCKET/firestore-exports/$DATE" \
  --database="$SCRATCH" \
  --project="$PROJECT" \
  --async

# Form 2 — the repo script (the tested inverse of the backup).
FIRESTORE_BACKUP_BUCKET="$BUCKET" \
  node scripts/restore-firestore.mjs --date="$DATE" --database="$SCRATCH" --live
```

> **Do not** add `--i-understand-this-overwrites-production`, and do not omit
> `--database`. Both roads lead to `(default)`. The script refuses the default
> database without that flag precisely so the refusal, not the flag, is the
> normal outcome.

Track it to completion, and **record the operation name** — it is the evidence:

```bash
gcloud firestore operations list --project="$PROJECT" --database="$SCRATCH"
# note the operation name; wait for done: true with no error
```

### A.4 Verification checklist

**Establish the expectations BEFORE importing, not after.** Read the counts off
the production database first and write them down; a restore of day *D*'s export
should match production as of *D*, i.e. within roughly one day's growth of the
pre-drill reading. There is no per-collection count committed to this repo on
purpose — a number in a doc is stale the week after it is written, and comparing
a restore against a stale number is worse than not comparing at all. The one
durable yardstick is the **whole-database total: 27,192 documents at
2026-07-22**; a total wildly below that means a partial import, and a re-run is
cheaper than a wrong conclusion.

Spot-check these, in this order — money first, because it is the only category
where a silently wrong restore causes harm outside the app:

| # | Collection | What to check | Why this one |
|---|---|---|---|
| 1 | `payments` | count; then 3–5 docs: `status`, `amountZmw`, `planId`, `userId` present and internally consistent | Server-only writes; the restore must not have invented or lost a payment |
| 2 | `invoices`, `subscriptionEvents` | count; each invoice resolves to a `payments` doc | The ledger either reconciles with `payments` or the restore is not trustworthy |
| 3 | `users` | count; then 5–10 docs: `role`, `plan`, `premium`, `subscriptionStatus/Expiry` | Entitlements — and the join point for the Auth check below |
| 4 | `assessments` + its `questions` **subcollections** | count parents, then confirm ≥2 parents have non-empty `questions` | §4.1: questions are a subcollection, not an array. A restore that brought back parents but no subcollections looks fine at the top level and is empty underneath |
| 5 | `quizzes` + `questions` subcollections | same as above | Same subcollection shape |
| 6 | `results`, `exam_attempts`, `scores` | counts | Highest-volume learner data — the best signal for a truncated import |
| 7 | `classRegisters` + `attendance` / `attendanceTerms` subcollections | count; one class has dated attendance docs | Dated subcollection docs, server-written; a distinct write path from the rest |
| 8 | `aiGenerations` | count | Teacher library contents |
| 9 | `pastPapers` | count | §10's PAPERS entity — the collection is `pastPapers` |
| 10 | `settings/global` | exists, readable | One-doc smoke test of a public-read surface |

Then the three checks that fail for reasons the Firestore export cannot fix —
each one is a **known gap, not a drill defect**, and should be recorded as
observed rather than treated as a failure:

- **Auth references.** Take 5–10 `users/{uid}` from the scratch DB and confirm
  each uid resolves to a real Firebase Auth user
  (`gcloud identity` / Firebase console). **Firebase Auth is not part of this
  export** (§2.6). A restore into a project whose Auth was also lost yields
  orphaned user documents — this check measures that gap, it does not close it.
- **Storage references.** Take docs carrying `storagePath` or download URLs
  (past papers, assessment exports, branding) and confirm the objects still
  exist. **Cloud Storage is not covered by this export** (DR-003).
- **Provider state.** Do **not** treat restored `payments`/entitlement rows as
  authoritative. Reconcile from Lenco and Google Play through the existing paths
  (Till, `verifyGooglePlayPurchase`) — a restored snapshot lags live provider
  state by up to the RPO.

Index-dependent queries will not work in the scratch DB until indexes are
deployed there (`firestore.indexes.json` is not part of the export). Deploy them
if a query-driven view is being validated; otherwise note it and move on.

### A.5 Record the evidence, then delete the scratch database

Fill this in and attach it to the DR ticket **and** to
`docs/production-readiness/remediation/dr-001-infrastructure-readiness.md`.
The 2026-07-22 drill recorded the count, the RTO and the verdict but not the
operation names or per-collection counts; this template exists so the next one
does.

```text
Source export prefix:      gs://zedexams-backups/firestore-exports/<DATE>
Metadata object present:   yes / no
Export operation:          <name>
Scratch database:          <name>            (location africa-south1)
Import operation:          <name>            done: true / error
Pre-drill production counts (captured before import):
  payments / invoices / subscriptionEvents / users / assessments / quizzes /
  results / exam_attempts / scores / classRegisters / aiGenerations / pastPapers
Restored counts (same order):
Total documents restored:                    (2026-07-22 baseline: 27,192)
Subcollections verified:   assessments/questions: y/n   quizzes/questions: y/n
                           classRegisters/attendance: y/n
Auth references checked:   <n of m uids resolved>
Storage references checked:<n of m objects present>
Provider reconciliation:   noted as required / performed
Drill start (UTC / Lusaka):
Import start / complete:
Validation complete:
Measured RTO:                                (2026-07-22 baseline: 25m50s)
No data imported into (default): confirm
Scratch database deleted:  confirm
Result:                    PASS / FAIL
```

```bash
# Abort or finish — a scratch database left running is both a cost and a
# future reader's ambiguity about whether a restore is still in progress.
gcloud firestore databases delete --database="$SCRATCH" --project="$PROJECT"
```

---

## Appendix — status taxonomy (`opsBackups/{date}.status`)
| status | meaning | alert |
|---|---|---|
| `started` | export operation accepted (async completion) | no |
| `failed` | Admin API rejected the export | error |
| `misconfigured` | production runtime, no valid bucket | error |
| `skipped-non-production` | dev/emulator, no bucket (expected) | no |
