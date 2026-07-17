# 12 — Firebase Storage Map

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.
> Bucket: `gs://examsprepzambia.firebasestorage.app` (region `africa-south1`). Rules: [`storage.rules`](../../storage.rules). CORS: [`cors.json`](../../cors.json).

## Rules model

Shared helpers (`storage.rules` lines 4–48): `isAuthed()`, `isVerified()` (email-verified claim **or** `users.verificationGraceUntil` grace window), `isTeacherOrAdmin()`, `isAdmin()`, `ownsPath(uid)` (verified AND `auth.uid == uid`). **Every** path requires `isVerified()` — there is no bare-authed carve-out, so there are no signup-time writes. Role is resolved by a Firestore lookup of `users/{uid}`. The tree ends in a **deny-all** catch-all (`/{allPaths=**}`, line 350).

## Path register

| Path pattern | Purpose | Read | Write | Limits | Uploader (code) | Reader (code) |
|---|---|---|---|---|---|---|
| `papers/{ownerUid}/{**}` | Past-paper PDFs, mark schemes, page assets, passage figures | **entitled learner / teacher / admin / owner + active** (P0, 2026-07-17: was any verified) | owner+teacher/admin (active) | ≤50 MB; pdf/doc/docx/jpeg/png/webp | `src/utils/pastPapers.js` (`uploadPaperPdf` L289, `uploadPaperAsset` L342), `paperFigureAttach.js:130` | `getPaperPdfUrl` L280, `PastPaperViewer.jsx`, `paperToQuizConverter.js` |
| `papers/{fileName}` (legacy, 1-level) | Legacy paper uploads | any verified | admin | ≤50 MB | — (defensive) | — |
| `quiz-images/{ownerUid}/{**}` | Quiz question/passage/option images | any verified | owner+teacher/admin | ≤10 MB; jpeg/png/webp | `EditQuizV2.jsx`, `CreateQuizV2.jsx`, `quizDocumentImport.js` | quiz runners |
| `assessment-images/{ownerUid}/{**}` | Assessment images + server diagrams | **owner or admin** | owner+teacher/admin | ≤10 MB | `AssessmentStudio.jsx`, server `generateDiagram.js:200` (admin SDK) | AssessmentStudio, exporters |
| `visual-studio/{ownerUid}/{**}` | Baked labelled diagrams | any verified | owner+teacher/admin | ≤10 MB | `features/visualStudio/services/visualAssetService.js:43` | worksheets/assessments |
| `lesson-images/{ownerUid}/{batch}/{**}` | Lesson slide images | any verified | owner+teacher/admin | ≤5 MB (+gif) | `LessonEditor.jsx` | `LessonPlayer` |
| `lesson-presentations/{ownerUid}/{batch}/{**}` | PPTX source + rendered slides | any verified | owner+teacher/admin | ≤50 MB; **SVG excluded (XSS)** | `LessonEditor.jsx` | `LessonPlayer` |
| `lesson-files/{ownerUid}/{batch}/[inline/]{**}` | Notes files + inline images | any verified | owner+teacher/admin | ≤25 MB (files) / ≤5 MB (inline) | `features/notes/lib/storage.js` | notes reader |
| `syllabus-uploads/{version}/{**}` | Syllabus XLSX ingestion | **admin** | admin | ≤25 MB; xlsx | `src/utils/syllabusReplaceService.js:89` | `parseSyllabusUpload` (Storage onFinalize) |
| `syllabus-uploads-pdf/{version}/{**}` | Syllabus PDF ingestion | **admin** | admin | ≤25 MB; pdf | `SyllabusPdfUploadPanel.jsx` | `extractTopicsFromPdf` |
| `curriculum-uploads/{ownerUid}/{**}` | Curriculum module docs | **admin** | owner+admin | ≤25 MB | `CurriculumUploadPanel.jsx` | `uploadCurriculumModule` (self-deletes after parse) |
| `assessment-format-samples/{ownerUid}/{**}` | Sample papers for format extraction | **admin** | owner+admin | ≤25 MB | `adminCbcKbService.js:641` | `extractAssessmentFormat` |
| `picture-bank/{**}` | Picture bank assets + staged extracts | any verified | admin | ≤10 MB; image/* | `pictureBankService.js`, server `extractAssessmentFormat.js:106` | `pictureBankService.js` |
| `invoices/{userId}/{fileName}` | MoMo invoice PDFs | owner or admin | **`write:false`** (server SDK only) | — | server `invoiceGenerator.js:254` | `src/utils/invoices.js`, `UpgradeModal.jsx` |
| `tmp-downloads/{ownerUid}/{**}` | Export staging (Content-Disposition) | **owner only** | owner | ≤25 MB; **no content-type check** | `src/utils/stampedDownload.js:74` | client download |
| `user-branding/{ownerUid}/{fileName}` | Teacher photo/logo/signature/letterhead | owner or admin | owner+teacher/admin | ≤5 MB | `features/teacherSettings/lib/uploadBrandingAsset.js` | export baking |

### Server-generated paths with NO rules match (token-URL only)

- `note-pictures/{uid}/{noteId}/{**}` — `functions/teacherTools/generateNotePictures.js:51`
- `slide-notes-images/{uid}/{deckId}/{**}` — `functions/teacherTools/generateSlideNotes.js:176`

Both are written by the Admin SDK (bypasses rules) and served via minted `firebaseStorageDownloadTokens` URLs, so reads work without a matching rule. Any non-token SDK read would hit deny-all.

## Cleanup / cascade deletes (`functions/storageCleanup/`)

| Trigger | Firestore event | Deletes |
|---|---|---|
| `onLessonDeleted` / `onLessonUpdated` | `lessons/{id}` | Lesson file/presentation prefixes + tracked paths; on update, only rotated/dropped paths. |
| `onQuizQuestionDeleted` / `onQuizQuestionUpdated` | `quizzes/{id}/questions/{qid}` | `quiz-images/` blobs; **guards against deleting a blob a sibling question still references**. |
| `onAssessmentQuestionDeleted` / `onAssessmentQuestionUpdated` | `assessments/{id}/questions/{qid}` | `assessment-images/` blobs, same sibling guard. |
| `onUserDeleted` (v1 auth, us-central1) | Auth delete | Sweeps `USER_KEYED_PREFIXES`: lesson-files/-presentations/-images, quiz-images, assessment-images, papers, invoices, user-branding. |
| `orphanStorageReaper` (daily 03:00, us-central1) | cron | Deleted-user sweep + orphan lesson batches >7d; report → `storageOrphanReports/{date}`. Does **not** reap quiz/assessment/paper/invoice orphans (use `scripts/audit-storage.mjs --delete`). |
| `tmpDownloadReaper` (hourly, us-central1) | cron | `tmp-downloads/` objects >1h old. |

Past-paper deletes cascade client-side via `deletePaper()` (`src/utils/pastPapers.js:394`), not a trigger.

## Findings (Storage)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| STO-1 | Medium | `note-pictures/` and `slide-notes-images/` have **no rules match AND no cleanup** — unbounded growth; orphaned forever when a note/deck doc is deleted. | `generateNotePictures.js:51`, `generateSlideNotes.js:176`; not in `USER_KEYED_PREFIXES`. |
| STO-2 | Medium | `visual-studio/` and `picture-bank/` not in `USER_KEYED_PREFIXES` → teacher visual-studio diagrams not swept on account deletion. | `onUserDeleted.js`. |
| STO-3 | Low | Admin ingestion temp files (`syllabus-uploads*`, `assessment-format-samples`, `picture-bank/staged`) have no reaper (curriculum-uploads self-deletes). | §5C of findings. |
| STO-4 | Low/Info | `picture-bank/staged/` readable by any verified user (whole `picture-bank/**` is `read: isVerified()`). Random docId paths → low practical risk. | `storage.rules:274`. |
| STO-5 | Info | `tmp-downloads` create has no content-type restriction (owner-scoped + hourly-reaped). | `validTmpDownload` (`storage.rules:318`). |
| STO-6 | Info | Reapers run in `us-central1` against `africa-south1` bucket (cross-region deletes; functional, minor egress). | `onUserDeleted`, `orphanStorageReaper`, `tmpDownloadReaper`. |

CORS (`cors.json`): `origin ["*"]`, `GET`/`HEAD`, exposes `Content-Disposition`/`Content-Range`/`Accept-Ranges`. Applied via `npm run storage:cors`. Needed so exporters read image **bytes** (html2canvas `useCORS`, DOCX `fetch` cors), not for display. Wildcard GET/HEAD is acceptable for public token-URL reads (no credentials, no write).
