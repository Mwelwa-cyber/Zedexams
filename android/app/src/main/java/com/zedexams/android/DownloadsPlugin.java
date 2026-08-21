package com.zedexams.android;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Writes a generated document into the phone's PUBLIC Downloads folder.
 *
 * WHY THIS EXISTS
 * ───────────────
 * "Download" used to hand the file to {@code @capacitor/share}: the bytes were
 * written to app-private cache and the system share sheet opened over the app.
 * A teacher tapping Download therefore got a list of WhatsApp contacts, not a
 * file — and the cached copy was somewhere they could never reach, cleaned by
 * the OS whenever it felt like it. Downloading and sharing are two different
 * intentions; this plugin is the first one.
 *
 * WHY IT IS A CUSTOM PLUGIN AND NOT {@code @capacitor/filesystem}
 * ──────────────────────────────────────────────────────────────
 * That plugin's own definitions say {@code Directory.Documents} and
 * {@code Directory.ExternalStorage} are "not accessible on Android 10 unless
 * the app enables legacy External Storage", and on Android 11+ an app can only
 * see files it created itself. Under scoped storage the ONLY supported way into
 * the shared Downloads collection is MediaStore, which the Filesystem plugin
 * does not expose. So the write has to happen here.
 *
 * TWO WRITE PATHS, split at Android 10 (API 29):
 *   • API 29+  → MediaStore.Downloads. No permission at all: an app may always
 *                contribute to the shared collections. The insert is made
 *                IS_PENDING so a half-written file is never visible to Files,
 *                and MediaStore de-duplicates the display name for us.
 *   • API 24-28 → the legacy public Downloads directory, which does need
 *                WRITE_EXTERNAL_STORAGE at runtime, plus a media-scanner poke
 *                so the file shows up in Files / Downloads immediately rather
 *                than after the next reboot.
 *
 * JS side: {@code Capacitor.Plugins.ZedDownloads.saveToDownloads({...})},
 * wrapped by src/utils/nativeDownload.js. Rejecting is meaningful — the caller
 * falls back to the old share route so the user still gets their file.
 */
@CapacitorPlugin(
    name = "ZedDownloads",
    permissions = {
        @Permission(
            alias = DownloadsPlugin.LEGACY_STORAGE_ALIAS,
            strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
        )
    }
)
public class DownloadsPlugin extends Plugin {

    static final String LEGACY_STORAGE_ALIAS = "legacyStorage";

    /** Anything Windows, FAT32 or MediaStore refuses in a display name. */
    private static final String ILLEGAL_NAME_CHARS = "[\\\\/:*?\"<>|\\x00-\\x1F]";

    /**
     * Save base64 bytes into the public Downloads folder.
     *
     * @param call filename (required), data (required, base64, no data: prefix),
     *             mimeType (optional — guessed from the extension when absent).
     *             Resolves {uri, filename}; rejects with a code the JS side logs.
     */
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        if (filename == null || filename.trim().isEmpty()) {
            call.reject("MISSING_FILENAME");
            return;
        }
        if (data == null) {
            call.reject("MISSING_DATA");
            return;
        }

