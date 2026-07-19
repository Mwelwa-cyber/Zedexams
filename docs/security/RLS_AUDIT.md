# Row-Level Security Audit & Implementation — ZedExams

> **Snapshot as of 2026-07-19 — verify before acting.** This is a point-in-time
> audit of the Firestore/Storage/Cloud-Functions access-control posture plus the
> row-level-security hardening shipped in this change. Rule line numbers drift;
> the behavioural emulator suites (`test:rules-emulator`,
> `test:school-membership-rules`, `test:storage-rules-emulator`) are the living
> source of truth.

## 1. Executive summary

ZedExams already enforces row-level security at the database, storage, and
backend layers **independently of the React UI**. Firestore Security Rules
(2,600+ lines) implement a *default-deny + explicit allowlist* posture with:

- a recursive `match /{document=**} { allow read, write: if false }` catch-all
  (mirrored in `storage.rules`), so a new collection is denied until it earns an
  explicit rule;
- owner-scoping on every private collection via stable ids (`ownerUid`,
  `createdBy`, `teacherUid`, `userId`, `learnerUid`) — never display names;
- immutable security fields on update (ownership/subscription/audit fields are
  blocklisted or `diff().affectedKeys().hasOnly(...)`-whitelisted);
- server-only writes for all revenue, entitlement, AI-usage/quota, grading,
  audit-log, and attendance state (Admin-SDK Cloud Functions bypass rules and
  perform their own authorization — verified in §6);
- email-verification + suspended-account + premium-entitlement gates folded into
  `isVerified()` / `hasValidEntitlement()`;
- token-as-permission `get`/`list` splits so share links resolve without
  enabling collection enumeration of PII.

The **one structural gap** versus a production multi-tenant model was the
absence of a canonical, tamper-proof **school-membership** boundary: "school"
existed only as free-text display fields and a `schoolLicences.memberUids` list,
and platform-admin was a Firestore role rather than a custom claim. This change
closes that gap by adding the membership foundation (§4) additively — **no
existing collection's access is widened.**

Cloud Functions were audited separately (§6): authorization is strong
(universal `assertVerifiedAuth` guard, server-derived roles, signature-validated
webhooks). The only material backend gap is App Check being *observe-only* by
default (§9, remaining risk R1).

## 2. What this change implements

1. **`platformAdmin` custom claim** folded into `isAdmin()` (additive; the
   existing `users.role in [admin, superAdmin]` grant still works). High-level
   platform role now has a tamper-proof, Firestore-read-free source.
2. **Canonical school-membership model** in `firestore.rules`:
   - helpers `membershipPath`, `hasActiveMembership`, `hasSchoolRole`,
     `isSchoolAdmin`, `isTeacherAtSchool`, `isPlatformAdmin`;
   - `schools/{schoolId}` (platform-admin provisioned; members read; school
     admins may edit descriptive fields only);
   - `schools/{schoolId}/members/{uid}` — the tamper-proof membership record.
     Issuance/change/revocation is restricted to an existing school admin of
     **that** school or a platform admin; a member can never write their own
     membership; the first admin is provisioned server-side.
3. **Emulator security suite** for the model
   (`scripts/test-school-membership-rules-emulator.mjs`, 30 cases) wired into CI.
4. **Rules-text invariants** pinning the forge-proofing
   (`scripts/test-firestore-rules-text.mjs`).
5. **Migration** `scripts/migrate-provision-school-membership.mjs` (dry-run,
   idempotent, resumable, no-guess) + pure-logic unit tests.

## 3. Canonical authorisation model

Stable identifiers only — never names, labels, or emails as a boundary.

| Concern | Source of truth | Client-writable? |
|---|---|---|
| Platform admin | `request.auth.token.platformAdmin` (custom claim) **or** `users/{uid}.role in [admin, superAdmin]` | No (claim is server-minted; role is blocklisted from self-write) |
| School role (`school_admin`/`teacher`/`learner`/`parent`) | `schools/{schoolId}/members/{uid}.role` (status `active`) | No (school-admin/platform-admin/CF only) |
| Content ownership | `ownerUid` / `createdBy` / `teacherUid` / `userId` on the doc | Pinned to `request.auth.uid` at create; immutable on update |
| Entitlement / premium | `users/{uid}` subscription fields | No (Admin-SDK activation path only) |
| AI usage / quota | `usageMeters/*`, `aiUsage/*`, `aiDailyLimits/*` | No (server-only) |
| Email verification | `request.auth.token.email_verified` (+ server-granted `verificationGraceUntil`) | No |

**Membership is never derived from a `schoolId` a user writes into their own
profile.** A user gains school access only when a trusted admin process issues a
membership document.

## 4. School-membership data model

