package com.zedexams.android;

import android.app.Application;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.recaptcha.RecaptchaAction;
import com.google.android.recaptcha.RecaptchaTasksClient;

/**
 * Capacitor bridge that lets the WebView (where login/signup live) mint a
 * reCAPTCHA Enterprise token for a named action.
 *
 * JS side: {@code Capacitor.Plugins.Recaptcha.execute({ action: 'login' })}
 * (wrapped by src/utils/recaptcha.js). The token is then sent to the backend
 * {@code assessRecaptcha} function for scoring — the token alone reveals
 * nothing; only the server-side assessment does.
 *
 * FAIL-OPEN: this never rejects the call for an operational reason. If the SDK
 * isn't ready or execution fails, it resolves with NO token field, which
 * src/utils/recaptcha.js reads as null → "unassessed, proceed". Rejecting would
 * surface as a JS error and risk blocking sign-in on a transient SDK hiccup.
 */
@CapacitorPlugin(name = "Recaptcha")
public class RecaptchaPlugin extends Plugin {
    // Google suggests a 10s timeout for execute (min 5s).
    private static final long EXECUTE_TIMEOUT_MS = 10000L;

    @PluginMethod
    public void execute(PluginCall call) {
        String action = call.getString("action", "");
        if (action == null || action.isEmpty()) {
            call.reject("Missing 'action'");
            return;
        }

        RecaptchaTasksClient client = getRecaptchaClient();
        if (client == null) {
            // Init still in flight or failed — fail open with an empty result.
            call.resolve(new JSObject());
            return;
        }

        client
                .executeTask(RecaptchaAction.custom(action), EXECUTE_TIMEOUT_MS)
                .addOnSuccessListener(token -> {
                    JSObject ret = new JSObject();
                    ret.put("token", token);
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> {
                    // Fail open — resolve without a token rather than reject.
                    JSObject ret = new JSObject();
                    ret.put("error", e.getMessage());
                    call.resolve(ret);
                });
    }

    /** Fetch the app-scoped client warmed up in {@link ZedExamsApplication}. */
    private RecaptchaTasksClient getRecaptchaClient() {
        if (getActivity() == null) return null;
        Application app = getActivity().getApplication();
        if (app instanceof ZedExamsApplication) {
            return ((ZedExamsApplication) app).getRecaptchaTasksClient();
        }
        return null;
    }
}
