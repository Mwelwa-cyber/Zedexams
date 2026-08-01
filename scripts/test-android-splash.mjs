/*
 * test:android-splash — guards the Android in-app splash wiring
 * (index.html + public/zx-splash.js + src/App.jsx + the native hand-off).
 *
 * The failure modes this pins are all quiet ones:
 *   • The controller migrating back to an inline <script> — the site CSP has
 *     no 'unsafe-inline' in script-src, so an inline controller is silently
 *     blocked on the website and the hidden splash node never gets removed.
 *   • Detection via localStorage — a TWA shares Chrome's storage with the
 *     browser on the same phone, so a persistent flag leaks the splash onto
 *     the website. sessionStorage only.
 *   • Losing the Capacitor signal — the shipped Android app is a Capacitor
 *     shell (webDir=dist, https://localhost), NOT a TWA; TWA-only detection
 *     means the splash never shows in the real app.
 *   • `hidden` losing to `display: flex` — without an explicit
 *     #zx-splash[hidden] rule the splash paints on the website whenever the
 *     controller fails to run.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

let failures = 0
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const indexHtml = read('index.html')
const controller = read('public/zx-splash.js')
const appJsx = read('src/App.jsx')
const colorsXml = read('android/app/src/main/res/values/colors.xml')

console.log('index.html')
check('splash markup present and hidden by default', /<div id="zx-splash" hidden>/.test(indexHtml))
check('splash <style id="zx-splash-style"> present', indexHtml.includes('<style id="zx-splash-style">'))
check(
  'splash block sits before <div id="root"> so it can cover the boot skeleton from the first frame',
  indexHtml.indexOf('id="zx-splash"') !== -1 &&
    indexHtml.indexOf('id="zx-splash"') < indexHtml.indexOf('<div id="root">')
)
check(
  'controller is the external /zx-splash.js (CSP: script-src has no unsafe-inline)',
  indexHtml.includes('<script src="/zx-splash.js"></script>')
)
check(
  'controller script tag comes after the splash markup it controls',
  indexHtml.indexOf('id="zx-splash"') < indexHtml.indexOf('<script src="/zx-splash.js"></script>')
)
check('/zx-splash.js is preloaded in <head>', /rel="preload" href="\/zx-splash\.js" as="script"/.test(indexHtml))
check(
  'hidden attribute beats display:flex (#zx-splash[hidden] rule)',
  /#zx-splash\[hidden\]\s*\{\s*display:\s*none/.test(indexHtml)
)
check('splash sits at z-index 9999', /#zx-splash\s*\{[^}]*z-index:\s*9999/.test(indexHtml))
check('prefers-reduced-motion handled inside the splash style', indexHtml.includes('prefers-reduced-motion'))
// Every splash keyframe must be zx-prefixed so it can't collide with app CSS.
const splashStyle = indexHtml.split('<style id="zx-splash-style">')[1].split('</style>')[0]
const keyframeNames = [...splashStyle.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
check(
  `all splash keyframes are zx-prefixed (${keyframeNames.length} found)`,
  keyframeNames.length > 0 && keyframeNames.every((n) => n.startsWith('zx')),
  keyframeNames.filter((n) => !n.startsWith('zx')).join(', ')
)

console.log('public/zx-splash.js')
// Match actual API usage (`localStorage.` / `localStorage[`), not the word in
// the header comment that explains why it is forbidden.
check('never touches localStorage (would leak the splash onto the website)', !/localStorage\s*[.[]/.test(controller))
check('uses sessionStorage zx_twa flag', controller.includes("sessionStorage.getItem('zx_twa')"))
check('detects the Capacitor shell (the real Android app is Capacitor, not a TWA)', /isNativePlatform/.test(controller))
check('keeps the TWA signals (android-app:// referrer + ?twa=1)', controller.includes('android-app://') && controller.includes("'twa'"))
check('removes splash AND style on the website path', /splash\.remove\(\);\s*\n?\s*style\.remove\(\);\s*\n?\s*return;/.test(controller))
check('minimum show time is 2600ms', /MIN_SHOW\s*=\s*2600/.test(controller))
check('10s failsafe hide', /setTimeout\(hide,\s*10000\)/.test(controller))
check('exposes window.ZedSplash.hide', /window\.ZedSplash\s*=\s*\{\s*hide:\s*hide\s*\}/.test(controller))

console.log('src/App.jsx')
check('App signals ready via window.ZedSplash?.hide?.()', appJsx.includes('window.ZedSplash?.hide?.()'))

console.log('android/')
check(
  'native splash background matches the animation navy (#081226) for a seamless hand-off',
  /zed_splash_bg">#081226</.test(colorsXml)
)

if (failures > 0) {
  console.error(`\ntest:android-splash FAILED — ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\ntest:android-splash passed')
