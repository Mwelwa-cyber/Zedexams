# Security audit log

An append-only record of security audits, incidents, and credential rotations
affecting this repository. Each entry is a point-in-time record: it is dated,
states what was checked and how, and is **never rewritten** — a later finding
gets a new entry that supersedes an older one by reference.

This is the *repository-level* log. It is distinct from the Firestore
`securityAuditLogs` collection, which records runtime security events (auth,
admin actions, rule violations) from the deployed application.

**Entries never quote a credential**, in whole or in part, even one believed to
be revoked. Findings are recorded in category terms — credential class, value
length, entropy, placeholder status — because an audit log that reproduces the
secret it is auditing is itself the leak.

---

## 2026-08-04 — Phase 0A secret exposure gate: `functions/.env.examsprepzambia`

**Verdict: no incident. No credential was ever committed; no rotation was
required; no history rewrite is necessary.**

**Trigger.** [`docs/architecture.md`](../architecture.md) §13 opens the migration
plan with a blocking Phase 0A gate, on the premise that a committed
`functions/.env.<projectId>` may hold live credentials.

**Scope.** The file at `HEAD`, plus **all 16 distinct historical versions** of it
reachable from any ref, from its introduction on 2026-04-25 (#62, the Telegram
bot) to the present.

**Method.** Every version was parsed and every byte scanned — comments included,
since a pasted webhook URL or a commented-out assignment is as committed as an
active one. Values were classified by credential format (Anthropic, OpenAI,
Google, Meta, Telegram, GitHub, Slack/Discord webhooks, JWT, PEM, AWS,
credentials-in-URL), by Shannon entropy, and by placeholder heuristics. No value
was printed to a terminal, log, commit, or chat at any point.

**Findings — current file, 9 keys, by category:**

| Keys | Category | Secret? |
|---|---|---|
| `AI_MONTHLY_BUDGET_USD`, `AI_BUDGET_FLOOR_USD`, `AI_BUDGET_MODE`, `AI_REVENUE_REINVEST_RATIO`, `AI_TREASURY_ZMW_PER_USD` | Treasury budget config (numbers, one word) | No |
| `APPCHECK_ENFORCE_LABELS` | App Check rollout label list | No |
| `FIRESTORE_BACKUP_BUCKET`, `STORAGE_BACKUP_BUCKET` | Bucket names; project id is already public in `.firebaserc` | No |
| `OPS_ALERT_EMAILS` | One ops contact address, already public in commit metadata | No — PII-adjacent |

Live credentials: **0**. Placeholders: **0** (nothing credential-shaped exists
for a placeholder to stand in for). Revoked-credential residue: **0**.

**Findings — history.** Zero credential-format and zero high-entropy hits across
all 16 versions. The earliest version (2026-04-25) carried a numeric Telegram
chat id and a username allowlist — mild information disclosure at most, both
removed on 2026-05-01. The Telegram bot's actual token and webhook secret were
`defineSecret()` (Secret Manager) from the first commit, as were the retired MTN
payment keys.

**Exposure assessment.** The file is tracked in a **public** repository and was
reachable from 383 of 431 remote branch tips. Exposure would therefore have been
total and irreversible had the file held a credential — rotation would have been
mandatory and history rewriting futile. It did not.

**Bindings verified (static).** The 13 `defineSecret()` names (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `LENCO_API_KEY`, `EMAIL_SMTP_USER`/`_PASSWORD`,
`GITHUB_APP_ID`/`_INSTALLATION_ID`/`_PRIVATE_KEY`, `GITHUB_BOT_TOKEN`,
`GOOGLE_PLAY_SA_JSON`, `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`),
the string-bound `OPS_ALERT_WEBHOOK_URL`, and the WhatsApp
verify-token/app-secret pair are **disjoint** from this file's key set. CI
deploys authenticate via GitHub Actions secrets and never write into the file.
Live Secret Manager version state (secrets present, versions current) requires
console access and is an owner check, not verifiable from a CI or agent session.

