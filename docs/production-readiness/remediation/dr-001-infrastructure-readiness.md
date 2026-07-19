# DR-001 — Firestore Backup & Disaster Recovery — Infrastructure-Readiness Record

> **Status: Implemented, pending runtime verification** (NOT "Verified in
> staging"; NOT "Closed").
>
> Session date: 2026-07-19 · Environment: Google Cloud Console / Cloud Shell ·
> **Authenticated operator: authorised ZedExams project administrator.**
>
> This record captures the operator-side GCP infrastructure provisioned for
> DR-001, alongside the repo-side code + runbook corrections. It is the
> evidence base for a later move to "Verified in staging" (which requires a
> successful export **and** a non-production restore drill) and eventual
> closure (which additionally requires the Auth + Storage DR gaps addressed).

---

## 1. Project and database
- Project ID: `examsprepzambia` · Project number: `325628669031`
- Firestore DB: `(default)` · type `FIRESTORE_NATIVE` · location **africa-south1**

## 2. Backup bucket
- `gs://zedexams-backups` — location **AFRICA-SOUTH1** (regional), class STANDARD
- Uniform bucket-level access: enabled · Object versioning: enabled ·
  Requester Pays: disabled
- Lifecycle rule: **not configured** (deliberately deferred — no deletion rule
  in this phase)
- Public access: no `allUsers` / `allAuthenticatedUsers` binding
- Created 2026-07-19 ~21:11 GMT
- ⚠️ Bucket exists and is correctly configured, but **no successful Firestore
  export has been written yet** — it is currently empty of export data.

## 3. IAM verification
- Runtime service account (Compute default): project roles `roles/editor`,
  `roles/eventarc.eventReceiver`, `roles/recaptchaenterprise.agent`.
  `roles/editor` already grants the Firestore export permission, so the proposed
  `roles/datastore.importExportAdmin` binding was **not** added (redundant).
- Firestore service agent holds `roles/firestore.serviceAgent`, which includes
  `storage.buckets.get` + `storage.objects.{create,get,list,delete}` (verified
  by direct role-permission enumeration) across project buckets including
  `gs://zedexams-backups`; no extra bucket-level `roles/storage.admin` added.
- No project IAM **deny** policy found. Org-policy + IAM Policy Troubleshooter
  APIs left disabled; effective access verified via direct role-permission
  enumeration + deny-policy inspection.
- **Follow-up (recorded, not done):** replace the default Compute runtime
  account with a dedicated least-privileged backup service account (export +
  Firestore status-record + logging only).

## 4. Scheduler and function region
- Functions deployed in **us-central1**: `dailyFirestoreBackup`,
  `extractAssessmentFormat`.
- Scheduler job `firebase-schedule-dailyFirestoreBackup-us-central1`
  (location us-central1), `every day 01:30`, TZ `Africa/Lusaka`, **ENABLED**,
  targeting `dailyFirestoreBackup` (us-central1).
- **Region split (intentional):** functions + Scheduler in us-central1; DB +
  bucket in africa-south1. Moving functions to africa-south1 is a **separate
  architecture task** and was not performed. The runbook
  (`runbooks/firestore-restore.md`) has been corrected to use us-central1 for
  function/Scheduler commands and to note the **UTC date-key** (01:30
  Africa/Lusaka = 23:30 UTC previous calendar day → export folder is the prior
  UTC date).

## 5. Database deletion protection
- Before `DELETE_PROTECTION_DISABLED` → after **`DELETE_PROTECTION_ENABLED`**
  (operation done, no error).
- Scope: prevents deletion of the entire database resource; does **not** prevent
  document/collection deletion, corruption, or faulty/malicious writes.

## 6. Point-in-time recovery (PITR)
- Before disabled (3600s) → after **ENABLED, retention 604800s (7 days)**,
  earliest version time `2026-07-19T20:36:00Z` (operation done, no error).
- Not retroactive: the full 7-day window is available only after 7 days of
  continuous operation.

## 7. Production environment value
- Intended + now committed: `FIRESTORE_BACKUP_BUCKET=gs://zedexams-backups` in
  `functions/.env.examsprepzambia` (non-secret config, auto-loaded on deploy;
  no service-account key committed). Confirm on the deployed function per
  runbook §1.4.

## 8. Repo-side follow-ups delivered in the accompanying PR
- **Restore script fixed** — `scripts/restore-firestore.mjs` now resolves
  `@google-cloud/firestore` (a functions/ dependency) via a functions-anchored
  `createRequire`, fixing the `--live` `ERR_MODULE_NOT_FOUND`. Refactored into
  testable `parseArgs`/`planRestore`/`executeRestore` (injectable Admin loader)
  behind a main-guard; **16 tests** cover dry run, scratch request, default-db
  refusal, live client construction, and failed startup.
- **DOCX guard moved before decompression on every path** — a shared
  `functions/teacherTools/docxArchiveInspect.js` runs the pure archive guard on
  central-directory metadata BEFORE `mammoth` (text, `pastPaperImport.js`) or
  `adm-zip` (images, `extractAssessmentFormat.js`) decompresses anything.
- **Runbook regions + UTC date-key corrected**; `FIRESTORE_BACKUP_BUCKET` wired
  into the committed env.

## 9. Changes deliberately NOT performed
No Cloud Functions deployment; no repository env deploy; no export triggered; no
successful export verified; no bucket lifecycle deletion rule; no restore drill;
no DOCX production test; no function-region migration; no new IAM grants beyond
those noted; no APIs enabled; no production data changed; no production restore.

## 10. Remaining blockers (to reach "Verified in staging" / "Closed")
1. Deploy the corrected functions (via CI) and confirm the function receives
   `FIRESTORE_BACKUP_BUCKET`.
2. Trigger/observe a real managed export; confirm the operation reaches
   `done: true`.
3. Confirm the bucket contains the expected `.overall_export_metadata` object.
4. Complete a restore drill into a **non-production** scratch database.
5. Validate restored collections, Auth references, Storage references, and
   record the measured RTO.
6. Run a valid DOCX through the deployed admin-only workflow (SEC-007 runtime
   check).
7. Replace the default runtime SA with a dedicated least-privileged backup SA.
8. Separately document/remediate the **Firebase Auth** and **Cloud Storage** DR
   gaps (not covered by the Firestore export).

## 11. Closure criteria
- Remain **"Implemented, pending runtime verification"** until items 1–6 above
  are evidenced.
- May move to **"Verified in staging"** only after a successful export AND a
  non-production restore drill are evidenced.
- May be **"Closed"** only after that evidence is reviewed AND the Auth + Storage
  DR gaps are separately documented or remediated.
