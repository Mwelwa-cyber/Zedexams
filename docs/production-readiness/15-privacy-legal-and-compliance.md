# 15 — Privacy, Legal & Compliance

> Snapshot as of 2026-07-19. Layer 17. Finding IDs: `LEGAL-*`.
> **This file separates technical implementation gaps from items that require qualified legal
> counsel.** Nothing here is legal advice.

## Verdict

The **technical** privacy surface is well-built: an in-app Privacy Policy + Terms, a broad
server-side account-deletion purge, a data-export path, cookie/analytics consent, and explicit
AI + third-party-processor disclosure. The **legal** exposure is real and needs counsel: the
platform serves children (Grade 4–7, ages ~9–12) but has **no verifiable parental-consent
mechanism**, and it ingests/serves ECZ past papers with **no visible licensing basis**. The
account-deletion re-auth/rate-limit gap (LEGAL-003) is now closed; the remaining technical gap
(purge is best-effort with hand-maintained lists, LEGAL-004) still raises the stakes given the weak
backup posture.

## Present (technical) — evidence

- Privacy Policy (`src/components/marketing/PrivacyPolicy.jsx`) + Terms (`Terms.jsx`) as in-app routes.
- **Children's section** names Grade 4–7 / ages 9–12 and references the Zambia Data Protection Act
  (`PrivacyPolicy.jsx:28,103-114`). AI + third-party processor disclosure (Firebase, Anthropic/Gemini,
  MTN MoMo) at `:116-136`. Retention section `:142-148`.
- **Account deletion**: `deleteMyAccount` → `purgeUserData` purges ~40 collections + the Auth user
  (`functions/accountDeletion.js`), wired to Settings → Account → Delete.
- **Data export**: `downloadMyData` client export (`AccountPanel.jsx:25`).
- **Consent**: `CookieConsentBanner.jsx`, `AnalyticsConsentToggle.jsx`, `analyticsConsent.js`.

## Findings — technical (fixable in code)

### LEGAL-003 — `deleteMyAccount` has no re-authentication and no rate limit — RESOLVED (2026-07-21)
- **Severity:** Medium–High · **Confidence:** High confidence
- **Affected:** `functions/index.js` (`deleteMyAccount`) — previously checked only `request.auth.uid`.
- **Was:** A stolen/persisted session could **irreversibly** purge an account with one call. No
  recent-login re-auth, no confirmation token, no rate limit.
- **Fix:** The callable now (1) enforces a short per-user burst rate limit
  (`assertCallableRateLimit`, `deleteMyAccount` action) and (2) requires a recent re-authentication —
  a fresh `auth_time` on the ID token (`accountDeletion.evaluateDeletionAuth`, default 5-min window,
  fails closed on a missing claim). The client (`src/utils/accountService.js`) re-authenticates
  immediately before calling — password accounts re-enter their password, Google accounts via a
  provider popup — and force-refreshes the token. Guarded by `test:account-deletion`,
  `test:account-reauth`, and `AccountPanel.spec.jsx`. A stale/hijacked session is now rejected with
  `requires-recent-login`.
- **Still open (optional hardening):** a soft-delete grace window before the hard purge is not
  implemented; deletion irreversibility still depends on the weak backup posture (DR-001).

### LEGAL-004 — `purgeUserData` is best-effort with hand-maintained collection lists
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `functions/accountDeletion.js:132-149` — a failing collection is recorded in
  `summary.errors` but the Auth user is deleted anyway; the collection list is hand-maintained and
  must track `firestore.rules` (comment `:30-31`).
- **Risk:** Residual PII orphaned when a collection fails or a new collection isn't added to the list
  — a data-subject-deletion completeness gap.
- **Correction:** Make purge transactional-per-collection with retry; add a test that the purge list
  covers every user-scoped collection in the rules (drift guard). **Launch blocker:** No. **Complexity:** Medium.

### LEGAL-005 — No breach / incident-response plan in repo
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** no `*incident*`/`*breach*` doc.
- **Correction:** Add an incident-response + breach-notification runbook (roles, timelines, DPA
  notification duties). Partly operational, partly legal. **Launch blocker:** No, but expected for
  child-data at scale.

## Findings — require legal review (not code)

### LEGAL-001 — No verifiable parental-consent mechanism for child users
- **Severity:** High (legal) · **Confidence:** High confidence
- **Affected:** `PrivacyPolicy.jsx:107-108` — "We rely on schools and parents to confirm." Consent is
  **disclosure-only**; there is no verifiable parental-consent flow at signup for under-13 learners.
- **Risk:** COPPA-style / Zambia Data Protection Act exposure for processing children's data without
  verifiable consent. **This is a legal determination, not a code fix.**
- **Correction:** Counsel to advise on the required consent model (school-as-consent-agent vs direct
  parental consent); then implement the chosen flow. **Launch blocker:** Confirm with counsel before
  scaling direct-to-learner signups.

### LEGAL-002 — ECZ past-paper copyright / licensing basis not evident
- **Severity:** High (legal) · **Confidence:** High confidence
- **Affected:** past papers are ingested + served (`PastPaperViewer.jsx`, `pastPapers.js`) with no
  licensing/permission statement beyond marketing copy. ECZ exam papers are ECZ/Crown copyright.
- **Risk:** Redistribution without rights → takedown / legal exposure; a core content pillar.
- **Correction:** Counsel to confirm redistribution rights / secure a licence; document it.
  **Launch blocker:** Confirm rights before continuing to serve at scale.

### LEGAL-006 — Retention windows vague; AI-log retention undefined
- **Severity:** Low–Medium (legal + technical) · **Confidence:** Moderate confidence
- **Affected:** retention described as a "reasonable period"; AI prompt/generation log retention not
  specified. **Correction:** Define concrete retention windows (incl. AI logs) and implement TTL
  cleanup. **Launch blocker:** No.

## Cross-references
- Deletion irreversibility depends on backups: [`14-backup-and-disaster-recovery.md`](./14-backup-and-disaster-recovery.md).
- Consent/analytics wiring: `analyticsConsent.js`, PostHog CSP allowances in `firebase.json`.