**Decisions.**

1. **The file stays tracked.** `functions/.env.<projectId>` is the documented
   Firebase mechanism for non-secret runtime config and must exist at deploy
   time. Removing it would strip live budget caps, App Check labels, backup
   buckets and alert recipients from the next functions deploy. §13 step 6's
   removal was conditional on finding secrets; none were found.
2. **No rotation, no history rewrite.**
3. **The gap that made this audit necessary is now closed in CI.**
   `scripts/test-secret-hygiene.mjs` previously checked file *names* and PEM
   blocks only, so the one dotenv file allowed to be committed was the one file
   whose contents nothing read. It now scans every tracked dotenv file for
   credential formats and for opaque high-entropy values under secret-bearing
   key names, and it carries a self-test that plants synthetic credentials to
   prove the scanner can still fail. Failures report file, line, and credential
   class — never the matched text, because CI logs are widely readable.

**Standing rule.** `functions/.env.<projectId>` is for values safe to read in a
public repository. A real secret goes to `firebase functions:secrets:set` and is
bound with `defineSecret()`.

**Open follow-ups (owner action, outside this audit):**

- ~~Confirm in the Google Cloud console that every bound secret has a current
  enabled version.~~ → Closed by the Secret Manager review entry below.
- Review GitHub's Secret scanning alerts for the repository. → See the
  2026-08-04 `.playwright/` entry below, which identifies alert #1.

---

## 2026-08-04 — Secret-scanning alert #1: the committed `.playwright/` browser profile

**Verdict: key material was committed, but it protected nothing. No credential
was exposed, no rotation is required. The tree is untracked and a CI guard now
prevents recommitting it.**

**Trigger.** GitHub secret-scanning alert #1, raised against tracked browser
profile directories.

**What was tracked.** 318 files across two directories, added April 2026 in
`bff30e37` and `fa6b9fd0`:

| Path | Contents | Assessment |
|---|---|---|
| `.playwright/qa-profile/` (206 files, 27 MB) | A real Chromium profile: `Network/Cookies`, `Login Data`, `Login Data For Account`, `Trust Tokens`, `Device Bound Sessions`, `Session Storage`, `passkey_enclave_state`, and `Local State` | Credential-**shaped**; see below |
| `.playwright-cli/` (112 files) | Dated `page-<timestamp>.yml` page snapshots, 15–19 April 2026 | Session scratch |

**The finding.** `Local State` carries an `os_crypt.encrypted_key` — 392
characters of base64 key material, the key Chromium uses to encrypt cookie
values. Committing it beside the cookie database is what makes stored cookies
recoverable, and it is the most likely trigger for the alert.

**Why this is not an incident.** Every credential store was **empty in every
committed version**. Both commits that carried the profile have `cookies = 0`
and `logins = 0`; the two earlier commits did not include those files at all.
The key therefore protected nothing that was ever committed. The 112 page
snapshots contain no credential-format matches; the only email addresses in
them are test fixtures (`@email.com`, `@example.com`) plus two personal
`@gmail.com` addresses — PII in a public repo, not credentials.

**Consumer check before removal.** `.playwright/` was referenced only by
*exclusion* rules (`eslint.config.js`, `check-file-integrity.mjs`'s skip list,
`.gitignore`), which stay in place. `.playwright-cli/` was referenced by three
documents as "the Playwright smoke harness" (`.claude/agents/qa-smoke.md`,
`ORG.md`, `src/config/agents.js`) — but it held only page snapshots, never a
harness. Those references now point at `npm run smoke`, the harness that
actually exists. `.playwright-mcp.config.json` is a genuine tracked config with
a live consumer (`test:playwright-mcp-env`) and was deliberately left alone.