```
schools/{schoolId} {
  name, address?, district?, province?, motto?, logoUrl?,
  status: 'active' | 'suspended',
  createdBy,                 // platform-admin uid / 'migration:*'
  createdAt, updatedAt
}

schools/{schoolId}/members/{uid} {
  uid,                       // == doc id (path-pinned)
  schoolId,                  // == parent id (path-pinned)
  role: 'school_admin' | 'teacher' | 'learner' | 'parent',
  status: 'active' | 'invited' | 'suspended' | 'removed',
  classIds: string[],        // ≤ 300
  permissions: string[],     // ≤ 50
  addedBy?/invitedBy?,       // issuer uid
  createdAt, updatedAt
}
```

Rule contract (enforced + tested):

| Operation | Who |
|---|---|
| `schools` create/delete | platform admin only |
| `schools` update | platform admin; school admin may change `name/address/district/province/motto/logoUrl` of **their** school only (not `status`, not id) |
| `schools` read | active member of the school; platform admin |
| `members` create/update/delete | active `school_admin` of **that** school; platform admin; (Cloud Function via Admin SDK). Fields validated: `uid`/`schoolId` path-pinned, `role`/`status` enum-checked |
| `members` read (`get`) | the member (own record); any school admin of the school; platform admin |
| `members` list | school admin / platform admin only (a regular member cannot enumerate the roster) |

### Phased school-scope adoption

Existing user-owned collections (`quizzes`, `assessments`, `lessons`,
`aiGenerations`, `classRegisters`, …) **remain owner-scoped exactly as before**.
Migrating a collection to school-scoped sharing is a deliberate, separately
tested follow-up that must be shipped together with the matching client query
change (add the `schoolId` filter) so the UI is never left partially
compatible. The helpers (`hasSchoolRole`, `isSchoolAdmin`, `isTeacherAtSchool`)
are ready for that adoption. Recommended first candidates: school-shared teacher
content and cross-teacher analytics.

## 5. Collection access matrix (representative)

Legend — Owner: the security principal. Scope: pri(vate)/school/public. Prot:
current protection. W: weakness (● = none found this pass).

| Collection / path | Owner | Roles (read) | Ops (client) | Protection | W |
|---|---|---|---|---|---|
| `users/{uid}` | self | self, admin | self create/update (blocklisted), admin update/delete | role/subscription/portal/referral/lifecycle fields pinned; suspension server-only | ● |
| `schools/{id}` | platform | members, admin | admin CRUD; school-admin descriptive update | platform-admin provisioned; **new** | ● |
| `schools/{id}/members/{uid}` | school | member(self), school-admin | school-admin/admin CRUD | tamper-proof issuance; path-pinned; **new** | ● |
| `quizzes/{id}` | createdBy | published→all; draft→owner/admin; public-paper→anon | teacher draft-only create/update, no publish | publish gate; draft isolation | ● |
| `quizzes/{id}/questions` | createdBy | premium/entitled or demo or owner/admin; daily-exam server-only | owner/admin write | answer-key leak closed (daily-exam server-served); premium gate | ● |
| `exam_attempts/{id}` | userId | submitted→all (leaderboard-safe); in-progress→owner | owner create (unscored `in_progress` only); no client update | leaderboard forgery + answer-key (private subcol) closed | ● |
| `exam_attempts/{id}/private/*` | userId | owner, admin | none (server-only) | top-scorer answers isolated | ● |
| `results/{id}` | userId | owner, admin, quiz-owner teacher | owner create only; no self-update | score-tamper closed | ● |
| `assessments/{id}` (+questions) | createdBy | owner, admin | owner CRUD (teacher+) | teacher tenant isolation | ● |
| `lessons/{id}` | createdBy | published→all; owner/admin | teacher draft-only | publish gate | ● |
| `payments/{id}` | userId | owner, admin | admin-only writes | revenue integrity | ● |
| `invoices/{id}` | userId | owner, admin | server-only | receipts private | ● |
| `subscriptionEvents/{id}` | uid | owner, admin | server-only | append-only ledger | ● |
| `aiGenerations/{id}` | ownerUid | owner, admin | pure-client tools only (field allowlist); AI tools server-only | cost/token forgery closed | ● |
| `usageMeters/{uid}/periods/*`, `aiUsage/*`, `aiDailyLimits/*`, `rateLimits/*` | server | admin (some) | none | quota/cost server-only | ● |
| `questionBank/{id}` | ownerId | owner, master-bank(approved), admin | owner create `pending_review`; no self-promote | Master-Bank gate | ● |
| `classes/{id}`, `classInvites`, `assignments` | teacherUid | members / authed | CF-only writes (assignments/invites); teacher class CRUD | cross-class injection closed | ● |
| `classRegisters/{id}/**` (roster/records/attendance/terms/audit) | teacherUid | owner, admin | roster/records owner; attendance **server-only**; audit append-only | forged-termId lock bypass closed | ● |
| `progressShares`, `shares`, `familyInviteCodes`, `parentLinks` | learner/owner | token `get`; owner list | owner create (shares/progressShares); CF-only (family) | enumeration of PII blocked (get/list split) | ● |
| `pastPapers`, `pastPapersIndex`, `publicStats`, `examTimetables`, `settings`, `games`, `leaderboards`, `announcements` | admin/server | public (published only) | admin/server writes | public reads gated to published/non-sensitive | ● |
| `curriculum`, `rag_chunks` | server | none | none | grounding corpus fully closed | ● |
| `adminAuditLogs`, `visits`, `aiAgentLogs`, `appCheckHealth`, `dawnRuns` | server | admin | none | audit/telemetry server-only | ● |
| everything else | — | — | — | recursive default-deny `if false` | ● |

