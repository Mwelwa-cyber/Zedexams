# Runbook — Secrets inventory, escrow & recovery (DR-006)

> Snapshot as of 2026-07-22 — verify against the live consoles before acting.
> This runbook closes DR-006: the platform's secrets had no documented
> inventory, source-of-truth, escrow, or recovery procedure. It does NOT paste
> any secret value — it records where each one lives, who mints it, its blast
> radius, and how to recover/rotate it.

## Where secrets live (three stores)

1. **Firebase Functions secrets** — bound in code via `defineSecret(...)` and
   stored in **GCP Secret Manager** (project `examsprepzambia`). These are
   **versioned by Secret Manager**, so the *current values are not lost* unless
   the GCP project itself is lost — the real gap is escrow of the *provider-side*
   credential (to re-mint after compromise or project loss) and a documented
   inventory. List them: `gcloud secrets list --project=examsprepzambia`;
   read one: `firebase functions:secrets:access <NAME>`.
2. **GitHub Actions secrets** — the CI build/deploy inputs (repo → Settings →
   Secrets and variables → Actions). Used by `deploy-hosting.yml` /
   `deploy-firebase.yml` / the Android release workflow.
3. **The Android signing keystore** — a GitHub Actions secret
   (`ZED_RELEASE_KEYSTORE_BASE64` + passwords) AND the one secret that is
   **irreplaceable** (see the ⚠️ callout at the bottom).

## Escrow (do this once, then on every rotation)

Keep a single canonical copy of every secret below in the team **password
manager** (a shared "ZedExams / Production Secrets" vault), each entry noting:
the value, the console it was minted in, the mint/rotation date, and who has
access. Secret Manager holds the *runtime* copy; the vault is the *recovery*
copy for when a key is compromised or must be re-minted at the source. Restrict
vault access to the project owner + one backup holder.

## Firebase Functions secrets — inventory & recovery

| Secret | Purpose | Source of truth (re-mint here) | Blast radius if lost |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | AI generators + content agents | Anthropic Console → API keys | Generators/agents 500; no data loss |
| `OPENAI_API_KEY` | Zed chat, short-answer marking, image gen | OpenAI Platform → API keys | Chat/marking/images 500 |
| `GEMINI_API_KEY` | Gemini client + image path | Google AI Studio → API keys | Gemini helpers 500 |
| `LENCO_API_KEY` | **Payments** (MTN/Airtel/Zamtel/cards) | Lenco dashboard → API | **HIGH — payment processing + webhooks down** |
| `EMAIL_SMTP_USER` / `EMAIL_SMTP_PASSWORD` | Ops alerts, digests, invoices | privateemail.com mailbox | Alerts/digests fail (now dual-channel — see OBS-004) |
| `GOOGLE_PLAY_SA_JSON` | Android in-app purchase verification | GCP IAM service account (Play-linked) → new JSON key | Play subscription verification 500 |
| `META_WHATSAPP_TOKEN` / `META_WHATSAPP_PHONE_NUMBER_ID` | WhatsApp channel (Bonga) | Meta for Developers → WhatsApp | WhatsApp send/reply down |
| `GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_BOT_TOKEN` | Agent GitHub ops (Vigil files bug issues) | GitHub → the ZedExams GitHub App / bot | Agent GitHub automation down |

**Rotate / recover a Functions secret** (no downtime — new version, then deploy):
```bash
# 1. Mint a fresh credential in the provider console above.
# 2. Store the new value as a new Secret Manager version:
firebase functions:secrets:set ANTHROPIC_API_KEY   # paste when prompted
# 3. Redeploy the functions that bind it (CI: deploy-firebase.yml), so they
#    pick up the new version. Old versions stay until you disable/destroy them.
# 4. Revoke the OLD credential in the provider console once traffic is healthy.
# 5. Update the password-manager escrow entry (value + date).
```

## GitHub Actions secrets — inventory & recovery

Build/deploy config (repo → Settings → Secrets and variables → Actions). Most
are **re-derivable** from the same source consoles; the `VITE_FIREBASE_*` values
are the Firebase Web app config (Firebase console → Project settings → your web
app) and are **not sensitive** (they ship in the client bundle) but must match
prod. The deploy/service-account JSONs and Sentry token ARE sensitive.

- **Firebase deploy:** `FIREBASE_DEPLOY_SERVICE_ACCOUNT_JSON`, `FIREBASE_TOKEN`,
  `FIREBASE_ANDROID_APP_ID`, `GOOGLE_SERVICES_JSON`, `FIREBASE_APPDIST_SERVICE_ACCOUNT_JSON`
  — recover by minting a new service-account JSON key in GCP IAM (roles for
  hosting/functions/rules deploy) and re-downloading `google-services.json` from
  the Firebase console.
- **AI (CI-side):** `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENTS_KEY` — Anthropic console.
- **Play:** `PLAY_SERVICE_ACCOUNT_JSON` — Google Play Console → API access.
- **Sentry:** `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` — Sentry → Auth Tokens.
- **Client config:** `VITE_FIREBASE_*`, `VITE_POSTHOG_*`, `VITE_SENTRY_DSN`,
  `VITE_GOOGLE_MAPS_STATIC_KEY`, `VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY`,
  `VITE_APP_VERSION` — from Firebase / PostHog / Sentry / Google Cloud / reCAPTCHA
  Enterprise consoles. The App Check reCAPTCHA key is minted in the reCAPTCHA
  Enterprise console and must match the key registered under Firebase App Check.

## ⚠️ The Android signing keystore — the one irreplaceable secret

`ZED_RELEASE_KEYSTORE_BASE64` (+ `ZED_RELEASE_STORE_PASSWORD`,
`ZED_RELEASE_KEY_ALIAS`, `ZED_RELEASE_KEY_PASSWORD`) is the **upload/signing key**
for the Play app. Unlike every secret above, a keystore **cannot be re-minted**:
if it is lost and **Play App Signing is NOT enabled**, you can never publish an
update to the existing app under the same signing identity — users would have to
uninstall/reinstall a new listing.

**Actions:**
1. Confirm **Play App Signing is ENABLED** (Play Console → app → Setup → App
   integrity). With it on, Google holds the app-signing key and you can reset a
   lost **upload** key via Play support — this is the single most important
   DR safeguard for the Android app.
2. Escrow the keystore file + all three passwords in the password manager AND a
   second offline copy (encrypted). Do NOT rely on the GitHub secret as the only
   copy — a GitHub secret is write-only (you cannot read it back).
3. Record the SHA-256 fingerprint (`keytool -list -v -keystore ...`) in the vault
   so a recovered keystore can be verified as the correct one.

## Recovery drill (recommended, once)

Prove the escrow works without touching prod: from the password-manager copies
alone, (a) re-set one non-critical Functions secret to its escrowed value in a
scratch/staging context, and (b) verify the keystore fingerprint matches the
recorded one. Record the date the drill was last run.

## Cross-references
- Firestore/Storage DR: [`../14-backup-and-disaster-recovery.md`](../14-backup-and-disaster-recovery.md) (DR-001/003/007).
- Dual-channel alerting (so a lost SMTP secret doesn't silence alerts): [`../11-observability-and-audit.md`](../11-observability-and-audit.md) OBS-004.
