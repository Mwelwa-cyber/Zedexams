# 14 — Backup & Disaster Recovery

> Snapshot as of 2026-07-19. Layer 16. Finding IDs: `DR-*`.

> ## ⚠️ READ FIRST — this document's DR-001 verdict is SUPERSEDED (2026-08-01)
> Everything below describes the **pre-provisioning** state, including the
> summary and the "effective RPO = total loss" verdict. Since it was written:
> - `FIRESTORE_BACKUP_BUCKET=gs://zedexams-backups` is **set** (#1802);
> - the bucket, IAM, 7-day **PITR** and **deletion protection** were provisioned
>   **2026-07-19**;
> - a **real managed export** was observed, and a **restore drill PASSED
>   2026-07-22** — 27,192 documents restored into a scratch database, measured
>   **RTO 25m50s**.
>
> **The Firestore restore path is proven and does NOT need re-running.** The
> authoritative, current record is
> [`remediation/dr-001-infrastructure-readiness.md`](./remediation/dr-001-infrastructure-readiness.md)
> — read it before acting on anything here. Per its §10 the genuinely open items
> are: a DOCX runtime test (SEC-007), a dedicated least-privileged backup service
> account, and the **Firebase Auth + Cloud Storage + provider-reconciliation** DR
> gaps that the Firestore export does not cover.

> **Remediation status (this PR) — Implemented, pending runtime verification:**
> the *code-side* gaps are fixed. The runner now distinguishes **`misconfigured`**
> (production, no bucket → **error alert**) from **`skipped-non-production`**
> (dev/emulator → silent), emits **structured logs with a correlationId**, and
> records `started`/`failed` with an error category (DR-005). A tested retention
> selector (`selectExportsToDelete`, never deletes the newest/incomplete) + dry-run
> runner, a tested `buildImportRequest`, a guarded `scripts/restore-firestore.mjs`,
> and the canonical [`runbooks/firestore-restore.md`](./runbooks/firestore-restore.md)
> now exist (DR-002). The remaining work is **operator config that code cannot do**:
> bucket + IAM, `FIRESTORE_BACKUP_BUCKET`, PITR/deletion-protection, and a
> **restore drill**. Until then, DR-001 is **not closed** — but a misconfigured
> production backup is now loud, not silent. See
> [`remediation/tier-0-remediation-report.md`](./remediation/tier-0-remediation-report.md).

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
  `functions/.env.examsprepzambia`.
- **⚠️ SUPERSEDED (2026-08-01):** the "no `FIRESTORE_BACKUP_BUCKET`" finding below was true when
  this audit was written and is **no longer accurate** — the bucket variable is set, and the export
  **and** restore drill have both since passed. See the banner at the top of this document and the
  authoritative record in
  [`remediation/dr-001-infrastructure-readiness.md`](./remediation/dr-001-infrastructure-readiness.md).
  Do **not** schedule a restore drill on the strength of the paragraphs below.
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

> **Update 2026-07-19:** the daily export is now **runtime-verified** — a managed export reached
> `done:true` with a `.overall_export_metadata` object at
> `gs://zedexams-backups/firestore-exports/2026-07-19`
> (evidence: [`remediation/dr-001-infrastructure-readiness.md`](./remediation/dr-001-infrastructure-readiness.md) §12).
> A later same-UTC-date scheduled run overwrote `opsBackups/2026-07-19.status` to `failed` — a benign
> duplicate-date artifact, tracked as **DR-007** (de-collide same-day exports) and **now fixed in code**
> (immutable per-run record + ownership lease + monotonic summary + async completion checker — see
> [DR-007](#dr-007--same-utc-date-export-collision-could-downgrade-a-good-summary--fixed-in-this-pr)).
> Interim finding status: **"Backup export runtime-verified; restore drill pending."** The restore
> drill is the next gate.

### DR-002 — Restore script + runbook ✅ rehearsal PASSED (2026-07-22)
- **Severity:** High → Low (residual) · **Confidence:** High confidence
- **Fixed here:** `scripts/restore-firestore.mjs` (dry-run by default, `--live` guarded, refuses
  a blind `(default)` overwrite) drives `importDocuments` via the tested
  `buildImportRequest` (`firestoreBackupCore.js`, covered by `firestoreBackup.test.js`); the
  step-by-step **Runbook** below documents setup + restore-to-scratch.
- **Rehearsal — PASSED (operator, 2026-07-22):** a real restore into a non-production scratch
  database restored **27,192 documents** with a measured **RTO of 25m50s**; no data was imported into
  `(default)`, and the scratch DB was deleted afterwards. Evidence:
  [`remediation/dr-001-infrastructure-readiness.md`](./remediation/dr-001-infrastructure-readiness.md) §13.
  The restore path is now proven and does **not** need re-running. **Residual:** none for the Firestore
  restore itself; cross-DR gaps (Auth/Storage/provider reconciliation) are tracked under DR-001/DR-003.

### DR-003 — No Firebase Storage backup ✅ monitor + runbook added in this PR (mirror still operator-provisioned)
- **Severity:** Medium–High → Medium (residual) · **Confidence:** High confidence
- **Affected:** the Firestore export covers Firestore only; generated images, uploads, exports and past
  papers in the Storage bucket had no backup and no verification.
- **Risk:** Storage loss (accidental/malicious) is unrecoverable.
- **Architecture:** the cross-region **copy** belongs in **Storage Transfer Service (STS)** — a managed,
  scheduled bucket-to-bucket mirror — not a Cloud Function copying the whole bucket daily (cost /
  timeouts / scale). Like DR-001's bucket + IAM, the mirror is **operator-provisioned once**; what code
  adds is what closes the real risk — making the mirror **verifiable**.
- **Added here** (`functions/storageBackup.js` + `storageBackupCore.js` +
  `storageBackupHeartbeatCore.js`): a daily **health check** `storageBackupCheck` (04:00 Africa/Lusaka)
  recording `opsStorageBackups/{date}` with status **`fresh` / `stale` / `empty` /
  `heartbeat-writer-stopped` / `awaiting-heartbeat` / `misconfigured` / `error`**, raising an **ops
  alert** when the mirror is absent, has never run, or has **stopped**. A silently-broken Storage backup
  now surfaces the next morning instead of at disaster time. Deploy-safe before the mirror exists
  (records `misconfigured` in prod / `skipped-non-production` in dev).
  It originally read the *newest object* in the backup bucket and aged it against
  `STORAGE_BACKUP_MAX_AGE_HOURS` (then 26h). Both halves of that were wrong and are corrected below —
  the signal (a fact about the source's activity, not the mirror's) and the threshold (calibrated for
  the signal it no longer uses).
- **Operator setup still owed** (see Runbook §D): steps 1–3 are now one re-runnable, dry-run-by-default
  script — `npm run provision:storage-backup` (versioning on the primary; a cross-region backup bucket
  with versioning + a non-current-versions-only lifecycle rule; the daily STS job plus every IAM binding
  it and the health check need). Then (4) uncomment `STORAGE_BACKUP_BUCKET` in
  `functions/.env.examsprepzambia` and deploy. Leave `STORAGE_BACKUP_MAX_AGE_HOURS` unset — its default
  is derived from the cron schedule (see below), so overriding it means re-deriving it.
- **Freshness is PROVED by a heartbeat, not inferred from bucket activity.** The check originally asked
  "is the newest object in the backup recent?" and treated that as "did the mirror run?". Those are
  different questions. The transfer runs `--overwrite-when=different`, so a night in which nothing in
  the source changed correctly copies **nothing** — no destination object is written, the newest one
  keeps ageing, and once it crosses the threshold the check emails `stale` about a mirror that is
  provably perfect. Not theoretical: this project's source bucket routinely goes 16–17 quiet hours and
  was observed past the 26h default on its first day of operation. It also fails **asymmetrically** —
  right after provisioning everything has just been copied, so the first check reads `fresh` and gives
  the operator a false all-clear before the lying `stale` arrives a day or two later.
  So `storageBackupHeartbeat` (23:30 UTC) overwrites one small object at a fixed path in the primary
  bucket, an hour before the 00:30 UTC transfer. An overwrite is a change, so the mirror **must** carry
  it, and the check reads that object's mtime in the *backup* — proof the transfer ran end to end,
  rather than a job's report about itself. Write → transfer → check; the ordering is the design.
  Two consequences worth knowing: the check is now O(1) (one object, one metadata read — the paging and
  truncation machinery is gone), and reading the heartbeat on **both** sides separates "our writer never
  ran" (`awaiting-heartbeat`, a warning, and exactly what a first night after deploy looks like) from
  "the mirror is broken" (`empty`/`stale`, an error). A brand-new deploy must not page.
- **The staleness threshold is derived from the schedule, not inherited.** `STORAGE_BACKUP_MAX_AGE_HOURS`
  defaults to **12**, and briefly did not: it stayed at 26 from the previous design, where freshness came
  from source-object churn and a healthy age sat just under 24h. Under the heartbeat a healthy age is
  ~1.5h (written 23:30, mirrored ~00:33, checked 02:00) and **one missed transfer reads 25.45h** — so 26
  called a missed night `fresh`, by 33 minutes, and `stale` did not arrive until the *second* missed
  night at ~49h. The number had not moved when its meaning did. The age signal is bimodal — either the
  transfer landed before the check (≤1.5h) or the newest copy is the previous day's (~25.5h) — so the
  threshold's only job is to cut that gap; 12 sits ~8× above one and ~2× below the other.
  Two guards against a repeat. First, `lagMs` (how far the backup trails the *source*) **votes on the
  verdict** alongside age — it is schedule-independent, so a mis-tuned age ceiling can no longer disable
  detection on its own. That only works because the two are compared against **separate constants**
  (`DEFAULT_MAX_LAG_HOURS` = 6): `lagMs ≤ ageMs` always, since the primary heartbeat is a past write, so
  a *shared* threshold makes `lag > T` imply `age > T`, the lag branch unreachable, and the `||` collapse
  silently back to the age test. That was the state of the code for one commit — lag "voting" while
  provably unable to fire. A separate constant is safe because healthy lag is not merely small but
  **exactly zero** every night (the copy is written after the write it carries); only scheduler jitter
  pushing the 23:30 write past the transfer lifts it, and that tops out ~1.5h.
  Second, `test:storage-backup-heartbeat` *computes* the edge from the cron times rather than asserting a
  remembered constant, and re-runs a missed night with the age ceiling deliberately mis-tuned to 26h (and
  to 1000h) to prove lag still catches it. Asserting that both signals exceed a shared threshold would
  have **documented** the coupling rather than caught it.
  The constraint no threshold relaxes: the transfer must finish before the 02:00 check (a 1.5h budget;
  it currently takes ~3 minutes). If that ever tightens, move the **check** later — raising the threshold
  past ~25.4h re-hides a missed night. ~25.4h is a hard ceiling rather than a tuning preference, because
  a transfer *still running* at 02:00 and one that *never ran* both leave yesterday's copy as the newest
  and so produce the same age (~25.5h vs ~25.45h); no age threshold can separate them.
- **Known, accepted:** that indistinguishability means a slow-but-running transfer pages as `stale` and
  points at a transfer job that is healthy and mid-flight — the same misdirection `heartbeat-writer-stopped`
  removes on the other axis. Only STS operation state separates those two, which this design deliberately
  does not read (the whole point is to verify the mirror end-to-end rather than trust a job's report about
  itself). At a ~3-minute runtime this is theoretical; the lever if it stops being theoretical is moving
  the check later, not raising the ceiling.
- **The one path with a single detector is bounded at runtime.** The two-signal defence above is
  asymmetric: a missed night is caught by age **or** lag, but `heartbeat-writer-stopped` is *defined* by
  lag being zero, so age is its only signal and no second one is available by construction. That made it
  depend on the age ceiling — the constant this subsystem has already been wrong about once — and it was
  protected only *incidentally*, by a test assertion written to keep the missed-night threshold sane.
  Worse, that assertion bounded `DEFAULT_MAX_AGE_HOURS` and said nothing about
  `STORAGE_BACKUP_MAX_AGE_HOURS`, which is parsed straight from the environment: `=1000` reached
  production unchecked and would report a writer dead for four days as `fresh` at age 97h.
  `resolveMaxAgeMs` now **clamps to `MAX_SAFE_AGE_HOURS` (24)**, under the ~25.4h cliff. Tightening below
  the default still works — it is a ceiling, not an override — and the value actually used is recorded as
  `maxAgeHours` on the status doc, so a clamped 1000 reads back as 24. The detector is also pinned by its
  own assertions now, exercised through the runtime resolver rather than the constant.
- **A stopped writer is no longer reported as a stopped mirror.** An old heartbeat whose backup copy is
  *level with it* means our own 23:30 cron stopped while the transfer kept working →
  `heartbeat-writer-stopped`, naming that function and its Cloud Scheduler job. It previously read
  `stale` and sent the reader to debug a transfer job that was perfectly healthy.
- **Launch blocker:** No (but High until the mirror is provisioned). **Complexity:** Low–Medium.

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

### DR-006 — Secrets recovery / escrow undocumented; PITR only suggested ✅ recovery runbook added
- **Severity:** Low–Medium → Low (residual) · **Confidence:** Moderate confidence
- **Was:** secrets lived only in Functions secrets / GitHub Actions secrets / the Android keystore —
  no documented inventory, source-of-truth, escrow, or recovery procedure. PITR only in a code comment.
- **Added here:** [`runbooks/secrets-recovery.md`](./runbooks/secrets-recovery.md) — a full inventory
  of all 13 Functions secrets + the GitHub Actions/deploy secrets + the Android keystore, each with its
  source-of-truth console, blast radius, and a no-downtime rotate/recover procedure. Key points: Firebase
  Functions secrets are backed by **GCP Secret Manager** (versioned — the runtime values aren't lost
  unless the project is), so the real work is **escrow** of the provider-side credentials in the team
  password manager; and the **Android signing keystore is the one irreplaceable secret** — the runbook's
  top action is confirming **Play App Signing is enabled** (which makes a lost upload key recoverable via
  Play support) and escrowing the keystore + fingerprint offline.
- **Residual (operator, not code):** enable PITR (`gcloud firestore databases update --enable-pitr`);
  populate the password-manager escrow vault; run the recovery drill once. **Launch blocker:** No.

### DR-007 — Same-UTC-date export collision could downgrade a good summary ✅ fixed in this PR
- **Severity:** Low (integrity of the monitoring signal, not of the data) · **Confidence:** High confidence
- **Was:** a manual export and the scheduled export can share a UTC date-key. Both wrote the single
  `opsBackups/{date}` summary; the second run — failing against an already-populated destination —
  could **downgrade a good `started` summary to `failed`**, making a healthy backup day read as broken
  (observed on 2026-07-19). The underlying exports were fine; the *signal* was corrupted.
- **Fixed here** (`firestoreBackup.js` + `firestoreBackupCore.js`, 68 tests):
  1. **Immutable per-execution record** at `opsBackupRuns/{correlationId}` — one write-once doc per run,
     so a duplicate never clobbers another run's record (tamper-evident audit trail).
  2. **Transactional lease** — `decideBackupOwnership` lets only ONE run own a date; a second run for a
     date that already shows a valid (`started`/`completed`) export is **`duplicate-skipped`**, a
     distinct status, **never `failed`**, and it does not touch the daily summary.
  3. **Owner-guarded + monotonic daily summary** — a non-owning run can't write the summary, and a
     later duplicate's `failed` can never downgrade a `started`/`completed` (`shouldWriteDailyStatus`).
     The owning run *can* still record its own acceptance failure (the monotonic guard is scoped to
     non-owner writes, so it doesn't trap the owner behind the transient `in_progress` rank).
  4. **Async completion checker** (`backupCompletionCheck`, scheduled 03:30 Africa/Lusaka) flips a
     `started` summary to **`completed: true`** once the long-running export finishes, or records a real
     post-acceptance failure (authoritatively, `force`) — so the DR floor is verified unattended.
  5. **Stale IAM guidance corrected** — the file/alert no longer flatly tell operators to grant
     `roles/storage.objectAdmin` to the runtime SA; the managed export's write goes through the
     Firestore service agent, so that broad grant is requested only if a write is actually denied.
- **Runtime confirmation still owed (read-only):** after the next clean unattended cron — **2026-07-21
  01:30 Africa/Lusaka**, which stamps **UTC date-key `2026-07-20`** — read `opsBackups/2026-07-20`
  (expect `status:"started"` then `completed:true` after 03:30) and confirm a matching
  `opsBackupRuns/{correlationId}`. This is evidence of *unattended operation*; it does **not** replace
  the successful-export evidence already recorded for 2026-07-19. **Launch blocker:** No.

## Computed RPO / RTO (from evidence)
- **Measured (2026-07-22):** **RPO ≤ 24h** (daily export; ≤ minutes with PITR once enabled) and
  **RTO ≈ 26m** (the restore drill restored 27,192 docs in **25m50s** — DR-002/§13). These are now
  evidence-backed, not projected. RTO will scale with database size; re-measure after major growth.
- **Historical (pre-remediation):** RPO ≈ ∞ / total loss (no export ran); RTO undefined (no restore path).

## Runbook

> The full, canonical setup + restore runbook now lives at
> [`runbooks/firestore-restore.md`](./runbooks/firestore-restore.md) (referenced by
> the code and `scripts/restore-firestore.mjs`). The condensed steps below are a
> quick reference; the runbook is authoritative.

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

### D. Storage backup mirror (operator — turns the Storage half ON) — DR-003
> Backs up the Storage bucket (generated images, uploads, exports, past papers).
> The daily `storageBackupCheck` (04:00 Lusaka) only VERIFIES this mirror — it
> does not create it. Until these steps are done it records `misconfigured` and
> emails an alert every morning.
**Steps 1–3 are one script** — `scripts/provision-storage-backup.mjs`, dry-run by
default and re-runnable (a step whose resource already exists reports *already
done*, not an error):

```bash
npm run provision:storage-backup              # prints every gcloud command, runs nothing
npm run provision:storage-backup -- --live    # provisions
```

It needs `gcloud` authenticated as a principal holding `roles/storage.admin` +
`roles/storagetransfer.admin` + `roles/serviceusage.serviceUsageAdmin`. What it
does, and why each piece is there:

1. **Enable Object Versioning** on the primary bucket (protects individual objects
   from overwrite/delete) **and apply its expiry rule in the same run** — the two
   are one decision. Versioning alone means every delete on the primary leaves a
   noncurrent version billed forever, and this repo deletes constantly:
   `tmpDownloadReaper` sweeps `tmp-downloads/` hourly *specifically* so that
   prefix "can never grow unbounded", plus `orphanReaper` and the
   lesson/question/user cascade triggers. Versioning without a lifecycle rule
   silently converts every one of those reclaims into permanent storage.
2. **Create a cross-region backup bucket** — the primary is in `africa-south1`, so
   a backup there shares its blast radius. Uniform bucket-level access,
   public-access prevention, versioning, and the same lifecycle rule.
   Both buckets' rules expire **non-current versions only** (never live objects —
   a rule that expires live objects would delete the app's images on the primary
   and quietly empty the mirror on the backup) and are keyed on
   **`daysSinceNoncurrentTime` alone**. Lifecycle conditions AND together, so
   adding `numNewerVersions` would exempt every *deleted* object — which has zero
   newer versions — from expiry entirely, defeating the rule on exactly the path
   that generates the most garbage. `tmp-downloads/` gets a 1-day window instead
   of 30: those objects live ~90 seconds by design and have no recovery value.
3. **Create a Storage Transfer Service job** (source = primary, destination =
   backup, **daily**, `--overwrite-when=different`, never `--delete-from`: a
   mirror that propagates a source delete is not a backup). Grant the STS service
   agent `roles/storage.objectViewer` **+ `roles/storage.legacyBucketReader`** on
   the source and `roles/storage.objectAdmin` **+ `roles/storage.legacyBucketWriter`**
   on the destination — the object roles carry no `storage.buckets.get`, and
   omitting the legacy pair is the classic "job created fine, every run fails
   `PERMISSION_DENIED`". The script also grants the **Functions runtime SA**
   `objectViewer` on the destination, without which the health check reads
   `error` forever — indistinguishable from a genuinely broken mirror. Scheduled
   00:30 UTC (02:30 Lusaka) so it finishes before the 04:00 Lusaka check.
4. **Set the env** in `functions/.env.examsprepzambia` (a commented stub is
   already there — uncomment it) and deploy functions:
   `STORAGE_BACKUP_BUCKET=gs://zedexams-storage-backup`. Leave it unset until the
   bucket exists — pointing the check at a bucket that isn't there swaps one true
   alert for a misleading one. `STORAGE_BACKUP_MAX_AGE_HOURS` should also stay
   unset: its default (12) is derived from the cron schedule, and the derivation
   is what makes it correct.
4b. **First-run gotcha.** Enabling the API does **not** create the STS service agent — it is
   materialised lazily, and until then every IAM binding naming it fails with *"Service account
   project-N@storage-transfer-service.iam.gserviceaccount.com does not exist"* (this took out five of
   twelve steps on the first real run). The script now forces creation with a read-only `GET` on
   `storagetransfer.googleapis.com/v1/googleServiceAccounts/<project>`, passing `x-goog-user-project`
   so the call isn't billed to the caller's own project and 403'd.
5. **Verify**: after 04:00 Lusaka read `opsStorageBackups/{today}` — `status` must
   be `"fresh"` (not `misconfigured` / `awaiting-heartbeat` / `heartbeat-writer-stopped` / `empty` / `stale`).
   `heartbeatWrittenAt` and `heartbeatMirroredAt` show both sides, and
   `mirrorLagHours` is how far the backup trails the source — worth watching as it
   climbs, since that is the number that turns into a real `stale`.
   **On the first night only**, `awaiting-heartbeat` is expected: the heartbeat is
   written at 23:30 UTC and carried by the 00:30 UTC transfer, so a deploy landing
   after 23:30 has nothing to verify against until the following day. It warns
   rather than paging, for exactly that reason.
6. **Restore from the mirror** (disaster): copy objects back with
   `gsutil -m rsync -r gs://zedexams-storage-backup gs://examsprepzambia.firebasestorage.app`
   (or restore selected prefixes). Versioning on the primary lets you recover an
   individual overwritten/deleted object without the mirror.

## Cross-references
- Hard deletes amplify this: [`05-data-and-firestore.md`](./05-data-and-firestore.md) DATA-004.
- Account-deletion irreversibility: [`15-privacy-legal-and-compliance.md`](./15-privacy-legal-and-compliance.md) LEGAL-003.