**Actions taken.** Both directories untracked (`git rm --cached`, left on disk),
`.playwright-cli/` added to `.gitignore` — `.playwright/` was already ignored,
which is why this went unnoticed: an ignore rule does nothing about a file that
is already tracked. `test:secret-hygiene` now matches these trees by
**directory**, because the credential-bearing members have innocuous,
extensionless names (`Local State`, `Login Data`, `Network/Cookies`) that no
per-file rule would catch.

**History.** The files remain in git history and untracking does not remove
them. Given that the stores were empty and the key protects nothing, a history
rewrite is **not** warranted; the alert should be resolved in the GitHub UI as
used-in-tests/revoked rather than by rewriting a public repository's history.

**Open follow-up (owner action):** close alert #1 in the repository's
Security → Secret scanning view.

---

## 2026-08-04 — Secret Manager review: orphaned secrets removed

**Verdict: no incident. Housekeeping that closes the Phase 0A step-4 follow-up.**

The Phase 0A audit could verify secret *bindings* statically but not live Secret
Manager state, which needs console access. That review has now been done by the
project owner, with two outcomes.

**Superseded versions are disabled after every rotation.** A rotation that
leaves the previous version enabled has not reduced the blast radius of the leak
it was answering, because both values still authenticate.

**Secrets no longer referenced by any code were removed** — RevenueCat,
`ZED_GITHUB_TOKEN`, and the Firebase App Hosting secrets. All three are
confirmed absent from the tree: the repository contains zero references to
RevenueCat or `ZED_GITHUB_TOKEN`, and no `apphosting.yaml` (deploys go through
Firebase Hosting via GitHub Actions). `ZED_GITHUB_TOKEN` is most likely a
leftover of the Telegram `zedAssistant`, removed in #181. An orphaned secret is
worse than an unused one: nothing in the codebase says what it grants, so no
review notices when it should have been revoked.

**Order matters when removing one.** Delete the `defineSecret()` reference and
deploy *before* destroying the secret. A `defineSecret()` bound to a secret with
no value makes `firebase deploy` hard-fail and blocks **every** functions
deploy — the trap already documented for `RECRAFT_API_KEY` and `OPS_ALERT_WEBHOOK_URL`.

**Not an orphan: `META_WHATSAPP_APP_SECRET`.** It is unset, and the inbound
WhatsApp webhook (`apiWhatsAppWebhook`) therefore answers **403 to every
request** — `functions/index.js` fails closed in both directions (bad signature
*and* unverifiable), and the `WHATSAPP_ALLOW_UNVERIFIED` staged-rollout escape
hatch was deliberately removed. This is the designed posture, not a gap: an
unverified public webhook that can trigger Anthropic spend, auto-sent WhatsApp
replies and Firestore writes must refuse traffic rather than accept it. The
consequence to be aware of is operational, not security-related — **Bonga cannot
receive inbound messages until the secret is bound.** Binding it is what turns
the channel on; the binding itself is correct as it stands.

Recorded as principle 8 in [`docs/architecture.md`](../architecture.md) §11.

---

## 2026-08-05 — Vertex Express API keys deleted

**Verdict: no incident. Two unused, unrestricted-by-application API keys removed
before they could be found. Reversible until 2026-09-04.**

**Trigger.** Console-track review of the project's API credentials.

**What "Vertex Express" was — not established, and that is part of the
finding.** No record of why the `vertex-express@` service account was
provisioned, or what these two keys were meant to serve, survives in this
repository or in the material reviewed on 2026-08-05: the name appears nowhere
in the codebase, and both keys were created within an hour of each other on
2026-04-18 and then never used. The plausible reading is an abandoned Vertex AI
Express-mode experiment from the project's first weeks, but no record survives
to confirm it. The absence matters on its own terms: a credential
nobody can explain is exactly the kind that survives reviews, because each
reviewer assumes someone else knows what it is for.

**What was deleted.**

