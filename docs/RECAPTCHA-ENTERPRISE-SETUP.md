# reCAPTCHA Enterprise (Android action scoring) — setup

> **Snapshot as of 2026-07-03 — verify before acting.** The **code** is done
> and ships dormant/fail-open: the native SDK mints tokens, the backend
> `assessRecaptcha` function scores them, and login/signup gate on the result.
> Until the **Google Cloud steps below** are complete, every assessment
> resolves to `skip` (fail-open) so nothing is blocked and no user is affected.
> Once the API is enabled + the service account is granted + the app is
> registered on the key, real scores start flowing.

## What this is (and how it differs from App Check)

The app already has **Firebase App Check** (reCAPTCHA Enterprise on web, Play
Integrity on native — see `src/firebase/config.js` and
`docs/B3-PLAY-INTEGRITY-SETUP.md`). Note App Check's web key is a *separate*
reCAPTCHA Enterprise key from the Android action-scoring key documented here.
App Check attests *"this request comes from a genuine ZedExams client"* on
**every** backend call.

**reCAPTCHA Enterprise** here is a **separate, action-level** signal: the native
Android SDK mints a per-action token (`login`, `signup`, …) that the server
scores 0.0 (bot) … 1.0 (human). It answers *"does **this specific** login
attempt look like a bot?"*. The two stack — App Check gates the client,
reCAPTCHA Enterprise scores the action.

The **site key** is `6LewHUMtAAAAAPCk2gQ-v3Ew6tZKYk3w2a3xRvDP` (public — it ships
in the APK; the secret half is the server-side assessment, which a compromised
client can't forge).

## Moving parts (all in this repo)

| Layer | File | Role |
|-------|------|------|
| Android dep | `android/variables.gradle` (`recaptchaVersion`), `android/app/build.gradle` | pulls `com.google.android.recaptcha:recaptcha` |
| Native init | `android/.../ZedExamsApplication.java` | `Recaptcha.fetchTaskClient(...)` once in `onCreate` |
| Native bridge | `android/.../RecaptchaPlugin.java` + `MainActivity.java` (`registerPlugin`) | exposes `execute({action})` → token to the WebView |
| Permission | `AndroidManifest.xml` | `android.permission.INTERNET` (already present) |
| JS helper | `src/utils/recaptcha.js` | `assessAction(action)` → mint token + call backend; `shouldBlock(result)` |
| Wiring | `src/features/auth/pages/Login.jsx`, `Register.jsx` | fail-open gate before the credential call |
| Backend | `functions/recaptchaEnterprise.js` (I/O), `functions/recaptchaAssessmentCore.js` (pure logic), `assessRecaptcha` in `functions/index.js` | trades token for a score via the Assessment API |
| Tests | `functions/recaptchaAssessment.test.js` (`npm run test:recaptcha`) | request-building + verdict logic |

## Fail-open contract

The ONLY outcome that stops an action is backend `verdict === 'block'`, which
happens only for a **valid** token with a genuinely **low** score (< 0.3 by
default). Everything else — no token (web / SDK not ready), invalid token,
action mismatch, missing score, network/permission error — resolves to `skip`
and the action proceeds. A misconfiguration therefore cannot lock users out.

## Google Cloud steps (do these to turn scoring on)

reCAPTCHA Enterprise lives in the same GCP project as Firebase
(`examsprepzambia`).

### 1 — Enable the API

```bash
gcloud services enable recaptchaenterprise.googleapis.com --project=examsprepzambia
```

### 2 — Register the Android app on the site key

In the Google Cloud Console → Security → reCAPTCHA → the key
`6LewHUMtAAAAAPCk2gQ-v3Ew6tZKYk3w2a3xRvDP` → make sure it is an **Android** key
and that its package list includes the app id **`com.zedexams.android`** (this
is `applicationId` in `android/app/build.gradle`, *not* the `com.zedexams.app`
in `strings.xml`). A token minted by a package that isn't on the key comes back
`valid: false` → `skip`.

### 3 — Grant the Cloud Functions service account access

The backend authenticates with Application Default Credentials (the Functions
runtime service account) — no API key, no secret. Grant that SA the reCAPTCHA
Enterprise Agent role:

```bash
# The default runtime SA for Firebase/GCF gen-2 is the Compute SA:
#   <project-number>-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding examsprepzambia \
  --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role="roles/recaptchaenterprise.agent"
```

If Functions run under a dedicated SA, grant that one instead. Without this
role, `createAssessment` throws `PERMISSION_DENIED` → the function catches it
and returns `skip` (fail-open), so sign-in keeps working — you just get no
scoring until the role is granted.

### 4 — (optional) override key / project without a code change

The backend reads these env vars if set, else falls back to the baked-in
defaults:

- `RECAPTCHA_ANDROID_SITE_KEY` — swap in a staging key
- `RECAPTCHA_PROJECT_ID` — defaults to `GCLOUD_PROJECT` / `examsprepzambia`

## Verify

1. `npm run test:recaptcha` — pure logic (offline).
2. Build + install the Android app, attempt a login, and check the function
   logs for `assessRecaptcha action=login verdict=… score=…`. A real device
   with the key registered should show `verdict=allow score≈0.9`.
3. Watch the `score`/`verdict` distribution in logs before tightening the
   thresholds in `recaptchaAssessmentCore.js` (`DEFAULT_THRESHOLDS`) or before
   promoting `challenge`/invalid-token cases from `skip` to a hard block.

## Tuning later

- **Thresholds:** `DEFAULT_THRESHOLDS` in `recaptchaAssessmentCore.js`.
- **Challenge UX:** there is no interactive challenge yet, so a `challenge`
  verdict currently proceeds like `allow`. Add a step-up (e.g. email
  verification) and have the client act on `verdict === 'challenge'`.
- **More actions:** call `assessAction('<action>')` before any other sensitive
  flow (e.g. checkout). Use the same action string on device and server.
