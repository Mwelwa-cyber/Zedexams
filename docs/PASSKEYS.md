# Passkey (WebAuthn) sign-in

How ZedExams users sign in with the biometric or device-lock method already on
their phone, tablet, or computer — fingerprint, face, PIN, screen-lock
password, or a hardware security key. This is a **standing reference** for the
architecture and its operational procedures; if reality and this doc diverge,
fix one of them in the same PR.

## Architecture

```
User device authenticator (fingerprint / face / PIN / screen lock / security key)
        ↓ (biometric check happens ON the device — nothing biometric is sent)
WebAuthn browser API  (@simplewebauthn/browser handles ArrayBuffer ⇄ Base64URL)
        ↓
ZedExams Cloud Function (callables in functions/index.js → functions/passkeys/)
        ↓
@simplewebauthn/server verifies challenge, origin, RP ID, signature, UV/UP
        ↓
uid resolved from the SERVER-HELD credential record (never from the client)
        ↓
admin.auth().createCustomToken(uid)
        ↓
Frontend signInWithCustomToken(auth, token)
        ↓
Existing Firebase user session restored — same uid, role, claims, subscription
```

No custom cryptography anywhere: all WebAuthn verification is
`@simplewebauthn/server` (v13). Pure decision logic (challenge validation,
counter checks, rollout gating, limits) lives in
`functions/passkeys/passkeyCore.js` (plain-node tested); Firestore/SimpleWebAuthn
I/O lives in `functions/passkeys/passkeyService.js`; the `onCall` wrappers
(region, App Check telemetry) are in `functions/index.js`. The one client
entry point is `src/services/passkeyService.js`.

## Cloud Functions (v2 callables)

| Function | Region(s) | Auth | Purpose |
|---|---|---|---|
| `generatePasskeyRegistrationOptions` | `us-central1` (+ `africa-south1` twin `…Africa`) | signed-in + recent auth | mint registration options + challenge |
| `verifyPasskeyRegistration` | `us-central1` (+ `africa-south1` twin `…Africa`) | signed-in | verify attestation, persist credential |
| `generatePasskeyAuthenticationOptions` | `us-central1` (+ `africa-south1` twin `…Africa`) | none (rate-limited per IP) | mint auth options + challenge |
| `verifyPasskeyAuthentication` | `us-central1` (+ `africa-south1` twin `…Africa`) | none (rate-limited per IP) | verify assertion → custom token |
| `listUserPasskeys` | `us-central1` only | signed-in | safe metadata for own passkeys |
| `renameUserPasskey` | `us-central1` only | signed-in owner | rename |
| `removeUserPasskey` | `us-central1` only | signed-in owner + recent auth | delete credential (immediate) |

All follow the repo conventions: `assertVerifiedAuth` (authGuard),
`assertCallableRateLimit` (rateLimit.js — per-IP buckets cover the pre-auth
endpoints), `enforceAppCheck: shouldEnforceAppCheck(label)` under the graduated
`APPCHECK_ENFORCE` rollout, `HttpsError` with a machine-readable
`details.code` (`PASSKEY_*`).

## Regional deployment (staged us-central1 → africa-south1 migration)

> Snapshot as of 2026-07-22 — the migration is mid-flight; verify the flag
> state and deployed twins before acting.

**Why.** The `(default)` Firestore database lives in `africa-south1`; the
passkey callables were born in `us-central1`. A sign-in performs ~6 sequential
Firestore operations (challenge-consume transaction, credential get, counter
transaction, active-account check, profile get, audit write), each paying a
US↔ZA round trip (~180–250 ms). Measured before the migration: warm sign-in
≈ 2.9 s, cold ≈ 4.5 s, while the WebAuthn cryptography itself is ~4 ms —
the latency is overwhelmingly cross-region Firestore, which colocating the
functions removes.

