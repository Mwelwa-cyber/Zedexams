# 06 — Storage & File Security

> Snapshot as of 2026-07-19. Layer 7. Finding IDs: `STOR-*`.

## Verdict

The Storage posture is **strong**: no publicly-writable paths, no unauthenticated-readable
paths, SVG systematically excluded with documented XSS rationale, SSRF well-contained on the
image proxy, and the crown-jewel artifact (assessment exports) uses a rules-denied +
server-streamed model that avoids tokened-URL leakage. Two items deserve a second look — an
over-broad read on private note documents, and the absence of content/magic-byte verification
and malware scanning. Orphan accumulation is real but bounded and non-security.

## Answers to the audit's key questions

- **Can the system accumulate orphaned files?** Yes, for specific classes (quiz/assessment
  images, papers, invoices, branding versions with a missing parent) — a **cost/hygiene** issue,
  not a security hole. Temp/export/ticket classes are well-reaped.
- **Can private files be read by unauthorized users?** Mostly no. One over-broad read
  (`lesson-files/` note docs, STOR-001) and the inherent tokened-URL bypass (STOR-002) are the
  exceptions. Genuinely private classes (invoices, assessment-exports, tmp-downloads, branding,
  assessment-images) are correctly owner/admin-scoped or server-only.

## Strengths (evidence)

- Every write requires ≥ `isVerified()`; terminal deny-all at `storage.rules:419-422`.
- `assessment-exports/**` is `read:false, write:false` (`storage.rules:208-211`) — bytes served
  only through `apiAssessmentDownload` with a 5-min owner-scoped ticket **or** re-checked ID
  token (`exportService.js:363-431`), path re-validated (`isExportPathFor`).
- **SVG excluded** from every image path with explicit `<script>`/`on*` rationale
  (`storage.rules:340-343`); presentations rasterize to PNG before upload.
- SSRF-contained image proxy — https-only, host allow-list, project-bucket check,
  `redirect:"error"`, 20s timeout, 15 MB cap, IP rate limit (`imageProxyCore.js:30-56`,
  `imageProxy.js:59-95`).
- Cascade cleanup triggers (`storageCleanup/`) with sibling-reference guards; hourly
  `tmpDownloadReaper`, 6-hourly `reapDownloadTickets`, on-delete export reaping.
- Client-side validation mirrors the rules (defense-in-depth); rules are the authoritative backstop.

## Findings

### STOR-001 — `lesson-files/` whole-note documents readable by any verified user
- **Severity:** Medium · **Confidence:** High (behaviour) / Moderate (impact)
- **Affected:** `storage.rules:364-370` (`allow read: if isVerified();` for PDF/DOC/DOCX ≤25 MB),
  `validLessonFileUpload` (`:149-156`).
- **Current:** A teacher's uploaded note document is readable by **any** authenticated,
  email-verified account — not just the owner or enrolled learners. Paths embed a timestamp +
  sanitized filename (not trivially enumerable), but there is no ownership/enrollment gate on read.
- **Risk:** A note doc containing answers or non-learner-facing material is exposed to every
  signed-in user who learns the path.
- **Correction:** Split learner-facing note assets (broad read) from private note documents
  (owner/enrolled read), or gate reads on ownership/enrollment. **Launch blocker:** No.
  **Complexity:** Low–Medium.

### STOR-002 — Tokened download URLs bypass Storage rules (inherent Firebase behaviour)
- **Severity:** Low–Medium · **Confidence:** Moderate confidence
- **Affected:** `getDownloadURL()` usages (`pastPapers.js:280`, `uploadBrandingAsset.js:82`,
  `notes/lib/storage.js:63,113`, etc.)
- **Current:** A tokened URL grants read to anyone holding it, regardless of the `allow read`
  rule. The codebase correctly avoids tokened URLs for the highest-sensitivity artifact
  (assessment exports). But for `assessment-images` (rule = owner/admin only), if a tokened URL
  is minted and persisted in a Firestore doc, that URL is bearer-readable outside the rule's scope.
- **Risk:** "Owner-only" image privacy is only as strong as the URLs the client mints and stores.
- **Correction:** For owner-private images, serve through the ticketed proxy rather than persisting
  tokened URLs; audit which surfaces persist tokened URLs. **Launch blocker:** No.

### STOR-003 — No content/magic-byte verification or malware scanning
- **Severity:** Low–Medium · **Confidence:** High confidence
- **Affected:** all upload paths — MIME is the client-declared `contentType`, not verified.
- **Current:** A malicious uploader can declare `image/png` on an arbitrary payload. No AV scan
  (no Cloud Storage AV extension), no magic-byte check. `X-Content-Type-Options: nosniff` on
  served responses mitigates browser MIME-sniffing. SVG is excluded (limits the main XSS vector).
- **Risk:** Residual for a platform serving user-uploaded PDF/Office/images; also relevant to the
  `adm-zip` ZIP-bomb path (see SEC-007) which parses uploaded DOCX.
- **Correction:** Add magic-byte validation on upload (Cloud Function or client), and consider a
  malware-scanning step for teacher-uploaded documents. **Launch blocker:** No (common residual).

### STOR-004 — Several orphan classes are never auto-reaped (manual script only)
- **Severity:** Low · **Confidence:** High confidence
- **Affected:** `functions/storageCleanup/orphanReaper.js:20-23`; `scripts/audit-storage.mjs`.
- **Current:** quiz-image / assessment-image / paper / invoice blobs whose parent doc vanished
  without the update trigger firing accumulate until a human runs the script. Past-paper delete is
  best-effort with an acknowledged orphan-on-failure path (`pastPapers.js:394-400`); superseded
  branding versions linger until account deletion (`uploadBrandingAsset.js:76`).
- **Risk:** Storage cost growth over time; not an access issue.
- **Correction:** Add an `onPaperDeleted` cascade trigger; schedule the orphan reaper to include
  these classes with an age threshold. **Launch blocker:** No. **Complexity:** Low.

## Cross-references
- Download authorization + ticketing overlaps [`11-observability-and-audit.md`](./11-observability-and-audit.md) (server-streamed model).
- `adm-zip` upload-parsing DoS: [`13-cicd-and-release.md`](./13-cicd-and-release.md) SEC-007.
