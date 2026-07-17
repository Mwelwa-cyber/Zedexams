# 18 — Security Review

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.
> No secret values appear in this document. Findings are classified Critical / High / Medium / Low / Informational.

## Posture summary

The **write side is strong**: all money/role/entitlement fields are backend-only, self-escalation is blocked in Firestore rules (create + update), payments funnel through one idempotent activation path with HMAC-verified webhooks and strong duplicate protection, and grading/AI writes are server-authoritative. The main weaknesses are **read-side content confidentiality**, **suspension enforcement**, and **staged (not-yet-enforced) App Check**.

## Enforcement map (where security lives)

| Layer | Mechanism | Files |
|---|---|---|
| Firestore reads/writes | `firestore.rules` (~152 KB, hand-written); role via `users.role`, verification via token claim + grace | `firestore.rules` |
| Storage reads/writes | `storage.rules` (owner-keyed paths, size/content-type validators, deny-all fallthrough) | `storage.rules` |
| CF authorization | `assertVerifiedAuth`, `assertCallerIsAdmin`, `isStaffRole` | `functions/authGuard.js`, `adminUsers.js` |
| App Check | reCAPTCHA Enterprise (web) / Play Integrity (Android); **observe-only by default** | `appCheckEnforcement.js`, `recaptchaEnterprise.js` |
| Webhooks | HMAC (`x-lenco-signature` SHA512, `x-hub-signature-256`) | `lencoService.js`, `metaWhatsAppCore.js` |
| Rate limiting | `rateLimitCore.js`; per-email/IP on password reset; honeypot on newsletter | `functions/rateLimit*.js`, `index.js` |
| Input/output sanitization | `dompurify` (rich text), `sanitizeXmlText` (exports), `cleanString`/`cleanContext` (AI), `aiPromptPolicy` | `src/utils/*`, `functions/aiPromptPolicy.js` |
| Secrets | Firebase Functions `defineSecret` (never in `.env`); CSP restricts egress | `functions/index.js`, `firebase.json` |
| CSP / headers | `firebase.json` headers block (X-Frame-Options, nosniff, strict CSP, Permissions-Policy) | `firebase.json` |

## Findings

### High

**SEC-H1 — Learner premium *content* gating is client-side only.** (= PAY-1)
- **Risk:** A free/expired verified user can read any `isPublished==true` quiz + its answer-bearing questions and published lessons directly from Firestore; the demo/paywall distinction lives only in React.
- **Evidence:** `firestore.rules` quizzes 489–534, lessons 593–596 (no premium check). Daily exams (511–532) are the correctly server-gated exception.
- **Exploit:** authenticated client reads collection directly, bypassing the paywall UI.
- **Not:** a billing bypass — cannot flip the premium flag or steal paid AI generations.
- **Fix:** gate premium content reads server-side (Cloud Function delivery like daily exams) or add a rules-level premium check; **regression test:** rules-emulator test that a free learner is denied premium quiz questions.

**SEC-H2 — Suspension not enforced at the rules layer.** (= AUTH-H1)
- **Risk:** `adminSetUserStatus` sets status + `revokeRefreshTokens`, but rules never check `status` and the current ID token stays valid ~1h; client sign-out is cosmetic. A suspended user keeps backend access up to an hour.
- **Evidence:** `adminUsers.js:52–69`, `firestore.rules:22–41`, `AuthContext.jsx:542–556`.
- **Fix:** gate sensitive rules on `status=='active'` and/or `verifyIdToken(..., checkRevoked=true)` on HTTP endpoints; **regression test:** rules-emulator denial for suspended user.

**SEC-H3 — Client-side Gemini bypasses all AI guardrails.** (= AI-1)
- **Risk:** `src/utils/aiLogic.js` + `src/firebase/ai.js` call Gemini directly from the browser — no reservation/budget gate, no treasury cap, not in cost rollups, no per-user cap. Gated only by App Check + Firebase quota (and App Check is observe-only, SEC-M2). Potential uncapped spend / abuse vector.
- **Fix:** route client Gemini through a Cloud Function with the budget gate, or disable it until App Check is enforced; **regression test:** attribution/accounting test.

### Medium

**SEC-M1 — Parent-role signup mismatch.** (= AUTH-M2) Frontend writes `role:'parent'` but the create rule allows only learner/teacher → parent `setDoc` is permission-denied. Verify parent signup path.

**SEC-M2 — App Check + reCAPTCHA fail-open / observe-only.** (= AUTH-M3) Anti-bot/anti-scraping on paid AI + auth endpoints is advisory today (documented staged rollout). Enforce before relying on it.

**SEC-M3 — Custom claim `role` never re-synced.** (= AUTH-M4) `adminSetUserRole` updates only the Firestore field; the claim is frozen at onCreate → divergence (toward less access) for `syllabusOverrides.js` and `bootstrapUserProfile`.

**SEC-M4 — `agentControl` world-readable to verified users.** (= FS-2) Exposes circuit-breaker/pause state and `autoPublish` flag to any signed-in user. Low direct harm; tighten to admin read.

**SEC-M5 — `assessmentToPdf` and unmigrated drafts leak/lose work rather than a security hole**, but note `assessmentToPdf` renders remote `<img>` with no CORS/proxy — see [`16`](./16-document-generation.md) DOC-1.

### Low / Informational

- **SEC-L1** — `contactMessages` anonymous create with shape-only validation (relies on App Check for spam) — FS-2.
- **SEC-L2** — `whatsappConversations` uses PII phone number as doc id — FS-2. (Server-only collection.)
- **SEC-L3** — `note-pictures/`, `slide-notes-images/` have no storage.rules match (served via token URLs) and no cleanup — STO-1; `picture-bank/staged/` readable by any verified user — STO-4.
- **SEC-L4** — Dead card-collection code proxies raw PAN (PCI) though the path is disabled — PAY-2.
- **SEC-L5** — 6-char password minimum, client-only — AUTH-L8.
- **SEC-L6** — OpenAI/Gemini calls have no HTTP retry (availability, not security) — AI-4.
- **SEC-Info** — `lesson-presentations` deliberately excludes SVG (XSS); exports funnel through `sanitizeXmlText`; rich text through `dompurify`; CSP is strict and enumerates all egress hosts; secrets are Functions-managed and never committed (guarded by `test:secret-hygiene`).

## XSS / injection / rendering

- Rich-text rendering sanitised with `dompurify`; the sanitiser is unit-tested (`test:sanitize`).
- AI prompt injection: `aiPromptPolicy` forces learners onto the education-guardrail system prompt (they cannot override it); inputs are NUL-stripped/clamped. Structured output is tool-forced JSON with per-tool schemas.
- Uploaded content: Storage validators pin content-types; SVG excluded from presentations.

## Prioritised remediation order

1. **SEC-H1** (learner content gating) and **SEC-H2** (suspension) — both are read/authorization boundaries with real exposure.
2. **SEC-H3** (client Gemini) + **SEC-M2** (enforce App Check) together.
3. **SEC-M1** (parent signup — may be a live bug), **SEC-M3** (claim re-sync), **SEC-M4** (agentControl read).
4. Storage cleanup gaps (STO-1/2) and Low items.

See [`23-risk-register.md`](./23-risk-register.md) for probability/impact scoring and [`10`](./10-authentication-and-roles.md)/[`14`](./14-payment-and-subscriptions.md) for the source detail.
