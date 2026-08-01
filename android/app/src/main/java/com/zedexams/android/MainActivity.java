package com.zedexams.android;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Keep the AndroidX splash on screen until the WebView paints the app's
    // first frame. Without this, installSplashScreen() dismisses the splash as
    // soon as the activity window is ready — which is the blank navy
    // windowBackground (@color/zed_splash_bg) — and the user then stares at an
    // empty navy screen for the several seconds the WebView takes to cold-start
    // and paint index.html (the "splash shows for some seconds, then opens"
    // report). Holding the branded splash (ZedExams launcher icon on navy) over
    // that gap makes the wait feel intentional and hands off straight to the
    // in-page animated splash (#zx-splash in index.html, un-hidden by
    // /zx-splash.js before the WebView's first paint).
    private volatile boolean keepSplashOnScreen = true;

    // Safety backstop: never trap the user behind the splash if onPageLoaded()
    // never fires (e.g. a WebView load failure). Matches the boot-skeleton's own
    // slow-network expectations without being long enough to feel stuck.
    private static final long SPLASH_TIMEOUT_MS = 5000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register app-local Capacitor plugins BEFORE super.onCreate() so the
        // Bridge picks them up when it initialises. Exposes the reCAPTCHA
        // Enterprise token minter to the WebView (see RecaptchaPlugin).
        registerPlugin(RecaptchaPlugin.class);

        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> keepSplashOnScreen);

        // Enable native edge-to-edge so the WebView draws under fully
        // transparent system bars. @capacitor-community/safe-area then bridges
        // the real bar insets into CSS env(safe-area-inset-*) so content stays
        // clear of the status/navigation bars (Android WebView doesn't report
        // them otherwise).
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);

        // Dismiss the splash as soon as the WebView reports the page has
        // finished loading (index.html parsed + boot skeleton painted). This
        // fires on WebViewClient.onPageFinished — after the client-side SPA has
        // its first real frame, not on later in-app route changes.
        //
        // Null-guard: getBridge() returns null when Bridge.init() failed silently
        // (e.g. a plugin's load() threw a Throwable that Capacitor swallowed).
        // In that case the splash falls back to the 5 s SPLASH_TIMEOUT_MS backstop
        // already registered below — still a visible app, just without the
        // WebView-paint trigger. Without this guard the NPE would itself crash the
        // app on launch, masking the underlying plugin-init failure.
        com.getcapacitor.Bridge bridgeRef = getBridge();
        if (bridgeRef != null) {
            bridgeRef.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    dismissSplash();
                }

                @Override
                public void onReceivedError(WebView webView) {
                    // A load error would otherwise hold the splash until the
                    // timeout; drop it now so the WebView's own error state shows.
                    dismissSplash();
                }
            });
        } else {
            android.util.Log.e("ZedExams",
                "Bridge is null after super.onCreate() — a plugin may have failed to load. " +
                "Splash will dismiss after SPLASH_TIMEOUT_MS. Check logcat for NoClassDefFoundError.");
        }

        new Handler(Looper.getMainLooper()).postDelayed(this::dismissSplash, SPLASH_TIMEOUT_MS);
    }

    private void dismissSplash() {
        if (!keepSplashOnScreen) {
            return;
        }
        keepSplashOnScreen = false;
        // The splash's keep-on-screen condition is re-checked on the content
        // view's next pre-draw pass; nudge one so the splash lifts promptly even
        // if the WebView happens to be idle at this instant.
        View content = findViewById(android.R.id.content);
        if (content != null) {
            content.invalidate();
        }
    }
}