| Credential ID | Created (GMT+2) | Bound to |
|---|---|---|
| `e3c34aaf-dab6-49a7-85bf-fb2042a51cf6` | 2026-04-18 23:03 | `vertex-express@examsprepzambia.iam.gserviceaccount.com` |
| `f628b584-5d08-4fbf-b312-31b596dc0327` | 2026-04-18 23:58 | `vertex-express@examsprepzambia.iam.gserviceaccount.com` |

Both carried **no API restrictions and no application restrictions**.

*On recording the IDs:* they are here for audit-trail completeness — a deletion
record that cannot identify what was deleted is not a record. They are GCP
credential **resource identifiers**, not key strings: they authenticate to
nothing, and inspecting or restoring what they name requires console access to
the project, so they are outside what this log's no-quoting rule protects
against.

**Evidence they were unused.** Three independent reads, all negative:

- Zero requests attributable to either key UUID across all APIs over a six-week
  Cloud Monitoring window (`serviceruntime` `api_request_count`, grouped by
  service and `credential_id`).
- "No data" on Gemini API, Vertex AI, Firebase AI Logic and Firestore with the
  console metrics view filtered to these two credentials over its maximum
  30-day window.
- Neither key is registered to Firebase AI Logic, which runs on the Browser and
  Android keys.

**Correction to an earlier characterisation.** These keys were initially
described as "uncapped". **They were not.** A service-account-bound key is
limited by Google to the Agent Platform (Vertex) API and the Gemini API
regardless of local configuration, so the API axis was never wide open. The
genuinely open axis was **Application restrictions = None** — any caller from
anywhere could have used one had it leaked. The distinction matters because it
changes what the exposure would have been, and this log is where a future reader
will look to find out.

**Reversibility. RESTORE WINDOW ENDS 2026-09-04.** Deletion is a GCP soft-delete;
until that date both keys can be restored via **APIs & Services → Credentials →
Restore deleted credentials**. After it, they are unrecoverable.

**Open follow-up (owner action):** `vertex-express@` now holds no keys. Disable
the service account — itself reversible — **after 2026-09-04**, and only once
it is confirmed to have no IAM bindings and no code references.

---

## 2026-08-05 — External probe traffic on the Gemini API, none of it successful

**Verdict: no incident. Every request failed. Which control did the failing is
only partly established — 403s and 429s are different controls and the split
between them was never captured, so no portion can be sized. Read "Two failure
modes" below before citing this entry as proof that key restrictions held.**

**Trigger.** Console-track review of API traffic.

**What was observed.** Over the 30 days to 2026-08-05,
`generativelanguage.googleapis.com` received **127 requests, all of which
failed** — 403 or 429, with the split between the two never captured (this
matters; see "Two failure modes" below):

| Method | Requests |
|---|---|
| `ModelService.ListModels` | 69 |
| `GenerativeService.GenerateContent` | 44 |
| `v1beta ModelService.ListModels` | 14 |

The traffic was spread across the Browser key, the Android key, and
`zedexams-maps-static` — **a Maps-only key, which is the tell.** Nothing in this
product would ever ask a Maps key for a language model.

**Why none of it can be ours.** All legitimate *client* AI goes through Firebase
AI Logic (`firebasevertexai`), not this API. The repository does call
`generativelanguage.googleapis.com` directly, but only **server-side** —
`functions/geminiClient.js` and `functions/geminiImageClient.js` — and those
authenticate with the `GEMINI_API_KEY` Secret Manager value, a different
credential from the three client keys this traffic used. So traffic on this API
attributed to a *client* key is by construction not ours.

**Assessment — an inference, and labelled as one.** The pattern is *consistent
with* external abuse of public client keys harvested from the shipped JS bundle
and the APK, probing for an unrestricted key and bounced by the Firebase default
25-API allowlist, which does not include the Gemini API. That is the most
economical explanation, and a Maps-only key asking for a language model is
difficult to explain any other way. It is **not proven**: the same traffic would
also be consistent with a misconfigured internal test, a third-party SDK
bundling the wrong key, or a developer's local experiment. What *is* established
rather than inferred is narrower and sufficient — none of it succeeded, and none
of it was ours (see above). The Logs Explorer check below is what would settle
the mechanism.

