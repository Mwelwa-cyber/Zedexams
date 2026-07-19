# Tier-0 Remediation Implementation Report

> Snapshot as of 2026-07-19. Scope: **only** the two verified Tier-0 findings
> (DR-001, SEC-007) + the associated critical `websocket-driver` advisory. No
> unrelated Phase-1 work is included. Evidence is cited as `path:line`.

## Findings addressed
- **DR-001** — Firestore backups effectively disabled (`FIRESTORE_BACKUP_BUCKET`
  unset → run skipped, silently; no restore drill).
- **SEC-007** — vulnerable `adm-zip <0.6.0` reachable via DOCX processing
  (ZIP-bomb DoS); dependency audit also flagged critical `websocket-driver`.

## Root causes
- **DR-001:** `runFirestoreExport` treated *any* missing bucket as a benign
  `skipped-unconfigured` status doc with **no alert** and **no prod/dev
  distinction** (`functions/firestoreBackup.js`, pre-change lines 68-77). The
  destination is operator config that had never been set, so every daily run
  no-opped invisibly. There was also no restore tooling or runbook.
- **SEC-007:** `functions/package.json` pinned `adm-zip ^0.5.16`; the library's
  central-directory parser could be driven to a 4 GB allocation
  (`GHSA-xcpc-8h2w-3j85`). It is used in `extractAssessmentFormat.js`
  (`stageDocxImages`) to pull `word/media/*` images from an uploaded DOCX. The
  extraction had a per-entry size filter but **no archive-level guards**
  (entry count, total, ratio, traversal, encryption, magic-byte / DOCX-signature
  validation).

## Reachable attack path (SEC-007), traced
Browser (admin Assessment-Format studio) → upload to
`assessment-format-samples/{uid}/…` (Storage; `storage.rules` gate:
admin/owner write, ≤25 MB, pdf/docx MIME) **or** an existing `pastPapers`
DOCX → callable `extractAssessmentFormat` (`onCall`, `us-central1`, 1 GiB) →
`assertVerifiedAuth` + **`role === 'admin'`** (`extractAssessmentFormat.js:298`)
→ *(now)* `assertCallableRateLimit` 6/min → Anthropic format extraction (text via
**mammoth**, a separate maintained lib) → **`stageDocxImages`** downloads the
DOCX and parses it with **adm-zip** (the reachable vulnerable step) → per-image
`getData()` + Storage upload + `pictureBank` doc. **Reachability correction vs.
the first audit draft: this callable is admin-only, so the DoS is reachable only
by a platform admin, not any teacher — materially lower real severity than a
public DoS.** The dependency CVE is still patched as hygiene + defence-in-depth.

Resource-abuse points hardened: memory (buffer size cap + total-uncompressed
cap before decompression), CPU/time (entry-count + ratio caps reject bombs on
metadata), Firestore writes (image count already capped at
`MAX_IMAGES_PER_PAPER=20`), and the whole path is now rate-limited per user.

## Files changed
| File | Change |
|---|---|
| `functions/package.json` | `adm-zip ^0.5.16→^0.6.0`; add `websocket-driver ^0.7.5` override |
| `functions/package-lock.json` | regenerated (adm-zip 0.6.0, websocket-driver 0.7.5) |
| `functions/firestoreBackupCore.js` | `+isProductionRuntime`, `+classifyExportError`, `+selectExportsToDelete`, `+buildImportRequest` |
| `functions/firestoreBackup.js` | status taxonomy (`misconfigured`/`skipped-non-production`/`started`/`failed`), structured logging + correlationId, prod-vs-dev skip, `+runBackupRetention` (dry-run default, unscheduled) |
| `functions/firestoreBackup.test.js` | +env/error/retention/taxonomy assertions (46 total) |
| `functions/teacherTools/docxArchiveGuard.js` | **new** pure archive guard (magic bytes, limits, traversal, ratio, signature) |
| `functions/teacherTools/docxArchiveGuard.test.js` | **new** 25 synthetic-archive assertions |
| `functions/teacherTools/extractAssessmentFormat.js` | pre-parse + metadata gate via the guard; structured security-skip log; `+assertCallableRateLimit` |
| `functions/teacherTools/assessmentFormatExtractHelpers.js` | `+capMediaByTotalBytes` + caps (from first pass) |
| `scripts/restore-firestore.mjs` | **new** guarded restore driver (dry-run default) |
| `docs/production-readiness/runbooks/firestore-restore.md` | **new** setup + restore runbook |
| `docs/production-readiness/{13,14,16,17,18}` | evidence-based status updates |

