# App-level R8/ProGuard rules for the release build (minifyEnabled in
# app/build.gradle). Library keep rules arrive automatically: AGP merges
# the consumer rules shipped inside each dependency's AAR —
# @capacitor/android's cover the reflective plugin surface
# (@CapacitorPlugin-annotated classes, Plugin subclasses, Cordova plugin
# classes), and the AndroidX/Firebase artifacts ship their own. Only
# rules specific to this app belong here.

# Keep file/line info so Play Console / crash-report stack traces from
# the minified build stay mappable via the R8 mapping file, while hiding
# the original source paths behind a constant tag.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# The WebView JS bridge: an @JavascriptInterface method that gets
# stripped or renamed silently severs the Capacitor bridge. The AGP
# default file (proguard-android-optimize.txt) already keeps these;
# restated here so the guarantee doesn't ride on a default that could
# change between AGP versions.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# The Facebook provider stays disabled (capacitor.config.json only lists
# google.com), so @capacitor-firebase/authentication keeps facebook-login
# compileOnly — absent from the APK. R8 still traces
# FacebookAuthProviderHandler from the provider-init branch that never
# runs and, since AGP 7, errors the build on its unresolvable
# com.facebook.* references without this. Runtime-safe: the branch is
# never taken. (The Google provider's classes are real dependencies via
# rgcfaIncludeGoogle in ../variables.gradle, not -dontwarn'd away.)
-dontwarn com.facebook.**

# @capacitor-firebase/messaging (io.capawesome.capacitorjs.plugins.firebase.messaging)
#
# The CI workflow runs `npx cap sync android` before bundleRelease, which
# regenerates capacitor.settings.gradle / capacitor.build.gradle to include
# this plugin. Capacitor's consumer ProGuard rules (shipped in @capacitor/android)
# keep classes annotated with @CapacitorPlugin — so FirebaseMessagingPlugin
# itself is kept — but they do NOT keep the internal helper and model classes
# in the same package that the plugin's load() method instantiates. R8 strips
# those helpers (they are unreachable from any @CapacitorPlugin keep root), and
# when Bridge.init() calls load(), the missing class triggers NoClassDefFoundError.
# That is an Error, not an Exception, so Capacitor's internal try/catch does not
# catch it; the error propagates through super.onCreate() and the app crashes on
# launch. Debug builds are unaffected because D8 (debug) never strips classes.
#
# Keep the full plugin package — plugin class, helpers, models, callbacks — so
# R8 has no reachable entry to strip any of them.
-keep class io.capawesome.capacitorjs.plugins.firebase.messaging.** { *; }
-dontwarn io.capawesome.capacitorjs.plugins.firebase.messaging.**

# @capacitor-firebase/app-check + @capacitor-firebase/authentication
# (io.capawesome.capacitorjs.plugins.firebase.appcheck / .authentication)
#
# Same failure mode as the messaging plugin above, and the reason a
# messaging-only keep rule (#1603) is an incomplete fix. Both plugins
# instantiate a same-package helper class the moment Capacitor builds the
# plugin during Bridge.init():
#   • app-check     — a FIELD INITIALIZER: `private final FirebaseAppCheck
#     implementation = new FirebaseAppCheck(this)` runs in the plugin's
#     constructor (before load()).
#   • authentication — `load()` does `new FirebaseAuthentication(this, config)`.
# Capacitor's consumer rules keep the @CapacitorPlugin-annotated plugin class
# but NOT those helpers, so R8 strips them; construction/load() then raises
# NoClassDefFoundError (an Error, not an Exception) which propagates through
# super.onCreate() → launch crash on the signed release build. Because plugins
# load sequentially and the messaging crash fired first, it MASKED these two —
# fixing only messaging would surface the app-check crash next. Debug builds
# (D8, no shrink) never reproduce it. Keep both full packages.
#
# The authentication package includes handlers/FacebookAuthProviderHandler,
# which references com.facebook.* — those refs stay covered by the existing
# `-dontwarn com.facebook.**` above (the Facebook provider is disabled, so the
# branch that would touch them never runs at runtime).
-keep class io.capawesome.capacitorjs.plugins.firebase.appcheck.** { *; }
-dontwarn io.capawesome.capacitorjs.plugins.firebase.appcheck.**
-keep class io.capawesome.capacitorjs.plugins.firebase.authentication.** { *; }
-dontwarn io.capawesome.capacitorjs.plugins.firebase.authentication.**
