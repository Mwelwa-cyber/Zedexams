/*
 * ZedExams Android in-app splash controller.
 *
 * Shows the animated brand splash (markup + <style id="zx-splash-style"> live
 * inline in index.html, just before #root) ONLY when index.html is loaded
 * inside the Android app shell — never on the website in a normal browser.
 *
 * External file, not an inline <script>, because the site's CSP
 * (firebase.json) deliberately has no 'unsafe-inline' in script-src — an
 * inline controller would be blocked on the website, leaving the hidden
 * #zx-splash node and its <style> in the DOM instead of removing them. This
 * ships verbatim from public/ (no hashing) so plain script-src 'self' covers
 * it, exactly like /boot.js. It is loaded render-blocking immediately after
 * the splash markup, before <div id="root">, so on native the splash is
 * already visible in the very first frame the WebView paints — MainActivity
 * holds the system splash until that paint, so launch reads as one
 * continuous navy sequence.
 *
 * Detection: the Play Store app is a CAPACITOR shell bundling dist/ locally
 * (capacitor.config.json webDir=dist; WebView origin https://localhost), so
 * the primary signal is the Capacitor native bridge, which Capacitor injects
 * into <head> before any body script runs. The TWA-style signals
 * (android-app:// referrer, ?twa=1, sessionStorage flag) are kept as
 * secondary signals so a future TWA build works without touching this file.
 *
 * NEVER use localStorage for the flag: a TWA shares Chrome's storage with
 * the browser on the same phone, so a persistent flag would leak the splash
 * onto the website. sessionStorage only (guarded by test:android-splash).
 */
(function () {
  var splash = document.getElementById('zx-splash');
  var style  = document.getElementById('zx-splash-style');
  if (!splash || !style) return;

  var inApp = false;
  try {
    var cap = window.Capacitor;
    inApp = !!(cap && ((typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) ||
                       (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'web')));
  } catch (e) { /* bridge probe failed — fall through to the TWA signals */ }
  try {
    inApp = inApp ||
      (document.referrer && document.referrer.indexOf('android-app://') === 0) ||
      new URLSearchParams(window.location.search).get('twa') === '1' ||
      sessionStorage.getItem('zx_twa') === '1';
    if (inApp) sessionStorage.setItem('zx_twa', '1');
  } catch (e) { /* storage blocked — fall through */ }

  if (!inApp) {                      // Website: remove splash entirely
    splash.remove();
    style.remove();
    return;
  }

  splash.hidden = false;             // App: show before first paint
  var t0 = Date.now();
  var MIN_SHOW = 2600;               // let the animation complete
  var done = false;

  // ambient drifting specks
  (function () {
    var host = document.getElementById('zx-specks');
    var colors = ['rgba(96,165,250,0.8)', 'rgba(238,244,255,0.7)', 'rgba(253,186,116,0.8)'];
    for (var i = 0; i < 16; i++) {
      var s = document.createElement('span');
      s.className = 'zx-speck';
      var size = 2 + Math.random() * 3.5;
      s.style.width = s.style.height = size + 'px';
      s.style.left = (4 + Math.random() * 92) + '%';
      s.style.top  = (18 + Math.random() * 70) + '%';
      s.style.background = colors[i % 3];
      s.style.setProperty('--dur',  (7 + Math.random() * 7) + 's');
      s.style.setProperty('--delay', (Math.random() * 5) + 's');
      s.style.setProperty('--peak', (0.25 + Math.random() * 0.5).toFixed(2));
      host.appendChild(s);
    }
  })();

  function hide() {
    if (done) return;
    done = true;
    var wait = Math.max(0, MIN_SHOW - (Date.now() - t0));
    setTimeout(function () {
      splash.classList.add('zx-exit');
      setTimeout(function () { splash.remove(); style.remove(); }, 650);
    }, wait);
  }

  window.ZedSplash = { hide: hide };
  setTimeout(hide, 10000);           // failsafe: never block the app
})();