**What.** The four FLOW callables have `africa-south1` twins exported as
`<baseName>Africa` (temporary migration names), deployed ALONGSIDE — never
replacing — the `us-central1` originals. Twins are built by
`passkeyRegionalCallable()` in `functions/index.js` from the registry in
`functions/passkeys/passkeyRegions.js`: the SAME handler, runtime options
(30 s / 256 MiB), and App Check enforcement key (the base name), so request/
response schemas, challenge/replay/counter/origin/RP-ID checks, rate limits
and error codes are identical by construction (pinned by
`passkeyRegions.test.js`). Both regions share the one Firestore database, so
challenges/credentials/audit rows are region-agnostic — a flow can even
complete cross-region. The three management callables stay `us-central1`
only: they are not on the sign-in path.

**Routing + rollback flag** (`settings/global.featureFlags.passkeyFunctionsRegion`):

```jsonc
{ "mode": "off" }                                  // default: everyone on us-central1
{ "mode": "pilot", "pilotUids": ["<testTeacherUid>"] }  // phase 1: only the approved test teacher
{ "mode": "all" }                                  // full regional rollout
```

Resolved in ONE place — `src/services/passkeyService.js` via the pure
`src/services/passkeyRegionCore.js` (mirrors the server registry; guarded by
`scripts/test-passkey-region-routing.mjs`). The service keeps a live snapshot
of `settings/global`, so **rollback is a flag flip, no redeploy**: set
`mode: "off"` (or delete the field) and the very next attempt routes to
`us-central1`. Fail-safe: missing/invalid config, flag read errors, and
storage errors all resolve to `us-central1`.

- **Authenticated flows** (registration): the uid is checked against
  `pilotUids`.
- **Pre-auth sign-in**: no uid exists yet, so pilot devices are primed with a
  hint — after a successful authenticated passkey operation by a pilot uid,
  the service stores the bare region name under
  `zedexams.passkeyRegionHint` in localStorage (routing metadata only; never
  credential/challenge/token material). The hint is re-validated against the
  live flag on every use and cleared post-sign-in whenever the resolved uid
  no longer routes regionally — so a rollback also scrubs pilot devices.
- **Fallback**: a regional call that fails `functions/not-found` (twin absent;
  plus `functions/unavailable` for the options step only) is retried once on
  `us-central1`. The verify step is never retried on ambiguous failures —
  and even a double-submit fails closed on the single-use challenge
  (`PASSKEY_CHALLENGE_REUSED`), never replays.

**Latency telemetry.** Both sign-in-path handlers log a
`PASSKEY_AUTH_TIMINGS` line (stage names + ms + serving region + outcome —
never uids/challenges/ids/tokens): stages `preChecks`, `challengeConsume`,
`credentialLookup`, `webauthnVerify`, `counterTxn`, `profileLookup`,
`customToken`, `auditWrite`, plus `totalMs` (canonical list:
`PASSKEY_AUTH_TIMING_STAGES` in `passkeyCore.js`). Query Cloud Logging for
`PASSKEY_AUTH_TIMINGS` and compare `region:"us-central1"` vs
`region:"africa-south1"` samples. Validation bar before widening the rollout:
≥30 warm + ≥5 cold successful regional sign-ins, the negative suite (expired/
reused challenge, bad assertion, counter rollback, unknown credential, App
Check rejection) behaving identically, no failure-rate increase, no duplicate
`passkeyAuditLog` rows, p50/p95/max reported per stage. Target: warm
server-side verify < 1 s.

**Deployment sequence** (functions normally ship via `deploy-firebase.yml`
on merge; the scoped commands below are for a controlled manual rollout —
functions deploys are otherwise CI-only per CLAUDE.md):

```bash
# 1. deploy ONLY the new twins (existing functions untouched):
npx firebase deploy --only functions:generatePasskeyRegistrationOptionsAfrica,functions:verifyPasskeyRegistrationAfrica,functions:generatePasskeyAuthenticationOptionsAfrica,functions:verifyPasskeyAuthenticationAfrica
# 2. confirm the originals still exist and serve:
npx firebase functions:list | grep -i passkey
# 3. flip the flag to pilot for the test teacher; test register + sign-in +
#    all negative paths; watch PASSKEY_AUTH_TIMINGS + passkeyAuditLog.
# 4. rollback drill: set mode:"off", confirm the next sign-in uses us-central1.
# 5. widen (mode:"all") only after the validation bar above is met.
```

