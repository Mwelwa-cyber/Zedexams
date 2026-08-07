# Firebase Cloud Storage — Security Audit & Hardening

> Snapshot as of 2026-07-18 — verify against `storage.rules` before acting.

Scope: a full security audit of Firebase Cloud Storage for ZedExams, plus the
concrete hardening landed in this change. The ruleset was already mature
(default-deny fallback, per-user path scoping, per-feature type/size validators,
email-verification + premium-entitlement gates, an emulator + text test suite).
This pass audits it end-to-end, closes the genuine gaps found, and records the
inventory, residual risks, and a phased roadmap for the larger architectural
items that don't fit the current data model yet.

**Tenancy model reality check:** ZedExams has **no `schools/{schoolId}/members/`
tenant model** in Storage. `schoolId` in the codebase is teaching-profile /
timetable metadata, not a Storage authorization boundary. Storage tenancy is
**per-user (uid-in-path) + role (learner/teacher/admin) + premium entitlement**.
The path architecture below reflects that; a school-tenant scheme would be a
future migration, not a rename.

---

## 1. Storage path inventory

| # | Path pattern | Feature | Uploader | Readers | Deleter | Content type(s) | Max size | Retention | Public? | Firestore metadata | Pipeline |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `papers/{uid}/{paperId}/…` | Past Paper Studio | teacher/admin (self path) | entitled learners, teacher/admin, owner | owner teacher/admin | PDF, DOC/DOCX, JPG/PNG/WebP | 50 MB | until paper deleted | private (premium-gated) | `pastPapers.pdfPath`/`markSchemePath` | client upload → viewer |
| 2 | `quiz-images/{uid}/…` | Quiz question images | teacher/admin (self) | any verified user | owner | JPEG/PNG/WebP | 10 MB | until question deleted | private | question `imageUrl` | client, compressed to 1200px |
| 3 | `assessment-images/{uid}/…` | Assessment images | teacher/admin (self) + `generateDiagram` (server) | **owner + admin only** | owner | JPEG/PNG/WebP; server PNG | 10 MB | until deleted | private | question `imageUrl` | client + server |
| 4 | `lesson-images/{uid}/{batch}/…` | Lesson editor | teacher/admin (self) | any verified user | owner | JPEG/PNG/WebP/GIF | 5 MB | until lesson deleted | private | lesson doc | client |
| 5 | `lesson-presentations/{uid}/{batch}/…` | Preserved PPTX lessons | teacher/admin (self) | any verified user | owner | PPTX, PDF, raster (**no SVG**) | 50 MB | until deleted | private | lesson doc | client (rasterized) |
| 6 | `lesson-files/{uid}/{batch}/[inline/]…` | Notes Studio | teacher/admin (self) | any verified user | owner | PDF/DOC/DOCX; inline PNG/JPEG/WebP/GIF | 25 MB / 5 MB inline | until deleted | private | note doc | client |
| 7 | `user-branding/{uid}/{file}` | Teacher Settings branding | teacher/admin (self) | **owner + admin only** | owner | JPEG/PNG/WebP | 5 MB | overwrite-in-place | private | teacher profile | client, compressed |
| 8 | `invoices/{uid}/{paymentId}.pdf` | MoMo invoices | **server only (Admin SDK)** | owner + admin | none (client) | PDF | — | financial record | private | `invoices.storagePath` | server (`invoiceGenerator`) |
| 9 | `tmp-downloads/{uid}/{id}.{ext}` | Export filename staging | owner | owner only | owner + hourly reaper | any (export) | 25 MB | ~1 h (`tmpDownloadReaper`) | private | none | client scratch |
| 10 | `visual-studio/{uid}/…` | Visual Studio | teacher/admin (self) | any verified user | owner | PNG (baked) | 10 MB | until deleted | private | `visualAsset` doc | client |
| 11 | `picture-bank/{uploads,staged}/…` | Picture bank | **admin only** + extract (server) | any verified user | admin | **JPEG/PNG/WebP (raster-only)** | 10 MB | curated | private | `pictureBank` doc | client(admin) + server |
| 12 | `syllabus-uploads/{version}/…` | Syllabus ingest | admin | admin | admin | XLSX (+octet-stream) | 25 MB | ingest scratch | private | draft topics | client(admin) → onFinalize |
| 13 | `syllabus-uploads-pdf/{version}/…` | Syllabus PDF ingest | admin | admin | admin | PDF | 25 MB | ingest scratch | private | — | client(admin) → callable |
| 14 | `curriculum-uploads/{uid}/…` | Curriculum module | admin (self) | admin | admin | PDF/DOCX/XLSX (+octet-stream) | 25 MB | ingest scratch | private | curriculum/rag_chunks | client(admin) → callable |
| 15 | `assessment-format-samples/{uid}/…` | Format extraction | admin (self) | admin | admin | PDF/DOCX/JPG/PNG/WebP (+octet-stream) | 25 MB | ingest scratch | private | format draft | client(admin) → callable |
| 16 | `note-pictures/{uid}/{noteId}/…` | AI note pictures | **server only (Admin SDK)** | via token URL | reaper (now) | PNG/JPG | — | until note deleted | private (token) | note doc | server |
| 17 | `slide-notes-images/{uid}/{deckId}/…` | AI slide-note images | **server only (Admin SDK)** | via token URL | reaper (now) | PNG | — | until deck deleted | private (token) | deck doc | server |
| 18 | `syllabi/…` | Seed syllabi | Admin SDK / seed | via stored URL | seed | PDF | — | static | admin-owned | — | seed only |