**Two failure modes, and they are not the same control.** The errors were
recorded as "403 and 429" without a split by status code, and the two mean
different things:

- **403** is the API-key allowlist denying the call — the control this entry is
  about. It holds regardless of load and does not lift.
- **429** is quota or rate limiting. A request that 429'd was **not** repelled
  by the API restriction; it was throttled, and throttling can lift if quota
  changes. It also does not prove the caller lacked permission.

Because the split was not captured, **the share of the 127 attributable to the
key restriction versus to throttling is unknown.** Stated precisely, what this
traffic establishes is:

- **None of it succeeded.** Solid — every one of the 127 returned an error.
- **Some requests were refused by the key restrictions.** Established only in
  that 403s occurred at all; *how many* is unknown, so no portion of the 127 can
  be sized.

Anything stronger than those two — including "the restrictions repelled this
traffic" as a claim about the whole 127 — is not supported by what was measured.
This was missed on first writing and is corrected here rather than silently: a
security record that credits the wrong control is worse than one that admits the
gap, because the next person may relax the control that was actually doing the
work.

**Significance — read this before changing a key restriction.** Client keys ship
to every browser and every APK, so the restriction list, not the key's secrecy,
is the control. That 403s appear at all is dated evidence that the list is doing
real work and is not a formality left over from setup.

> **Do not loosen the API restrictions on the Browser, Android or
> `zedexams-maps-static` keys without revisiting this entry.** And note the
> second-order version: if any of these probes were merely throttled rather than
> refused, loosening *quota* alone could let them start succeeding.

**Required confirmation, not yet done** (upgraded from "optional" by the above).
Logs Explorer should show, per request: `PERMISSION_DENIED` with a
key-restriction reason such as `API_KEY_SERVICE_BLOCKED` versus
`RESOURCE_EXHAUSTED`, broken down by credential and method, and callers that are
not our origins. Until that runs, treat the 429 subset as unconfirmed.

---

## 2026-08-05 — Client-side Firebase AI Logic: two consumers, one request in six weeks, failing on quota

**Verdict: not a security issue. A product bug — two teacher features are
silently failing — plus an open architecture question.**

**Trigger.** Console-track review of API traffic.

**What was observed.** `firebasevertexai.googleapis.com` served **exactly one
production request over six weeks, and it returned 429.**

**Consumers.** The codebase has exactly two, both verified against the tree:

| File | How it calls AI Logic |
|---|---|
| `src/utils/timetableExtraction.js` | dynamic `await import('./aiLogic.js')` → `generateJSON` |
| `src/utils/forecastResourceSuggest.js` | static `import { generateJSON } from './aiLogic'` |

Both reach Gemini through `src/utils/aiLogic.js` → `src/firebase/ai.js`. No
other module imports either.

**Assessment.** A product bug rather than a security issue: the AI Logic path
appears to have **no paid quota configured**. The single request in six weeks is
also the measure of the blast radius — whatever is decided below, almost nobody
is currently affected.

**How each one fails — checked against the error paths, not assumed.** The two
consumers do *not* behave the same way on a 429, and the initial "both fail
silently" characterisation was only half right:

- `forecastResourceSuggest.js:65-68` catches, `console.warn`s, and returns
  `{ teacherResources: [], learnerResources: [] }`. **Genuinely silent** — the
  teacher sees empty suggestions with no indication anything failed.
- `timetableExtraction.js:342-346` catches and **throws a user-facing message**,
  so it is *not* silent. But the message is *"Could not read the timetable. Try
  a clearer photo, or upload a PDF / Excel version."* — which on a quota failure
  is **actively misleading**, blaming the teacher's file and sending them off to
  re-photograph a timetable that was never the problem. Distinguishing a
  transport/quota failure from an unreadable file belongs in the fix.

