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

## Cloud Functions (all `us-central1` callables)

| Function | Auth | Purpose |
|---|---|---|
| `generatePasskeyRegistrationOptions` | signed-in + recent auth | mint registration options + challenge |
| `verifyPasskeyRegistration` | signed-in | verify attestation, persist credential |
| `generatePasskeyAuthenticationOptions` | none (rate-limited per IP) | mint auth options + challenge |
| `verifyPasskeyAuthentication` | none (rate-limited per IP) | verify assertion → custom token |
| `listUserPasskeys` | signed-in | safe metadata for own passkeys |
| `renameUserPasskey` | signed-in owner | rename |
| `removeUserPasskey` | signed-in owner + recent auth | delete credential (immediate) |

All follow the repo conventions: `assertVerifiedAuth` (authGuard),
`assertCallableRateLimit` (rateLimit.js — per-IP buckets cover the pre-auth
endpoints), `enforceAppCheck: shouldEnforceAppCheck(label)` under the graduated
`APPCHECK_ENFORCE` rollout, `HttpsError` with a machine-readable
`details.code` (`PASSKEY_*`).

## Relying-party configuration (environment-managed)

| Env var (functions runtime) | Default | Notes |
|---|---|---|
| `PASSKEY_RP_ID` | `zedexams.com` | NEVER the Firebase project domain in production |
| `PASSKEY_ALLOWED_ORIGINS` | `https://zedexams.com` | comma-separated; wildcards are refused (fail-closed); the production origin is always appended |
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
public key or counter). Nothing passkey-related touches localStorage.

## Rollout / feature flag

`settings/global.featureFlags.passkeyAuthenticationEnabled` (default **off**,
fail-closed on read errors) gates the login button, the settings section, and
all four registration/authentication functions server-side. Staged rollout:

1. **Internal admin testing** — flag on + `featureFlags.passkeyRolloutRoles:
   ['admin']` (or `passkeyRolloutUids: [...]` for specific accounts).
2. **Staff beta** — add `'teacher'` to `passkeyRolloutRoles`.
3. **Optional public enrolment** — clear both rollout lists (empty = everyone).
4. **Broader promotion** — only after recovery, revocation, analytics and
   cross-device testing are verified.

The rollout lists narrow who may **register**; sign-in only needs the master
flag (only enrolled users can authenticate anyway). Management
(list/rename/remove) is never gated, so users can clean up even mid-rollback.
The toggle is exposed in `/admin/settings` → Developer → Feature flags.

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
  token minting, cross-user management denial, limit).
- `npm run test:rules-text` — pins the four passkey collections server-only.
- `npm run test:unit` — `PasskeySignInButton.spec.jsx` (label, supporting
  copy, loading/disabled behaviour).

## Deployment

Ships through the normal CI pipeline (PR → auto-merge → `deploy-firebase.yml`
deploys functions + rules). Post-deploy checklist: set the Firestore TTL
policy on `webauthnChallenges.expiresAt` (one-off), flip the feature flag for
phase 1, and watch `passkeyAuditLog` + `/admin/app-check` for the new labels.

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