Full per-collection reasoning lives inline in `firestore.rules` (each block is
commented with its threat model).

## 6. Cloud Functions authorization (Admin SDK bypasses rules)

Audited `functions/` (callables, HTTP, webhooks, schedulers). Findings:

- **Callables** — a shared `assertVerifiedAuth(request)` guard
  (`functions/authGuard.js`) is applied at the top of ~60 handlers: throws
  `unauthenticated` without a uid, enforces email-verification + grace, blocks
  suspended/deleted accounts. Intentional pre-auth exemptions
  (`bootstrapUserProfile`, `deleteMyAccount`, password reset) and public
  marketing (`subscribeToNewsletter`, honeypot + IP cap) are documented. **No
  privileged callable runs without an auth check.**
- **Role checks** — admin actions re-read the caller's role from
  `users/{auth.uid}` server-side (`assertCallerIsAdmin`); ownership actions
  compare against server-stored `teacherUid`/`createdBy`. Client-supplied
  `childUid`/`resourceId` are used only as lookup keys, then authorized (e.g.
  `getChildProgress` requires an existing `parentLinks` doc).
- **No client-trusted `role`/`amount`/`plan`/`entitlement`/`teacherId`/
  `schoolId`** — `amount` is computed from the plan catalog; Play/Lenco plans
  are derived from the *verified* provider payload; `teacherId`/`ownerId` are
  written from `request.auth.uid`.
- **Webhooks fail-closed** — `lencoWebhook` validates HMAC-SHA512 (timing-safe);
  `apiWhatsAppWebhook` validates `X-Hub-Signature-256` and the GET verify token,
  fail-closed in both directions; both dedupe/idempotent.
- **SSE/HTTP** — extract `Authorization: Bearer`, `verifyIdToken`, then
  `assertDecodedVerified`; teacher streams additionally require a staff role.

No HIGH-severity backend authorization gaps found. Minor items → §12 (R2, R3).

## 7. Storage rules

`storage.rules` mirrors the Firestore posture: default-deny catch-all,
owner-scoped path prefixes (`{ownerUid}/...`), per-path MIME + size validation,
SVG deliberately excluded (stored-XSS on the `firebasestorage` origin),
email-verification + suspended-account + premium gates on past-paper PDFs/mark
schemes, and owner+admin-only reads for private branding/invoices. The
behavioural suite is `scripts/test-storage-rules-emulator.mjs`
(`test:storage-rules-emulator`, wired in CI).

## 8. Attack coverage (§14 mapping)

Every scenario below is asserted by an emulator or text test.

| Attack | Guard | Test |
|---|---|---|
| Teacher A reads/updates Teacher B's private doc | draft/owner isolation | `test-firestore-rules-emulator` (quizzes/assessments/generatedContent) |
| Teacher accesses another school / assigns to another school | membership + path-pin | `test-school-membership-rules` |
| Teacher changes immutable ownership fields | blocklist / `hasOnly` | `test-firestore-rules-emulator` (aiGenerations tool, shares ownerUid) |
| Learner reads own results; not another's | owner-scope | `test-firestore-rules-emulator` (results) |
| Learner writes own score / marks | create-only + no self-update | results / exam_attempts cases |
| Teacher reads only assigned learners | `learnerProgress.teacherUid` | rules (learnerProgress) |
| School admin scoped to own school | `isSchoolAdmin(schoolId)` | `test-school-membership-rules` |
| Normal user creates admin membership | admin-only issuance | `test-school-membership-rules` |
| Client marks a payment successful | admin-only writes | payments cases |
| Client increases AI credits / quota | server-only + blocklist | usageMeters + users `generationCredits` |
| Unauthenticated reads private data | default-deny / auth gate | public-access section |
| Published public content readable / drafts private | status gate | pastPapers published vs draft |
| Invalid field types / unexpected fields | validators + `hasOnly` | question-type + aiGenerations create |
| Storage upload outside authorized path / bad MIME / oversize | path-pin + validators | `test-storage-rules-emulator` |
| Enumeration of users/shares/parent PII | get/list split | shares + progressShares cases |

