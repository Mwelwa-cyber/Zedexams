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
