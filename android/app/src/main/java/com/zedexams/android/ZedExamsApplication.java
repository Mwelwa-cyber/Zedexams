package com.zedexams.android;

import android.app.Application;
import android.util.Log;

import com.google.android.recaptcha.Recaptcha;
import com.google.android.recaptcha.RecaptchaTasksClient;

/**
 * Application subclass whose only job is to warm up the reCAPTCHA Enterprise
 * client once per app lifetime.
 *
 * Google recommends initialising the client early (here, in onCreate) because
 * {@code fetchTaskClient} takes a few seconds and does network + integrity work
 * in the background. We hold the resulting {@link RecaptchaTasksClient} so the
 * {@link RecaptchaPlugin} bridge can hand it to the WebView on demand
 * (login/signup live in the React layer, not native code).
 *
 * This is a Capacitor app that deliberately keeps native code minimal (see
 * android/AGENTS.md), but reCAPTCHA Enterprise has no official Capacitor plugin
 * — the SDK is Android-native and must be initialised/executed in Java/Kotlin,
 * so this small, self-contained bridge is the supported path.
 *
 * Fail-open: if init fails (no Play Services, offline, key not yet registered
 * for this package), the client stays null and RecaptchaPlugin returns no
 * token, which the JS + backend treat as "unassessed, proceed".
 */
public class ZedExamsApplication extends Application {
    private static final String TAG = "ZedRecaptcha";

    // Public reCAPTCHA Enterprise Android site key. Site keys are public by
    // design (they ship in the APK); the secret half is the server-side
    // assessment (functions/assessRecaptcha). Must match the key the backend
    // scores against — keep in sync with RECAPTCHA_ANDROID_SITE_KEY /
    // recaptchaAssessmentCore.js.
    private static final String RECAPTCHA_SITE_KEY =
            "6LewHUMtAAAAAPCk2gQ-v3Ew6tZKYk3w2a3xRvDP";

    // Written on the SDK's callback thread, read on the WebView/UI thread when
    // the plugin executes an action. volatile publishes the reference safely
    // across those threads.
    private volatile RecaptchaTasksClient recaptchaTasksClient = null;

    /** @return the initialised client, or null if init hasn't succeeded yet. */
    public RecaptchaTasksClient getRecaptchaTasksClient() {
        return recaptchaTasksClient;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Recaptcha
                .fetchTaskClient(this, RECAPTCHA_SITE_KEY)
                .addOnSuccessListener(client -> {
                    recaptchaTasksClient = client;
                    Log.i(TAG, "reCAPTCHA Enterprise client ready");
                })
                .addOnFailureListener(e ->
                        Log.w(TAG, "reCAPTCHA Enterprise init failed: " + e.getMessage()));
    }
}