## 9. Required Firestore indexes

None added. The membership model uses only single-document `get` and
subcollection `list` under `schools/{id}/members`, which need no composite
index. (If a future `collectionGroup('members')` query is introduced for
platform-admin cross-school search, add a single-field `members.uid` /
`members.schoolId` collection-group index at that time.)

## 10. Frontend query changes

None required by this change — no existing client query is affected, because no
existing collection's rules changed. When the school-scope phased adoption
begins, each migrated collection's query must add the authorized `schoolId`
constraint in the same PR as its rule change (rules are filters' backstop, not
filters).

## 11. Deployment order

1. Merge this PR (CI runs `test:rules-text`, `test:rules-emulator`,
   `test:school-membership-rules`, `test:storage-rules-emulator`,
   `test:migrate-school-membership`, plus `test:all`).
2. Deploy rules via CI (`deploy-firebase.yml`) — Firestore + Storage rules are
   backward-compatible (purely additive; no existing grant removed).
3. (Optional, when onboarding schools) Provision the `platformAdmin` claim for
   platform operators via a Cloud Function using
   `admin.auth().setCustomUserClaims(uid, { platformAdmin: true })`, then run
   `node scripts/migrate-provision-school-membership.mjs` (dry-run first, then
   `--live`) to seed memberships, and appoint each school's first `school_admin`
   through the trusted admin path.

Because the change is additive, rules and any dependent backend can ship
together without leaving the frontend partially compatible.

## 12. Rollback procedure

- **Rules**: revert `firestore.rules` to the previous revision and redeploy via
  CI. The `schools`/`members` blocks vanish and those paths fall back to the
  default-deny catch-all (they were denied before this change too), and
  `isAdmin()` reverts to role-only. No data migration is required to roll back;
  provisioned `schools`/`members` docs simply become inert (denied) and can be
  deleted later.
- **Custom claim**: if the `platformAdmin` claim must be revoked, clear it with
  `setCustomUserClaims(uid, { platformAdmin: null })`; role-based admin is
  unaffected.
- **Migration**: it only *creates* `schools`/`members` docs and never touches
  existing collections, so rollback is deleting the created docs (or leaving
  them inert). It is idempotent, so a partial run is safely re-runnable.

## 13. Remaining risks

- **R1 (MED) — App Check observe-only by default.** A replayed/leaked ID token
  from outside the official app can still reach costly AI/TTS endpoints.
  Mitigated by verified-auth + per-user rate limits + daily quota + treasury
  budget cap. *Action:* move high-cost generators + SSE endpoints to hard
  enforcement (`APPCHECK_ENFORCE_LABELS`) once attestation health is confirmed.
- **R2 (LOW) — `syllabusOverrides.js` uses ID-token custom claims for admin**
  rather than the Firestore-role pattern used elsewhere; correctness depends on
  those claims being provisioned. *Action:* align with `assertCallerIsAdmin` or
  verify the `admin` claim is set.
- **R3 (LOW) — `assertActiveAccount` fails open on a Firestore read error**, so a
  suspended user could slip through during a Firestore blip (bounded by
  refresh-token revocation). *Action:* add a metric/alert.
- **R4 (INFO) — school-scope adoption is not yet applied to content
  collections.** They remain owner-scoped (safe, just not school-shared) until
  the phased migration in §4 runs.

## 14. Files changed

- `firestore.rules` — `isPlatformAdmin()`; membership helpers; `schools` +
  `schools/{id}/members` blocks; `isAdmin()` accepts the platform-admin claim.
- `scripts/test-school-membership-rules-emulator.mjs` — 30-case emulator suite.
- `scripts/test-firestore-rules-text.mjs` — membership forge-proofing invariants.
- `scripts/migrate-provision-school-membership.mjs` — dry-run/idempotent backfill
  + exported pure logic.
- `scripts/test-migrate-provision-school-membership.mjs` — 18-case logic tests.
- `package.json` — `test:school-membership-rules`, `test:migrate-school-membership`.
- `.github/workflows/ci.yml` — run the membership emulator suite in the rules job.
- `docs/security/RLS_AUDIT.md` — this document.

## 15. Test results (local, 2026-07-19)

- `test:rules-text` — 58 passed / 0 failed.
- `test:rules-emulator` — 154 passed / 0 failed (baseline unchanged by additions).
- `test:school-membership-rules` — 30 passed / 0 failed.
- `test:migrate-school-membership` — 18 passed / 0 failed.
- `eslint` on new/changed scripts — clean.
