# 14 — Backup & Disaster Recovery

> Snapshot as of 2026-07-19. Layer 16. Finding IDs: `DR-*`.

> **Remediation status (this PR):** the *code-side* gaps are now fixed —
> the unconfigured-backup path **alerts** instead of silently skipping (DR-005),
> a **tested restore-request builder** (`buildImportRequest`) + a guarded
> **restore script** (`scripts/restore-firestore.mjs`) + the **runbook** below
> now exist (DR-002). The remaining work is **operator config that code cannot
> do**: create the cross-region bucket + IAM, set `FIRESTORE_BACKUP_BUCKET`,
> enable PITR/deletion-protection, and **rehearse a restore**. Until those land,
> DR-001 is still open — but a misconfigured backup is now loud, not silent.

## Verdict

**This is the weakest layer and the source of the single most dangerous finding.** A daily
Firestore export function *exists and is well-written*, but it is **gated on an env var that is
not set in the committed config**, so it records `skipped-unconfigured` and exports nothing. There
is no restore script, no restore test, no Storage backup, no deletion protection, and the skip is
not surfaced in any health dashboard. **Do not assume Firebase provides backups — it does not by
default.** Until this is fixed and a restore is rehearsed, effective RPO is total loss and RTO is
undefined.

## Findings

### DR-001 — Firestore backups are almost certainly not running
- **Severity:** Critical · **Confidence:** High confidence (config) / Requires runtime verification (prod env)
- **Affected:** `functions/firestoreBackup.js:68-77`, `functions/index.js:2994-2998`,
  `functions/.env.examsprepzambia` (verified: **no `FIRESTORE_BACKUP_BUCKET`**).
- **Current behaviour:** `dailyFirestoreBackup` runs `onSchedule("every day 01:30")`, but
  `resolveBackupBucket(env.FIRESTORE_BACKUP_BUCKET)` returns falsy when the var is unset → the run
  writes `opsBackups/{date} = {status:"skipped-unconfigured"}` and returns **without exporting**.
  The var is not in the committed non-secret env file where it belongs, and nothing in-repo binds it.
- **Risk:** No disaster-recovery floor. A bad migration, ransomware/compromised-admin, accidental
  bulk delete, or a region incident is **unrecoverable** — combined with hard deletes (DATA-004) and
  the un-re-authed account deletion (LEGAL-003), data loss is permanent.
- **Exploit/failure scenario:** An admin script or a malicious actor deletes/overwrites a collection;
  there is no export to restore from beyond whatever Firebase retains internally (nothing guaranteed).
- **Correction:** (1) Create a GCS bucket in a **different region** from `africa-south1`, with a
  retention lifecycle rule; (2) grant the function's SA `datastore.importExportAdmin` +
  `storage.objectAdmin`; (3) set `FIRESTORE_BACKUP_BUCKET` in `functions/.env.examsprepzambia`;
  (4) verify a run stamps `status:"started"` in `opsBackups/{date}`; (5) enable Firestore PITR.
- **Verification:** Read `opsBackups/{today}` in production — if `status` is `skipped-unconfigured`,
  backups are off **now**.
- **Launch blocker:** Yes. **Complexity:** Low (config + IAM). **Dependencies:** none.
- **Tests:** `firestoreBackup.test.js` covers configured/skip paths; add an alert on `skipped`.

### DR-002 — Restore script + runbook ✅ added in this PR (rehearsal still owed)
- **Severity:** High → Medium (residual) · **Confidence:** High confidence
- **Fixed here:** `scripts/restore-firestore.mjs` (dry-run by default, `--live` guarded, refuses
  a blind `(default)` overwrite) drives `importDocuments` via the tested
  `buildImportRequest` (`firestoreBackupCore.js`, covered by `firestoreBackup.test.js`); the
  step-by-step **Runbook** below documents setup + restore-to-scratch.
- **Residual:** a real **restore rehearsal** into a scratch database (which measures RTO) has not
  been performed — an untested restore is not yet a proven one. **Correction:** run the Runbook §B
  drill once and record RTO. **Launch blocker:** the *rehearsal* (with DR-001 config) before broad
  launch. **Complexity:** Medium (operator drill).

### DR-003 — No Firebase Storage backup
- **Severity:** Medium–High · **Confidence:** High confidence
- **Affected:** the export (even when configured) covers Firestore only; generated images, uploads,
  exports, past papers have no backup.
