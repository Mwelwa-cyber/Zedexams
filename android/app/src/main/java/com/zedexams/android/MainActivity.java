package com.zedexams.android;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        // Enable native edge-to-edge so the WebView draws under fully
        // transparent system bars. @capacitor-community/safe-area then bridges
        // the real bar insets into CSS env(safe-area-inset-*) so content stays
        // clear of the status/navigation bars (Android WebView doesn't report
        // them otherwise).
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
