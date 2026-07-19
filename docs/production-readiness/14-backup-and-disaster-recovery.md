# 14 — Backup & Disaster Recovery

> Snapshot as of 2026-07-19. Layer 16. Finding IDs: `DR-*`.

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

### DR-002 — No restore script, runbook, or restore test
- **Severity:** High · **Confidence:** High confidence
- **Affected:** `scripts/` has no `restore-*`; no runbook.
- **Current:** Even once exports run, there is no documented/tested path to import them back. An
  untested restore is not a proven backup.
- **Correction:** Write + rehearse a restore runbook (import to a scratch project, validate row
  counts, then to prod). Record RTO from the drill. **Launch blocker:** Yes (a backup you can't
  restore is not a backup). **Complexity:** Medium.

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

### DR-005 — Backup skip/failure not monitored by Marshal
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `grep opsBackups` hits only `index.js` + `firestoreBackup.*`, not `marshal.js`. A
  `skipped-unconfigured` (or `failed`) run does not surface in the `/admin/company` health verdict;
  failures alert only via best-effort email (OBS-004).
- **Correction:** Have Marshal assert a fresh `opsBackups/{today}.status==="started"` and raise a
  company-health alert otherwise. **Launch blocker:** No, but pairs with DR-001. **Complexity:** Low.

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

## Cross-references
- Hard deletes amplify this: [`05-data-and-firestore.md`](./05-data-and-firestore.md) DATA-004.
- Account-deletion irreversibility: [`15-privacy-legal-and-compliance.md`](./15-privacy-legal-and-compliance.md) LEGAL-003.