All other paths → **catch-all deny** (`match /{allPaths=**} { allow read, write: if false }`).

## 2. Existing rule audit

- **Default-deny fallback:** present and last (`storage.rules` catch-all). Pinned
  by `test:storage-rules-text`.
- **Per-user ownership:** every `{ownerUid}` path enforces `ownsPath(ownerUid)`
  (uid == `request.auth.uid`), so ownership is **path-based, not
  metadata-based** — a client cannot forge ownership via custom metadata.
- **Verification gate:** every path requires `isVerified()` (Auth
  `email_verified` token claim, with a server-granted grace window). No path
  grants read on bare `isAuthed()`.
- **Suspension gate:** `callerActive()` blocks `suspended`/`deleted` accounts on
  owned writes and premium reads.
- **Premium entitlement:** past-paper PDFs + mark schemes require a valid
  subscription (`hasValidEntitlement()`), mirroring `subscriptionConfig.js`.
- **Server-write-only:** `invoices/` is `allow write: if false` (Admin SDK
  bypasses rules); client overwrite/enumeration denied.
- **Type/size validators:** one per feature — no single global limit.
- **SVG excluded** from quiz-images and lesson-presentations (documented
  script-injection guard).

## 3. Dangerous-rules scan

Scanned for `allow read, write: if true`, `allow read: if true`, bare
`allow write: if request.auth != null`, and broad `match /{allPaths=**}` grants.
**None found** on a writable path. The only `allow read: if true` would be an
intended public bucket — ZedExams has **no public Storage read path** (all reads
require `isVerified()`; `syllabi/` is served via Admin SDK / stored URLs, not a
rules-based public read). No files at bucket root under a broad shared folder.

**One genuine gap found & fixed this pass:**

- `validPictureBankUpload()` used the broad `image/.*` matcher, which **accepts
  `image/svg+xml`**. Every picture-bank blob is readable by any verified user
  and its download URL is persisted in a Firestore doc, so a script-bearing SVG
  is a **stored-XSS vector** (writes are admin-only, but this is a
  defense-in-depth hole inconsistent with the quiz-image / lesson-presentation
  rules). Tightened to `image/(jpeg|png|webp)`; the client
  (`pictureBankService.js`) now rejects non-raster up front with a clear message.
  New tests: text + emulator (SVG rejected, PNG accepted, admin-only write,
  verified read) + a Vitest client spec.

## 4. Public / private classification

- **Public (rules `read: if true`):** none. (No public Storage read surface.)
- **Verified-read shared assets:** quiz-images, lesson-images,
  lesson-presentations, lesson-files, visual-studio, picture-bank — readable by
  any verified user because they render inside learner-facing quizzes/lessons or
  teacher-shared assessments.
- **Owner+admin private:** assessment-images, user-branding, invoices,
  tmp-downloads (owner-only), syllabus/curriculum/format ingest (admin-only).
- **Server-token private:** note-pictures, slide-notes-images (no client rule;
  served via `firebaseStorageDownloadTokens`).

## 5. Changes landed in this pass

1. **`storage.rules`** — `validPictureBankUpload()` raster-only (drops SVG).
2. **`src/utils/pictureBankService.js`** — `assertUploadableImage()` rejects
   non-raster before upload on both the active and staged (bulk) paths.
