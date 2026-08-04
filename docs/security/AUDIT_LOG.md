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