**Old-function removal** is a separate, explicitly-approved step after the
observation window closes (originals kept throughout; nothing in this
migration deletes them). Sequenced after removal approval: fold the twins
back to the base names in one region, update the client, then delete. A
`minInstances: 1` evaluation for `verifyPasskeyAuthenticationAfrica` (cold
starts only; idle-cost trade-off) and any Firestore-operation
reduction/parallelisation (audit-write placement, transaction return values)
are ALSO separate follow-ups — do not bundle them with the region move, and
never parallelise challenge consumption or the counter transaction.

## Relying-party configuration (environment-managed)

| Env var (functions runtime) | Default | Notes |
|---|---|---|
| `PASSKEY_RP_ID` | `zedexams.com` | NEVER the Firebase project domain in production |
| `PASSKEY_ALLOWED_ORIGINS` | `https://zedexams.com` + `https://www.zedexams.com` | comma-separated; wildcards are refused (fail-closed); both production origins are always appended (mirrors `functions/cors.js`) |
| `PASSKEY_REAUTH_WINDOW_MIN` | `60` | how recent the first-factor sign-in must be to add/remove a passkey |

Local development: run the functions emulator with `PASSKEY_RP_ID=localhost`
and `PASSKEY_ALLOWED_ORIGINS=http://localhost:5173`. (WebAuthn treats
`localhost` as a secure context; any other origin must be HTTPS.)

No secrets are involved — there is no passkey API key. The credential public
keys in Firestore are not secret; the private keys never leave the user's
authenticator.

## Firestore collections (all server-only — rules deny every client read/write)

- `passkeyCredentials/{credentialId}` — `{ credentialId, uid, publicKey
  (base64url), counter, transports, deviceType, backedUp, name, createdAt(+Ms),
  lastUsedAt(+Ms), revokedAt, createdByIpHash, userAgentSummary }`. Doc id =
  WebAuthn credential id, so uniqueness is enforced by `tx.create()` and
  lookup at sign-in is a single doc get. The record is the ONLY source of the
  uid a passkey signs in.
- `webauthnChallenges/{challengeId}` — `{ challengeHash (sha256 — the raw
  challenge is never stored), operation: 'registration'|'authentication', uid
  (registration only), createdAt, expiresAt (5 min), consumedAt }`. Single-use:
  consumed inside a transaction BEFORE verification, so replays always find a
  consumed challenge. **TTL**: set a Firestore TTL policy on `expiresAt`
  (out-of-band via console/gcloud, same convention as `rateLimits.expireAt`).
- `passkeyUserHandles/{uid}` — opaque random WebAuthn user handle, so the
  authenticator never stores a readable Firebase UID.
- `passkeyAuditLog/{id}` — append-only security trail (admin-read):
  `PASSKEY_REGISTERED / _AUTHENTICATION_SUCCEEDED / _AUTHENTICATION_FAILED /
  _RENAMED / _REMOVED / _REVOKED / _CHALLENGE_EXPIRED / _REPLAY_REJECTED` with
  uid, sha256 of the credential id, coarse UA category, IP hash, timestamp.
  Never biometrics, assertions, tokens, or raw ids.

Clients get passkey metadata exclusively through `listUserPasskeys` (never the
public key or counter). No credential, challenge, or token material ever
touches localStorage — the only passkey-adjacent entry is the region routing
hint (a bare region name; see "Regional deployment" above).

## Rollout / feature flag

`settings/global.featureFlags.passkeyAuthenticationEnabled` (default **off**,
fail-closed on read errors) gates the login button, the settings section, and
all four registration/authentication functions server-side. Staged rollout:

1. **Internal testing** — flag on + `featureFlags.passkeyRolloutUids: [...]`
   listing designated staff **test accounts** (teacher/learner roles — see the
   administrator note below).
2. **Staff beta** — `featureFlags.passkeyRolloutRoles: ['teacher']`.
3. **Optional public enrolment** — clear both rollout lists (empty = everyone).
4. **Broader promotion** — only after recovery, revocation, analytics and
   cross-device testing are verified.