- **Risk:** Storage loss (accidental/malicious) is unrecoverable.
- **Correction:** Enable bucket versioning + a cross-region/cross-project copy (or Object Lifecycle
  with a mirror). **Launch blocker:** No (but High). **Complexity:** Low–Medium.

### DR-004 — No database deletion protection
- **Severity:** Medium · **Confidence:** Moderate confidence
- **Affected:** no evidence the Firestore database has deletion protection enabled.
- **Correction:** Enable deletion protection on the `(default)` database; restrict who holds
  `datastore.owner`. **Launch blocker:** No. **Complexity:** Trivial.

### DR-005 — Backup skip/failure alerting ✅ partially fixed in this PR
- **Severity:** Medium → Low (residual) · **Confidence:** High confidence
- **Fixed here:** `firestoreBackup.js` now raises a **warning-severity ops alert** on the
  `skipped-unconfigured` path (previously it only wrote a status doc nobody read), so a
  misconfigured backup is loud every day until fixed. The `failed` path already alerted.
- **Residual:** Marshal still doesn't fold `opsBackups` freshness into the `/admin/company`
  health verdict — a second, dashboard-level check. **Correction:** have Marshal assert a fresh
  `opsBackups/{today}.status==="started"`. **Launch blocker:** No. **Complexity:** Low.

### DR-006 — Secrets recovery / escrow undocumented; PITR only suggested
- **Severity:** Low–Medium · **Confidence:** Moderate confidence
- **Affected:** secrets live only in Functions secrets (`ANTHROPIC_API_KEY`, `LENCO_API_KEY`, SA
  JSON, keystore) — no documented backup/escrow; PITR is only mentioned in a code comment.
- **Correction:** Document secret sources + a recovery procedure; enable PITR (7-day window covers
  fat-finger deletes between daily exports). **Launch blocker:** No.

## Computed RPO / RTO (from evidence)
- **As configured today:** RPO ≈ ∞ / total loss (no export running); RTO undefined (no restore path).
- **Once DR-001 is fixed:** RPO ≤ 24h (daily export) + PITR (≤ minutes within 7 days if enabled);
  RTO still undefined until DR-002 (restore rehearsal) sets it.

## Runbook

### A. One-time setup (operator — turns backups ON)
1. **Create a backup bucket in a different region** from the `africa-south1`
   database (e.g. `europe-west1`):
   `gsutil mb -l europe-west1 gs://zedexams-backups`
2. **Lifecycle rule** to expire old exports (e.g. 30 days) so cost is bounded.
3. **Enable versioning** on the bucket (protects the exports themselves).
4. **Grant the Functions runtime service account**
   `roles/datastore.importExportAdmin` on the project and
   `roles/storage.objectAdmin` on the bucket.
5. **Set the env var** in `functions/.env.examsprepzambia`:
   `FIRESTORE_BACKUP_BUCKET=gs://zedexams-backups` and deploy functions.
6. **Enable PITR** (7-day fine-grained recovery):
   `gcloud firestore databases update --database='(default)' --enable-pitr`
7. **Enable deletion protection**:
   `gcloud firestore databases update --database='(default)' --delete-protection`
8. **Verify**: after 01:30 Lusaka, read `opsBackups/{today}` — `status` must be
   `"started"` (not `"skipped-unconfigured"` — which now also emails an alert).

### B. Restore (disaster recovery — code path is tested)
> Restore is a **merge-by-overwrite**, not a clean replace. **Always restore
> into a fresh scratch database first**, validate, then reconcile.
1. Pick the export day (`YYYY-MM-DD`) from the backup bucket.
2. Dry-run to see the exact request:
   `node scripts/restore-firestore.mjs --date=2026-07-18`
3. Create a scratch database and restore into it:
   `gcloud firestore databases create --database=restore-20260718 --location=africa-south1`
   `node scripts/restore-firestore.mjs --date=2026-07-18 --database=restore-20260718 --live`
4. Track: `gcloud firestore operations list`. Validate row counts + spot-check
   critical collections (`users`, `payments`, `results`).
5. Only then decide how to promote/reconcile with production. Importing straight
   into `(default)` requires the explicit
   `--i-understand-this-overwrites-production` flag.
6. **Record the measured RTO** from this drill (this closes the RTO gap).

## Cross-references
- Hard deletes amplify this: [`05-data-and-firestore.md`](./05-data-and-firestore.md) DATA-004.
- Account-deletion irreversibility: [`15-privacy-legal-and-compliance.md`](./15-privacy-legal-and-compliance.md) LEGAL-003.
