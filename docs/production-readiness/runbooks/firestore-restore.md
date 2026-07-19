# Runbook — Firestore Backup & Restore (DR-001)

> Snapshot as of 2026-07-19. Owner: platform/reliability. Companion code:
> `functions/firestoreBackup.js`, `functions/firestoreBackupCore.js`,
> `scripts/restore-firestore.mjs`. Audit finding: [`../14-backup-and-disaster-recovery.md`](../14-backup-and-disaster-recovery.md).

This runbook turns the daily export **on** and documents a **non-destructive,
rehearsable restore**. Nothing here should be run against production data
without the explicit go/no-go step called out below. **Do not perform a
destructive production restore as part of a drill.**

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
`FIRESTORE_BACKUP_BUCKET` is **non-secret config** — it belongs in the
committed per-project env file, not Secret Manager:

```
# functions/.env.examsprepzambia
FIRESTORE_BACKUP_BUCKET=gs://zedexams-backups
```

Deploy functions via the normal CI path (`deploy-firebase.yml`). Do **not**
commit any service-account key.

### 1.5 Enable PITR + deletion protection
```bash
gcloud firestore databases update --database='(default)' --enable-pitr
gcloud firestore databases update --database='(default)' --delete-protection
```

### 1.6 Verify backups are running
After the next 01:30 Africa/Lusaka run (or trigger manually), confirm:
- Firestore `opsBackups/{today}`.`status` == **`started`** (not
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

## Appendix — status taxonomy (`opsBackups/{date}.status`)
| status | meaning | alert |
|---|---|---|
| `started` | export operation accepted (async completion) | no |
| `failed` | Admin API rejected the export | error |
| `misconfigured` | production runtime, no valid bucket | error |
| `skipped-non-production` | dev/emulator, no bucket (expected) | no |
