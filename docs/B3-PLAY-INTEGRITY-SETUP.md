# B3 follow-up — Play Integrity for the Capacitor Android wrapper

The web App Check shipped via PR #317 protects browser traffic with reCAPTCHA v3.
The Capacitor Android wrapper currently bypasses that — every Firestore /
Storage / Cloud Function callable from the WebView lands at the server
without an attestation token. This doc walks through activating
Google Play Integrity for the Android wrapper so native traffic gets
the same protection.

The JS-side wiring is already in `src/firebase/config.js` and ships
dormant (the dynamic import soft-fails when the npm package is
missing). Activation = installing the plugin + completing the
Firebase Console / Play Console steps below. No code changes
required after that point.

---

## Step 1 — Install the Capacitor plugin

```bash
npm install @capacitor-firebase/app-check
npx cap sync android
```

`@capacitor-firebase/app-check` brings in the `firebase-appcheck` and
`firebase-appcheck-playintegrity` Android SDKs as transitive deps; no
manual `android/app/build.gradle` edits are needed.

## Step 2 — Get the Android app's SHA-256 fingerprint

For a debug build:

```bash
cd android
./gradlew signingReport
```

Look for the `Variant: release` (or `debug` for testing) entry and
copy the **SHA-256** line.

For release builds signed with the upload key, run the same command
on the build server with the keystore configured.

## Step 3 — Register the Android app in Firebase

1. **https://console.firebase.google.com** → ZedExams project →
   **Project Settings** (gear icon) → **General** tab.
2. Scroll to **Your apps**. If the Android app isn't listed yet:
   - **Add app** → Android.
   - **Android package name**: `com.zedexams.android` (matches
     `android/app/build.gradle`'s `applicationId`).
   - **Debug signing certificate SHA-1** + **SHA-256**: paste from
     Step 2.
   - Download the freshly-generated `google-services.json` and
     replace `android/app/google-services.json` with it.
3. If the Android app already exists, just add the new SHA-256 via
   **Project Settings** → **General** → the Android app card →
   **Add fingerprint**.

## Step 4 — Enable the Play Integrity provider

1. Firebase Console → **App Check** (left rail) → **Apps** tab.
2. Click the Android app row → **Register**.
3. Provider: **Play Integrity** → **Save**.

## Step 5 — Paste the Play Integrity API key

Play Integrity API needs its own key issued by Google Play Console.

1. **https://play.google.com/console** → ZedExams app → **Setup** →
   **App integrity** (left rail) → **Integrity API**.
2. **Link Cloud Project** → pick the same GCP project that backs
   Firebase (`examsprepzambia`).
3. The API key is auto-generated. Copy the **Project number** under
   the integrity-API config.
4. Back in Firebase Console → **App Check** → Android app row →
   paste the project number into the **Play Integrity** config →
   **Save**.

(Some Firebase regions surface this as a single click during Step 4;
if you don't see a "paste API key" field, Step 5 already happened
implicitly via the Cloud Project link in Play Console.)

## Step 6 — Build and test

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

Install the resulting APK on a real device (Play Integrity won't
attest emulators reliably) and:

1. Sign in.
2. Take any quiz that hits a Cloud Function (the AI explain-answer
   button is the easiest trigger).
3. Watch Firebase Console → **App Check** → **Apps** → Android app →
   the **Verifications** tab. You should see the call rate climbing
   in the **Verified** column.

## Step 7 — Flip enforcement to hard mode

Once the App Check dashboard shows a sustained **~100% verified**
rate over ~7 days for both web AND Android:

1. Add `APPCHECK_ENFORCE=1` to `functions/.env.production` (or set via
   Firebase Console → Functions → Configuration).
2. Redeploy functions: push to main → CI runs `Deploy Firebase`.

AI callables (`aiChat`, `explainAnswer`, `generateQuizQuestions`,
`structureImportedQuiz`, `checkShortAnswer`) and the `apiAiChat` HTTP
endpoint will then 401 any request without a valid attestation token.
Unset the env var + redeploy to flip back.

## Troubleshooting

- **All Android calls show as "Outdated client"** — your
  `google-services.json` is stale. Re-download from Step 3 after
  registering the SHA-256.
- **Calls show as "Invalid"** — the Play Console / Firebase Console
  link is broken. Re-run Step 5; the project number must match the
  Firebase project's Cloud Project.
- **Calls show as "Missing"** — the app didn't initialize App Check.
  Confirm the npm package is installed (`npm ls @capacitor-firebase/app-check`)
  and that `npx cap sync android` was run after install.
- **DEBUG token in dev** — set `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`
  before App Check init, then register the logged token in
  Firebase Console → App Check → Apps → Manage debug tokens.
