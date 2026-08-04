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

- Confirm in the Google Cloud console that every bound secret has a current
  enabled version.
- Review GitHub's Secret scanning alerts for the repository.