        // Scoped storage (Android 10+): contributing to the shared Downloads
        // collection needs no permission whatsoever. Asking for one there would
        // prompt the user for something the system would deny anyway.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            performSave(call);
            return;
        }

        if (getPermissionState(LEGACY_STORAGE_ALIAS) == PermissionState.GRANTED) {
            performSave(call);
        } else {
            requestPermissionForAlias(LEGACY_STORAGE_ALIAS, call, "legacyStorageCallback");
        }
    }

    @PermissionCallback
    private void legacyStorageCallback(PluginCall call) {
        if (getPermissionState(LEGACY_STORAGE_ALIAS) != PermissionState.GRANTED) {
            // A refusal is the user's decision about the Downloads folder, not
            // about the file. The JS caller falls back to the share sheet, which
            // is how they can still get the document out of the app.
            call.reject("STORAGE_PERMISSION_DENIED");
            return;
        }
        performSave(call);
    }

    private void performSave(PluginCall call) {
        String filename = sanitizeFilename(call.getString("filename"));
        String mimeType = call.getString("mimeType");
        if (mimeType == null || mimeType.trim().isEmpty()) {
            mimeType = guessMimeType(filename);
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("BAD_BASE64: " + e.getMessage());
            return;
        }

        try {
            Uri saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? writeViaMediaStore(filename, mimeType, bytes)
                : writeToLegacyDownloads(filename, bytes);

            JSObject ret = new JSObject();
            ret.put("uri", saved.toString());
            ret.put("filename", filename);
            // Nothing on screen changes when a file lands in Downloads, so say
            // so — this is the app's equivalent of the browser's download chip.
            toastSaved(filename);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("SAVE_FAILED: " + e.getMessage(), e);
        }
    }

    /**
     * Android 10+: insert into the shared Downloads collection.
     *
     * IS_PENDING is what makes this safe to interrupt — the row exists but no
     * other app can open it until we clear the flag, so a failure part-way
     * through can never leave a truncated .docx sitting in the user's Downloads
     * looking like a finished file. On failure the pending row is deleted.
     */
    @RequiresApi(Build.VERSION_CODES.Q)
    private Uri writeViaMediaStore(String filename, String mimeType, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();

        ContentValues pending = new ContentValues();
        pending.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        pending.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        pending.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, pending);
        if (item == null) {
            throw new IllegalStateException("MediaStore refused to create the download entry");
        }

        try {
            try (OutputStream out = resolver.openOutputStream(item)) {
                if (out == null) {
                    throw new IllegalStateException("MediaStore gave no stream to write to");
                }
                out.write(bytes);
                out.flush();
            }
        } catch (Exception e) {
            // Don't leave an invisible, empty, un-deletable row behind.
            try {
                resolver.delete(item, null, null);
            } catch (Exception ignored) {
                // Best effort — the original failure is the one worth reporting.
            }
            throw e;
        }

        ContentValues publish = new ContentValues();
        publish.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(item, publish, null, null);
        return item;
    }

    /** Android 9 and below: the real public Downloads directory on disk. */
    private Uri writeToLegacyDownloads(String filename, byte[] bytes) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) {
            throw new IllegalStateException("No public Downloads directory on this device");
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Could not create the Downloads directory");
        }

        File target = uniqueFile(dir, filename);
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
            out.flush();
        }

        // Without this the file is on disk but absent from Files / Downloads /
        // MTP until the next media scan, which reads to the user as a save that
        // did nothing.
        MediaScannerConnection.scanFile(
            getContext(),
            new String[] { target.getAbsolutePath() },
            null,
            null
        );
        return Uri.fromFile(target);
    }

    /**
     * "Lesson Plan.docx" → "Lesson Plan (1).docx" when the first is taken.
     * MediaStore does this itself on API 29+; the legacy path would otherwise
     * silently overwrite last week's plan with this week's.
     */
    private static File uniqueFile(File dir, String filename) {
        File candidate = new File(dir, filename);
        if (!candidate.exists()) return candidate;

        int dot = filename.lastIndexOf('.');
        String stem = dot > 0 ? filename.substring(0, dot) : filename;
        String ext = dot > 0 ? filename.substring(dot) : "";

        for (int n = 1; n < 1000; n++) {
            File next = new File(dir, stem + " (" + n + ")" + ext);
            if (!next.exists()) return next;
        }
        // Astronomically unlikely; a timestamp still beats clobbering a file.
        return new File(dir, stem + " (" + System.currentTimeMillis() + ")" + ext);
    }

    /**
     * Strip anything that cannot appear in a file name. Names reach here from
     * the document title a teacher typed, so they carry colons, slashes and the
     * occasional newline; MediaStore rejects the insert outright for those.
     */
    static String sanitizeFilename(String raw) {
        String name = raw == null ? "" : raw.trim();
        // Both path separators are in ILLEGAL_NAME_CHARS, so this pass is also
        // what makes the legacy `new File(dir, name)` write safe: once every
        // separator is a space the name cannot describe a path at all, let alone
        // one that escapes Downloads. Replacing them (rather than cutting the
        // string at the last one) keeps the whole title — a teacher's "Term 1/2
        // plan" should save as "Term 1 2 plan", not as "2 plan".
        name = name.replaceAll(ILLEGAL_NAME_CHARS, " ").replaceAll("\\s+", " ").trim();
        // Leading dots hide the file on Linux-derived filesystems, and peeling
        // them also disarms a "../.." name left toothless by the pass above.
        while (name.startsWith(".")) name = name.substring(1).trim();
        if (name.isEmpty()) return "download";
        // Keep clear of the 255-byte limit while preserving the extension.
        if (name.length() > 200) {
            int dot = name.lastIndexOf('.');
            String ext = dot > 0 && name.length() - dot <= 10 ? name.substring(dot) : "";
            name = name.substring(0, 200 - ext.length()).trim() + ext;
        }
        return name;
    }

    /**
     * MediaStore appends its own extension when the MIME type disagrees with the
     * display name, so "Lesson Plan.docx" declared as octet-stream can land as
     * "Lesson Plan.docx.bin". Every type this app actually exports is listed.
     */
    static String guessMimeType(String filename) {
        String lower = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".docx")) {
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }
        if (lower.endsWith(".pptx")) {
            return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        }
        if (lower.endsWith(".xlsx")) {
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        }
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }

    private void toastSaved(String filename) {
        final Context ctx = getContext();
        if (getActivity() == null || ctx == null) return;
        getActivity().runOnUiThread(
            () -> Toast.makeText(ctx, "Saved to Downloads: " + filename, Toast.LENGTH_LONG).show()
        );
    }
}