## Dependency changes
| Package | Was | Now | Direct? | Path | Advisory |
|---|---|---|---|---|---|
| `adm-zip` | 0.5.16/0.5.18 | **0.6.0** | direct (`functions`) | `functions > adm-zip` | GHSA-xcpc-8h2w-3j85 (high) |
| `websocket-driver` | ≤0.7.4 | **0.7.5** (override) | transitive | via functions tooling | GHSA-mp7j-qc5w-4988 / GHSA-xv26-6w52-cph6 (critical) |

Root workspace `websocket-driver` was already `0.7.5` (dev-only transitive, not
in the shipped frontend bundle) — no root change needed. `adm-zip` is absent
from the root tree. Remaining advisories: root **dev-only** tooling
(firebase-tools/emulator) advisories persist and are deferred (no production
impact; documented in `../14`/`13`).

## Security controls added (SEC-007)
- Dependency bump (fixes the parse-time allocation itself).
- Magic-byte check (`looksLikeZip`) + pre-parse buffer-size cap.
- DOCX-signature validation (`[Content_Types].xml` must be present).
- Per-entry uncompressed cap, total-uncompressed cap, compression-ratio cap,
  entry-count cap, filename-length cap.
- Reject: path traversal, absolute paths, encrypted entries, duplicate names.
- Assessment runs on **central-directory metadata before any `getData()`**, so a
  bomb is rejected pre-decompression.
- Generic user-facing error (`safeUserError`); internal code logged, never shown.
- Per-user rate limit (6/min) on the callable; admin-only authz confirmed
  server-side; best-effort image staging skips (never fails the workflow) so a
  rejected archive leaves no orphaned/partial data.

## Tests added / executed
| Suite | Result |
|---|---|
| `node functions/firestoreBackup.test.js` | **46 assertions · pass** |
| `node functions/teacherTools/docxArchiveGuard.test.js` | **25 checks · pass** |
| `node functions/teacherTools/assessmentFormatExtractHelpers.test.js` | **19 checks · pass** |
| `npm --prefix functions audit --omit=dev` (before) | 1 critical + 1 high |
| `npm --prefix functions audit --omit=dev` (after) | **0 vulnerabilities** |
| `node --check` on all changed functions files | pass |

New `test:docx-archive-guard` registered in `package.json`; auto-discovered by
`test:all` (`scripts/run-all-tests.mjs`). Backup + extract tests are already
discovered. All new tests are root-install-safe (no adm-zip/firebase at load).

## CI results
Recorded on the PR after push (see final summary). Lint could not run locally
(root eslint devDeps absent); relied on CI Lint + style-matching to the
surrounding `functions/` google config (which does not enforce `max-len`).

## Runtime verification — completed vs. pending
- **Completed (local):** unit tests, dependency audit (0), syntax checks,
  pure-logic behaviour of the guard + backup classification + retention.
- **Pending (no GCP credentials in this environment):** a real backup **export**
  and a **restore drill**. The exact command sequence is in the runbook; these
  are operator steps. Per change-control, no production data was touched and no
  production restore was performed.

## Deployment requirements
1. Merge PR → CI deploys functions via `deploy-firebase.yml` (picks up the
   dependency bump + code).
2. Operator: execute runbook **Part 1** (bucket + IAM + `FIRESTORE_BACKUP_BUCKET`
   + PITR + deletion protection), then verify `opsBackups/{today}.status`.
3. Operator: execute runbook **Part 2.2–2.3** (restore drill into a scratch DB),
   capture RTO.

## Rollback procedure
- **Code:** revert this PR's commits; `deploy-firebase.yml` redeploys the prior
  functions. The dependency bump is low-risk (adm-zip API unchanged 0.5→0.6);
  if `extractAssessmentFormat` regressed, revert `functions/package*.json` +
  re-`npm install`.
- **Config:** unset `FIRESTORE_BACKUP_BUCKET` to return to the (now loud)
  skip behaviour; the retention runner is unscheduled so there is nothing
  destructive to roll back.

## Remaining risks
- **DR-001 not fully closed:** backups still require the operator setup + a
  restore drill; until then the DR floor is off (but now **alerts** daily).
- **Auth + Storage not in the Firestore export** (DR-003 + Auth export gap).
- `websocket-driver` critical was transitive; its runtime reachability in the
  callable model is low, but it is now patched regardless.
- Magic-byte validation added here is for the adm-zip image path;
  general upload magic-byte/malware scanning (STOR-003) remains Phase 2.

## Recommended next phase (Phase 1)
- Execute the backup + restore drill; add a completion-checker that stamps
  `completed:true`; have Marshal fold `opsBackups` freshness into `/admin/company`.
- Add Firebase **Auth** export/import to the DR cadence; enable Storage
  versioning + mirror (DR-003).
- Make rules-emulator + build **required** branch-protection checks (CICD-001).
- Arm the AI monthly budget + stage App Check enforcement (B3 / AI-001 / SEC-001).
