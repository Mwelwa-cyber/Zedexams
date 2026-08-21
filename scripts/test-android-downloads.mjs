/**
 * Guard: "Download" saves a file to the phone. It does not open a share sheet.
 *
 * The reported bug was that tapping Download on a lesson plan or weekly focus
 * offered a grid of WhatsApp contacts, Bluetooth and Huawei Share, and left
 * nothing in the phone's storage. Two independent routes caused it — the mobile
 * browser's `navigator.share`, and the native shell's cache-then-share — and
 * either one coming back reproduces the whole bug for the users on that route.
 *
 * These are TEXT-LEVEL checks, and that is deliberate on both halves:
 *
 *   • The Java plugin cannot be exercised by any test in this repo — no required
 *     CI job compiles the Android project (see CLAUDE.md), so the only thing
 *     that can be asserted here is that the pieces are wired to each other:
 *     plugin declared, registered in MainActivity, permission scoped, JS calling
 *     the name the plugin actually publishes. A mismatch between those four is
 *     silent on the web and fatal on the device.
 *
 *   • The JS ordering IS covered behaviourally by saveBlob.spec.js. What a
 *     behaviour test cannot see is a share call being reintroduced somewhere the
 *     spec does not stub — so the shape check below is the backstop for that.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let failures = 0
const read = (rel) => readFileSync(join(root, rel), 'utf8')
function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures += 1
  }
}

/* ── 1. The native plugin exists and writes to the PUBLIC Downloads folder ── */

const pluginPath = 'android/app/src/main/java/com/zedexams/android/DownloadsPlugin.java'
check(existsSync(join(root, pluginPath)), 'the DownloadsPlugin Java source exists')
const plugin = existsSync(join(root, pluginPath)) ? read(pluginPath) : ''

check(
  /@CapacitorPlugin\(\s*name\s*=\s*"ZedDownloads"/.test(plugin),
  'the plugin publishes itself as "ZedDownloads"',
)
check(
  /public void saveToDownloads\(PluginCall call\)/.test(plugin),
  'the plugin exposes saveToDownloads()',
)
check(
  /MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/.test(plugin),
  'the plugin inserts into the shared MediaStore Downloads collection — the ONLY '
    + 'route into public storage under scoped storage, and the reason this is a '
    + 'custom plugin rather than @capacitor/filesystem',
)
check(
  /MediaStore\.Downloads\.IS_PENDING/.test(plugin),
  'the MediaStore insert is made IS_PENDING so a half-written .docx is never '
    + 'visible to Files as a finished file',
)
check(
  /Environment\.DIRECTORY_DOWNLOADS/.test(plugin),
  'the plugin still has a legacy public-Downloads path for API 24-28 (minSdk is 24)',
)
check(
  /MediaScannerConnection\.scanFile/.test(plugin),
  'the legacy path pokes the media scanner, or the saved file stays invisible to '
    + 'Files until the next scan',
)

/* ── 2. Registered, or the WebView never sees it ─────────────────────────── */

const mainActivity = read('android/app/src/main/java/com/zedexams/android/MainActivity.java')
check(
  /registerPlugin\(DownloadsPlugin\.class\)/.test(mainActivity),
  'MainActivity registers DownloadsPlugin (an unregistered plugin is simply absent '
    + 'from Capacitor.Plugins, which reads to JS exactly like an old APK)',
)

/* ── 3. The storage permission is capped at API 28 ───────────────────────── */

const manifest = read('android/app/src/main/AndroidManifest.xml')
const writeStorage = /<uses-permission[^>]*WRITE_EXTERNAL_STORAGE[\s\S]*?\/>/.exec(manifest)
check(Boolean(writeStorage), 'the manifest declares WRITE_EXTERNAL_STORAGE for the legacy path')
check(
  Boolean(writeStorage) && /android:maxSdkVersion="28"/.test(writeStorage[0]),
  'WRITE_EXTERNAL_STORAGE is capped at maxSdkVersion 28 — from Android 10 MediaStore '
    + 'needs no permission, so an uncapped request would ask modern devices for broad '
    + 'storage access this app never uses',
)

/* ── 4. The JS calls the plugin by the name the plugin publishes ─────────── */

const nativeDownload = read('src/utils/nativeDownload.js')
check(
  /nativePlugin\(['"]ZedDownloads['"]\)/.test(nativeDownload),
  'nativeDownload.js resolves the plugin under the same name the Java class publishes',
)
check(
  /saveToDownloads\(\{/.test(nativeDownload),
  'nativeDownload.js calls saveToDownloads() — the method the plugin actually defines',
)

// Ordering: the Downloads write must come BEFORE the share fallback in the file,
// and saveBlobNative must reach the share route only through a catch.
const downloadsIdx = nativeDownload.indexOf('saveToPublicDownloads')
const shareIdx = nativeDownload.indexOf('export async function shareBlobNative')
check(
  downloadsIdx > -1 && shareIdx > -1 && downloadsIdx < shareIdx,
  'the public-Downloads save is the primary route and cache+share is the fallback',
)
check(
  /await saveToPublicDownloads\(blob, filename\)[\s\S]{0,600}?return shareBlobNative\(blob, filename\)/.test(
    nativeDownload,
  ),
  'saveBlobNative tries Downloads first and only then shares',
)

/* ── 5. No share sheet stands in front of a download, on any route ───────── */

const saveBlob = read('src/utils/saveBlob.js')

// Strip comments first. These files EXPLAIN why the share route was removed, so
// a check reading the raw text fails on its own documentation — and the obvious
// "fix" is to delete the explanation, which is the opposite of what we want.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const saveBlobCode = stripComments(saveBlob)

check(
  !/navigator\.share/.test(saveBlobCode),
  'saveBlob no longer calls navigator.share — THE bug: a share sheet is not a '
    + 'download, and picking a WhatsApp contact is not saving to the phone',
)
check(
  !/navigator\.canShare/.test(saveBlobCode),
  'saveBlob no longer feature-detects Web Share either (dead code that would invite '
    + 'the share route back)',
)
check(
  /import\(['"]\.\/stampedDownload\.js['"]\)/.test(saveBlobCode),
  'saveBlob still reaches the stamped Content-Disposition download for mobile browsers',
)

// The mobile-browser branch must reach the stamped route, and it must sit above
// the shared desktop fallback so a mobile download is never merely a blob anchor.
const mobileIdx = saveBlobCode.indexOf('isMobileBrowser()')
const stampedIdx = saveBlobCode.indexOf('saveViaStampedUrl')
const fileSaverIdx = saveBlobCode.indexOf("import('file-saver')")
check(
  mobileIdx > -1 && stampedIdx > mobileIdx && fileSaverIdx > stampedIdx,
  'the mobile-browser branch tries the stamped download before falling through to '
    + 'the shared blob:-URL path',
)

/* ── 6. Every exporter still funnels through the one choke point ─────────── */

for (const rel of [
  'src/engines/export-engine/lessonPlanToDocx.js',
  'src/engines/export-engine/weeklyForecastToDocx.js',
  'src/utils/htmlToPdf.js',
]) {
  check(
    /saveBlob\(/.test(read(rel)),
    `${rel} saves through saveBlob (one choke point, so one fix covers every studio)`,
  )
}

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll Android download checks passed')