3. **`functions/storageCleanup/helpers.js`** — added `visual-studio/`,
   `note-pictures/`, `slide-notes-images/` to `USER_KEYED_PREFIXES` so a
   deleted account's baked diagrams and server-generated AI images are actually
   swept (they previously orphaned — blobs + tokened URLs outlived the user).
4. **Tests** — `test-storage-rules-text.mjs` (picture-bank raster guard),
   `test-storage-rules-emulator.mjs` (picture-bank behavioural section),
   `pictureBankService.spec.js` (client SVG/type/size rejection),
   `helpers.test.js` (new sweep prefixes).

## 6. Residual risks / roadmap (not in this pass)

Ordered by the prompt's Phase 2–5. These are architectural additions that would
touch every upload path + new Cloud Functions + client + Android, so they are
deliberately **not** bundled into this security fix:

- **Server-side content validation** — rules trust the client-declared
  `contentType`. Files that get parsed/published (papers, syllabi, imports)
  should be magic-byte / decode / PDF-structure validated server-side. Partly
  present in the ingest callables; not universal. `octet-stream` is still
  accepted on admin ingest paths (browsers send it for DOC/XLSX) — mitigate with
  server-side signature checks, not by removing it (would break admin uploads).
- **Quarantine + upload-operation records** — the prompt's
  `/quarantine/{uid}/{operationId}/` + server-issued upload sessions do not exist
  yet; current uploads go straight to their final owner-scoped path. Adding them
  is the right long-term shape for parsed/published content.
- **Malware scanning / image re-encoding** — no AV scan or server-side raster
  re-encode of user images before they're shared. SVG is blocked, which removes
  the active-content risk for the raster paths.
- **Admin-callable path ownership** — `extractTopicsFromPdf`,
  `uploadCurriculumModule`, `extractAssessmentFormat`, `analyzeExamPaper`
  validate the path *prefix* + reject `..` but don't assert the `{uid}` segment
  equals the caller. Residual risk is admin→admin only (all are admin-gated).
- **`papers/{fileName}` single-segment rule** — likely dead (all writers use the
  `papers/{uid}/{paperId}/…` form); kept for read-compat with any legacy flat
  objects. Candidate for removal after a bucket scan confirms none remain.
- **Legacy migration + IAM least-privilege + App Check enforcement staging** —
  see the prompt's sections 26–35; tracked, not started here.
- **`storage-resize-images`: narrow the path scope and review "make public"**
  (added 2026-08-05 — see the `storage-detect-objects` entry in
  [`AUDIT_LOG.md`](./AUDIT_LOG.md)). The extension stays installed; the concern
  is that it, like the detect-objects extension uninstalled on 2026-08-05, is
  configured bucket-wide. Two things to settle: **which paths it should produce
  derivatives for**, and **whether its "make public" setting is on**, since a
  public derivative of an owner-scoped original silently defeats that scoping
  for the resized copy. The audit gives the real map of what it is currently
  producing derivatives for — every prefix that appeared in `detectedObjects`,
  which only saw an image because something finalized it in the bucket:
  `papers/`, `quiz-images/`, `assessment-images/`, `picture-bank/`,
  `slide-notes-images/`, `lesson-files/`, `visual-studio/`, `user-branding/`.
  Note `user-branding/` is user profile photos. Scope this against the path
  inventory in §1 rather than from the prefix list alone — the list is evidence
  of what *was* uploaded during one window, not a declaration of what *should*
  be resized.

## 7. Test & tooling map

- `npm run test:storage-rules-text` — static invariants (default-deny,
  validators, ownership, raster guards). In `test:all`.
- `npm run test:storage-rules-emulator` — behavioural, against the
  Firestore+Storage emulators (needs Java; runs in CI). Storage rules call
  `firestore.get(users/{uid})` for role/entitlement, so both emulators are
  required.
- `npm run test:storage-cleanup` — reaper prefix/orphan helpers.
- `npm run test:unit` — `pictureBankService.spec.js` client validation.
- `scripts/audit-storage.mjs` — read-only bucket survey + orphan reaper
  (`--orphans [--delete]`). *Note: its `PREFIXES` list does not yet include the
  three prefixes added to the cleanup reaper — extend when adding reverse-index
  orphan logic for them.*
