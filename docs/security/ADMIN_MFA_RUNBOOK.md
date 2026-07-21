# Administrator MFA — Security Runbook

> Snapshot as of 2026-07-21 — verify before acting.

Mandatory authenticator-app (TOTP) multi-factor authentication for every
ZedExams account with an `admin` or `superAdmin` role. SMS is **not** used.
Compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password
and any other RFC 6238 authenticator.

This runbook covers the one-time project setup, enrolment, recovery, the staged
rollout, rollback, and the residual risks.

---

## 1. Threat model (what this defends)

- **Stolen/leaked admin password or hijacked Google session** → attacker still
  can't reach admin pages or call privileged Cloud Functions without the
  authenticator code (the second factor).
- **Privilege escalation via a client-written field** → admin authority comes
  only from tamper-proof custom claims / the Firestore `role` (itself
  blocklisted from client self-writes) and, for privileged calls, the token's
  `firebase.sign_in_second_factor` claim which a client cannot forge. A client
  `mfaEnrolled` boolean is **never** trusted as a control.
- **A front-end-only guard being bypassed** (curl/SDK straight to a callable) →
  the `requireAdminMfa` Cloud Function guard enforces the same rule server-side.
- **Lost authenticator locking an admin out permanently** → a super admin can
  reset another admin's MFA (`resetAdminMfa`), which revokes sessions and forces
  re-enrolment, with a full audit trail.

Enrolment secrets, QR URIs, authenticator codes, passwords, and tokens are never
logged or persisted anywhere (component memory only until enrolment completes).

---

## 2. Prerequisite — enable Identity Platform (one-time, manual)

TOTP MFA is a Firebase Authentication **with Identity Platform** feature. This
cannot be scripted; do it once in the console:

1. Firebase console → **Authentication → Sign-in method**.
2. Open **Advanced → Multi-factor authentication** (or the "Upgrade to Identity
   Platform" banner) and upgrade the project.

Without this, the enable script below fails with a clear
`CONFIGURATION_NOT_FOUND` / `admin-restricted-operation` error.

---

## 3. Enable TOTP MFA on the project (one-time, trusted operator)

Run [`scripts/enable-totp-mfa.mjs`](../../scripts/enable-totp-mfa.mjs) with a
service-account that can manage the project's auth config. **Never commit the
service-account key**; pass it via the environment.

```bash
# point at your service account (kept OUT of the repo)
export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json

# dry-run first — prints the config it WOULD write, changes nothing
node scripts/enable-totp-mfa.mjs

# actually enable TOTP MFA (adjacentIntervals defaults to 5 ≈ ±2.5 min drift)
node scripts/enable-totp-mfa.mjs --live

# tune the clock-drift allowance (1–10 adjacent 30s windows) if needed
node scripts/enable-totp-mfa.mjs --live --intervals 5
```

The script reads back the config and confirms the TOTP provider is `ENABLED`.
It is **not** wired into any deploy workflow — enabling a project-wide auth
policy is a deliberate operator action.

---

## 4. Server-controlled enforcement flag (rollout safety)

The backend guard reads the `ADMIN_MFA_ENFORCEMENT` Cloud Functions env var:

| Value            | Behaviour                                                                                 |
|------------------|-------------------------------------------------------------------------------------------|
| `monitor`        | Admins **without** MFA are allowed through but the gap is recorded (`securityAuditLogs`). Non-admins are still blocked. Use during rollout. |
| unset / anything | **Enforce** (default, secure): admins without an MFA-verified session are rejected with `failed-precondition`. |

This is a global rollout stage, **not** a per-account or client-triggerable
bypass. Removing the var returns to enforce. There is no permanent bypass.

---

## 5. Enrolment (each admin)

1. Sign in normally. The route guard sends any admin without MFA to
   `/admin/security/mfa-setup` (no skip, no "remind me later").
2. Confirm identity (re-auth: Google popup, or current password).
3. Scan the QR code with an authenticator app, **or** type the setup key by hand.
4. Enter the 6-digit code and click **Activate MFA**.
5. Sign in again — the next sign-in shows the authenticator challenge, and the
   resulting session token now carries the second factor so privileged actions
   work.

The enrolment secret lives only in page memory and is wiped on success. Enrolment
start/complete/failed events are recorded in `securityAuditLogs` via the
`logAdminMfaEvent` callable (which verifies real enrolment before trusting a
"completed" event).

---

## 6. Recovery — a super admin resets a locked-out admin

Callable: **`resetAdminMfa`** (`functions/security/resetAdminMfa.js`).

Requirements & guarantees:

- Caller must be a **super admin** with an MFA-verified, **recently
  authenticated** session (30-min step-up window).
- Requires the target admin's **UID** (never a bare email) and a **reason**.
- Refuses **self-reset** (an admin can't remove their own last factor from a
  button) and, because only super admins can call it, a normal admin can never
  reset a super admin.
- Removes the target's enrolled factors (Admin SDK), **revokes their refresh
  tokens** (all sessions invalidated), mirrors `mfaEnrolled:false`, and writes
  `mfa.reset.*` + `admin.sessions.revoked` audit records.
- The target must enrol MFA again on their next sign-in.

> Resetting MFA signs the target out of all existing sessions.

If **all** super admins are locked out, use
[`scripts/grant-superadmin.mjs`](../../scripts/grant-superadmin.mjs) with the
service-account (out-of-band, Admin SDK) to restore a super admin, who can then
run recovery from the UI.

---

## 7. Protected Cloud Functions inventory

MFA (second-factor) is now required by these privileged callables:

| Function | File | Sensitive action |
|---|---|---|
| `adminSetUserStatus` | `adminUsers.js` | suspend / delete users |
| `adminSetUserRole` | `adminUsers.js` | change roles (also syncs claims + revokes tokens) |
| `resetAdminMfa` | `security/resetAdminMfa.js` | reset another admin's MFA (super-admin only) |
| `adminConfirmPayment` / `adminRejectPayment` | `adminPayments.js` | payment confirmation |
| `adminGrantPremium` / `adminRevokePremium` | `adminPayments.js` | subscription grants/revokes |
| `getAiBudgetEnforcement` | `aiBudgetEnforcement.js` | AI financial report |
| `bulkGrantDemoTrials` | `index.js` | bulk account creation |
| `classifyQuestionGrades` | `index.js` | bulk content classification |
| `retryAgentJob` | `index.js` | content-agent pipeline |
| `activateSyllabusVersion` / `rollbackSyllabusVersion` | `teacherTools/` | publish/rollback global curriculum |

`logAdminMfaEvent` is admin-gated but intentionally does **not** require MFA
(enrolment precedes MFA). Teacher/learner functions and the staff-gated
`importPastPaperQuestions` are unchanged.

The real data boundary remains Firestore/Storage rules; these guards add the
MFA precondition on top of the existing admin checks.

---

## 8. Deployment sequence (staged, safe)

1. **Ship support code** with `ADMIN_MFA_ENFORCEMENT=monitor` set on the
   functions. Guards are deployed but admins without MFA are not blocked.
2. **Enable Identity Platform + TOTP** (sections 2–3) in staging, then prod.
3. **Test** the full enrol → sign-out → challenge → sign-in flow in staging.
4. **Enrol the primary super admin**, then **at least one backup super admin**.
5. **Confirm recovery** works (reset a test admin, verify sessions invalidated +
   re-enrolment forced).
6. **Notify** remaining admins to enrol.
7. **Flip to enforce**: set `ADMIN_MFA_ENFORCEMENT=enforce` (or remove the var)
   and redeploy the functions. Backend now rejects non-MFA admin calls.
8. The route guard already forces enrolment client-side once code is live.
9. Optionally **revoke old admin sessions** (`adminSetUserRole` no-op re-set, or
   Admin SDK `revokeRefreshTokens`) so everyone re-authenticates with MFA.

CI/CD notes: functions ship via `deploy-firebase.yml`; hosting via
`deploy-hosting.yml`. Deploy functions **before** flipping enforcement.

---

## 9. Rollback

- **Disable enforcement instantly**: set `ADMIN_MFA_ENFORCEMENT=monitor` and
  redeploy the functions (or set it in the console and restart). Admins are no
  longer blocked on missing MFA; the route guard still routes un-enrolled admins
  to setup but backend calls succeed.
- **Full revert**: redeploy the previous release. The new Firestore rules
  (`securityAuditLogs`, `isSuperAdmin()`, MFA-mirror blocklist) are additive and
  safe to leave in place; if you must, revert `firestore.rules` via
  `deploy-firebase.yml`.
- Enrolled factors on user accounts are harmless if the feature is rolled back —
  they simply go unused until re-enabled. Do **not** bulk-remove factors on
  rollback.

---

## 10. Remaining risks / follow-ups

- **Client fallback (payments):** `adminPaymentsService.js` falls back to a
  direct Firestore write only when the callable is **not deployed**
  (`functions/not-found`) — it does **not** fall back on the MFA rejection, so
  enforcement isn't bypassed. Ensure functions are deployed before flipping
  enforcement so the fallback window never overlaps enforcement.
- **Firestore-rules-level MFA:** admin writes gated purely by `isAdmin()` in
  Firestore rules do not yet check the second-factor claim. The privileged
  *callables* enforce MFA; a future hardening could add
  `request.auth.token.firebase.sign_in_second_factor` to the most sensitive
  rule branches.
- **Claim drift (AUTH-M4):** `adminSetUserRole` now syncs claims + revokes
  tokens, and the guard has a Firestore-role fallback, so legacy admins aren't
  locked out. Run `grant-superadmin.mjs` once per pre-existing super admin to
  mint the boolean claims if you want to drop the fallback later.
- **Native (Capacitor) admins:** admin surfaces are web-oriented; Google
  *re-auth* uses the web popup and is not supported in the Android WebView.
  Admins should enrol/manage MFA from the web app.