The rollout lists narrow who may **register**; sign-in only needs the master
flag (only enrolled users can authenticate anyway). Management
(list/rename/remove) is never gated, so users can clean up even mid-rollback.
The client hides "Add a passkey" for users outside the rollout
(`canRegisterPasskeys` in `src/services/passkeyService.js`) and the server
enforces the same decision (`isPasskeyRolloutAllowed` in `passkeyCore.js`).
The toggle is exposed in `/admin/settings` → Developer → Feature flags.

**Administrator accounts are excluded** (registration AND sign-in both refuse
with `PASSKEY_ADMIN_MFA_REQUIRED`): admins are under mandatory TOTP MFA, and
`functions/security/requireAdminMfaCore.js` deliberately never accepts a
custom-token session as second-factor proof — a passkey session would strand
an admin outside every privileged callable. Revisit only together with that
guard's semantics (e.g. minting a recognised second-factor claim), never by
weakening it from the passkey side.

**Rollback**: turn the flag off. Sign-in and registration stop immediately
(server-side); existing sessions are unaffected; Google/password sign-in is
untouched. Credentials stay stored, so re-enabling restores everything.

## Registration flow (Settings → Security → Passkeys)

Explicit user action only — never auto-registered after Google/password
sign-in, with the shared-device warning ("Only add a passkey on a device you
personally control…") and a "Not now" option shown first. The server requires
a signed-in user whose first factor is recent (`PASSKEY_REAUTH_REQUIRED`
otherwise), enforces the 10-passkey cap, excludes already-registered
credentials, and demands `residentKey: 'required'` + `userVerification:
'required'` (discoverable credentials). After the authenticator confirms, the
user can name the passkey (defaults from a coarse UA category).

## Account recovery

Passkeys are additive — Google sign-in, email/password, and password reset are
unchanged. Lost device: sign in with another method → Settings → Security →
Passkeys → remove the lost passkey (it stops working on the next sign-in
attempt) → optionally register the replacement device. The UI blocks removing
the last passkey only if the account somehow has no password/Google fallback.

Account deletion purges all passkey data: `passkeyUserHandles/{uid}` and every
`passkeyCredentials` / `passkeyAuditLog` row carrying the uid are in
`functions/accountDeletion.js`'s purge lists, so `deleteMyAccount` removes
them with the rest of the account.

## Client error codes → copy

`src/services/passkeyService.js` maps `PASSKEY_*` codes (and browser
`NotAllowedError`/`AbortError` cancellation, which is neutral, not an error)
to the launch copy: unsupported browser, cancelled, could-not-verify, network
failure, unknown/removed credential, limit reached, re-auth required.

## Supported browsers

Chrome/Edge (Windows, Android, desktop), Safari 16+ (macOS/iOS), Samsung
Internet where Credential Management is available. Feature detection via
`browserSupportsWebAuthn()`; unsupported browsers see "Passkeys are not
supported on this browser…" and the normal methods keep working. Conditional
mediation (autofill passkeys) is intentionally NOT wired yet — not a launch
blocker.

## Tests

- `npm run test:passkeys` — `functions/passkeys/passkeyCore.test.js` (pure
  logic: challenge expiry/replay/binding, counter rollback, revocation, limit,
  rollout, origin allowlist, safe-metadata shape) +
  `functions/passkeys/passkeyService.test.js` (handler flows against the
  in-memory Firestore stub: signed-out/duplicate/wrong-challenge/wrong-origin/
  expired/replayed/revoked/unknown/suspended rejections, uid resolution,
  token minting, cross-user management denial, limit, timing-log hygiene —
  every canonical stage present, nothing sensitive in the line) +
  `functions/passkeys/passkeyRegions.test.js` (region registry + index.js
  parity: twins wrap the same handlers under the same App Check labels, the
  originals remain deployed, management has no twins).
- `npm run test:passkey-region-routing` — pure client routing
  (`passkeyRegionCore.js`): default/rollback to `us-central1`, pilot
  allow-listing, device-hint lifecycle + tamper rejection, fallback policy,
  and the client⇄server registry mirror.
- `npm run test:rules-text` — pins the four passkey collections server-only.
- `npm run test:unit` — `PasskeySignInButton.spec.jsx` (label, supporting
  copy, loading/disabled behaviour) + `passkeyService.spec.js` (which region
  instance/callable each flow actually uses, narrow fallback, live rollback
  via the settings snapshot, management pinned to `us-central1`).

## Deployment

Ships through the normal CI pipeline (PR → auto-merge → `deploy-firebase.yml`
deploys functions + rules). Post-deploy checklist: set the Firestore TTL
policy on `webauthnChallenges.expiresAt` (one-off), flip the feature flag for
phase 1, and watch `passkeyAuditLog` + `/admin/app-check` for the new labels.

## Duplicate account rows in the device's passkey chooser

Symptom: Android (or another OS) shows the same email twice in the system
passkey chooser while Settings → Security → Passkeys shows one credential.

Storage model facts (verified — the Settings list cannot silently drop
credentials): `passkeyCredentials/{credentialId}` is the ONLY authoritative
store; registration (`tx.create`), authentication (doc get by id), the
Settings list, and removal all use it. There is no index/mirror collection,
the list query has no `limit()`, it filters only `revokedAt`, and the client
keys rows by credential id (never deduplicates by name or email). Removal
hard-deletes the doc. But a website **cannot** delete the copy a device's
password manager keeps, so a credential removed from ZedExams (or orphaned by
deleting a test account) lives on in Google Password Manager and shows as an
extra identical row.

**Manual diagnosis** (each sign-in attempt writes a `credentialIdHash` to a
`passkeyAuditLog` row, and the function logs a `PASSKEY_CREDENTIAL_SELECTED`
event with the same hash — raw ids are never logged):

1. On the affected phone, tap "Sign in with a passkey", pick the FIRST row,
   complete it (success or failure both log).
2. Sign out; repeat with the SECOND row.
3. Compare the two hashes (Firestore console → `passkeyAuditLog`, newest
   rows, or the function logs) and count the account's docs in
   `passkeyCredentials`.

Interpretation (`classifyPasskeyDuplicateReport` in `passkeyCore.js` encodes
this triage):

| Observation | Diagnosis | Action |
|---|---|---|
| Two different hashes, both sign in | `SERVER_HAS_TWO_ACTIVE_CREDENTIALS` | Both genuine — Settings shows both; rename/remove the unwanted one |
| Two different hashes, one says "no longer linked" | `STALE_DEVICE_CREDENTIAL` | The failing row is a leftover in the password manager — remove it there (Google Password Manager → search zedexams.com) |
| Same hash from both rows | `ANDROID_PROVIDER_DUPLICATE_DISPLAY` / `MULTIPLE_CREDENTIAL_PROVIDERS` | Presentation issue in Android or between credential providers — no ZedExams data change can fix it; do NOT delete server records |
| Server has 2 active but Settings shows 1 | `SETTINGS_LIST_QUERY_BUG` | Our bug — file it (structurally ruled out today, guarded by tests) |

Never merge or delete credentials just because they share an email — one
account legitimately holds several passkeys, each identified by its unique
credential id.

**Prevention (implemented):** the WebAuthn user handle is minted once per
uid inside a transaction and never changes (not on email change either), so
re-registration on the same device OVERWRITES the password-manager entry
instead of adding a second one; `excludeCredentials` carries every active
credential so the same authenticator can't enrol twice (the OS's
`InvalidStateError` surfaces as the neutral "A passkey for this account
already exists on this device or password manager."); registration writes
are `tx.create` on the credential-id doc so a duplicate or a concurrent
double-submit loses. After a removal the UI says the passkey "may still
appear in your phone's password manager until you delete it there", and the
list has an opt-in "Why do I see my account twice?" help note.

## Troubleshooting

- "Passkey sign-in is not available yet" — feature flag off (or Firestore read
  failed; the gate fails closed).
- "For security, please sign out and sign in again" — first factor older than
  `PASSKEY_REAUTH_WINDOW_MIN`; re-login bumps `auth_time`.
- Options mint but the OS sheet never appears — origin not in
  `PASSKEY_ALLOWED_ORIGINS` or RP ID mismatch (check emulator env).
- "This passkey is no longer linked…" — credential removed/revoked server-side;
  the stale entry can also be deleted from the device's password manager.
- Sign-in verified but session not restored — check `verifyPasskeyAuthentication`
  logs; the custom token is minted only after verification + active-account
  check, and is never logged.