**Open follow-ups:**

- **(a) Quota — file and fix.** Filed as `AI-004` in
  [`BUG_REPORT.md`](../../BUG_REPORT.md).
- **(b) Architecture — should these two features route through the server-side
  Cloud Functions AI stack instead of calling AI Logic from the client?**
  Recorded against the existing **P1-c** item in
  [`docs/architecture/25-remediation-plan.md`](../architecture/25-remediation-plan.md),
  which already tracks exactly this migration (`RISK-4`, "Client-side Gemini
  bypasses AI budget/quota/cost"). It is filed there rather than in a new
  open-questions section so it resurfaces where a migration PR will actually
  read it.

---

## 2026-08-05 — `storage-detect-objects` extension uninstalled; derived Vision output deleted

**Verdict: undisclosed third-party processing of user uploads, now stopped. No
breach and no credential exposure, but for about 110 days every image finalized
in the default bucket — including user profile photos — was sent to Cloud Vision
by a third-party extension, and the results were written to a collection nothing
ever read. The processing has ended; the residue has not yet been deleted.**

**Trigger.** Console-track review of installed Firebase Extensions.

**What was installed.**

| | |
|---|---|
| Extension | `jauntybrain/storage-detect-objects@0.1.0`, instance ID `storage-detect-objects` |
| Publisher | **`jauntybrain` — a third party, not Firebase or Google** |
| Function | `ext-storage-detect-objects-detectObjects`, Node.js 20, 1 GB, `us-central1` |
| Trigger | Cloud Storage **finalize** on `examsprepzambia.firebasestorage.app` |
| Deployed | 2026-04-17 23:27 CAT |
| Uninstalled | 2026-08-05 (active ≈110 days) |

**Removal verified twice:** the extension no longer appears under Installed
extensions, and `ext-storage-detect-objects-detectObjects` no longer appears in
the 1st-gen functions list.

**Scope as configured — the finding is in what was left blank.**

| Parameter | Value |
|---|---|
| Bucket | `examsprepzambia.firebasestorage.app` |
| Paths containing images to detect objects in | **not set** |
| Absolute paths not enabled for object detection | **not set** |
| Collection path | `detectedObjects` |
| Detail level | basic |

Both path parameters unset means it watched **the entire default bucket with no
exclusions** and ran Cloud Vision `BatchAnnotateImages` on every finalized
object for the full active period. It also processed the derivative thumbnails
written by `storage-resize-images` (`_200x200`, `_400x400`, `_800x800` `.webp`),
so a single user upload could produce up to four Vision calls and four
documents.

**What it produced.** 3,944 documents in the root collection `detectedObjects`.
The schema is exactly two fields — `file` (string, `gs://` URI of the analysed
object) and `objects` (array of Vision label strings, frequently empty). There
is no timestamp, no user-identifier field and no reference back to any app
entity; **the primary link to a user is the uid embedded in the storage path.**
"Primary" rather than "only" deliberately: most upload paths are owner-scoped
(`papers/{uid}/{paperId}/…` and siblings), but not provably all of them — the
legacy single-segment `papers/{fileName}` form noted in
[`storage-hardening.md`](./storage-hardening.md) §6 carries no uid, and the
3,944 `file` values were not enumerated to confirm the shape of every one.

Distribution by storage prefix, counted by Firestore `COUNT` aggregations on
2026-08-05, totalling 3,944:

| Prefix | Documents |
|---|---|
| `papers/` | 1,492 |
| `quiz-images/` | 944 |
| `assessment-images/` | 772 |
| `picture-bank/` | 364 |
| `slide-notes-images/` | 324 |
| `lesson-files/` | 28 |
| `visual-studio/` | 12 |
| `user-branding/` (profile photos) | 8 |
| **Total** | **3,944** |

All eight prefixes are user-uploaded content, and the last row is the one to
read twice: those eight documents carry `Person` and `Clothing` labels —
**object detection was running over user profile pictures.**

**Nothing ever read it — verified against `HEAD`. It was write-only *and*
client-unreadable.** `detectedObjects` appears nowhere in this repository: no
reads, no writes, no security rule, no composite index, no cleanup path. Two
consequences follow from that absence:

- Having **no `match` block in `firestore.rules`**, the collection falls to the
  default-deny catch-all (`match /{document=**}`), so no client could read it
  either. It was write-only *and* client-unreadable for its entire life.
- It is **absent from the account-deletion purge lists** in
  `functions/accountDeletion.js` (drift-tested by
  `accountDeletionDrift.test.js`). A user who deleted their account therefore
  left these documents behind. This is moot once the collection is deleted, and
  it is one more reason to delete rather than keep.

**Status at removal — this was live, billable traffic, not a dormant leftover.**
`vision.googleapis.com` metrics over the 30 days to 2026-08-05 showed only
`google.cloud.vision.v1.ImageAnnotator.BatchAnnotateImages`, **100% HTTP 200,
zero errors**, still ticking at the moment of uninstall.

**What the uninstall removed.** Per the uninstall dialog: the `detectObjects`
function and its service account, which held **Storage Object Admin** and
**Cloud Datastore User**. Artifacts it created were left behind by the
uninstall and were removed separately — see "The output it left behind" below.

**Privacy note.** This extension was never named in any privacy disclosure, Play
data-safety declaration, or user-facing policy — and now never needs to be.
Uninstalling stopped both the per-upload Cloud Vision calls and the third-party
extension's read access to the bucket.

**The output it left behind — deleted.** The uninstall stopped the processing
but left its 3,944 `detectedObjects` documents in place; they were deleted
separately (see the closing line). Data minimisation argued for keeping *the
record of what was processed* rather than *the product of the processing*. This
entry is that record, and is deliberately detailed enough that the collection
added little.

**The trade-off, stated rather than assumed away.** Deleting it did forfeit
something: the collection was the only per-object list of exactly which files
Vision analysed, which could in principle have mattered in a future dispute
about what was processed. Three things made that value thin, and they are why
the decision stood:

- **There was no timestamp on any document** (the schema is `file` + `objects`,
  nothing else), so it could not establish *when* anything was processed — only
  that it was, at some point inside a 110-day window this entry already records.
- The **prefix distribution above, plus the total, plus the dated active
  period** preserve the shape of what was processed without retaining a
  per-file index of user uploads.
- Keeping a derived index of user content *specifically as evidence* is itself a
  retention decision that would need a privacy basis, and the extension it came
  from was never disclosed to users in the first place.

The honest summary is that this was a judgement, not an arithmetic result: thin
evidentiary value against continued retention of user-derived data that nothing
read and no purge path covered.

Deletion was a permanent Firestore operation with **no undo and no restore
window**, so it was run by the project owner — not by an agent or an assistant.

**Collection deleted: 2026-08-05.** All 3,944 documents removed. Verified two
ways by the owner at the time of deletion: `detectedObjects` no longer appears
in the Firestore root collection list (which now runs `dailyStreaks`,
`daily_exam_locks`, `drafts` with nothing between them), and navigating directly
to the `detectedObjects` panel URL renders an empty collection with zero
documents. **This entry is now the only surviving record of what was
processed** — which is what it was written to be.

**Forward note.** The finding that detect-objects was analysing
`storage-resize-images` output feeds the next console item:
`storage-resize-images` stays installed but needs its path scope narrowed and
its "make public" setting reviewed, and the eight prefixes above are the real
map of what it is producing derivatives for. Recorded in
[`docs/security/storage-hardening.md`](./storage-hardening.md) §6.
