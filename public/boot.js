/*
 * Boot scripts, externalised from index.html so the Content-Security-Policy can
 * drop 'unsafe-inline' from script-src (an injected inline <script> would
 * otherwise still execute). This file ships verbatim from public/ — Vite copies
 * it as-is with no minification or hashing — so a plain script-src 'self'
 * covers it, with no fragile per-build hash to maintain.
 *
 * Runs, in order, at the top of <body> (a matching
 * <link rel="preload" as="script" href="/boot.js"> in <head> starts the
 * download during head parse, so the render-blocking <script> resolves near-
 * instantly and the boot skeleton still paints fast):
 *   1. Pre-paint theme guard — mirrors ThemeContext, avoids a palette flash
 *      before React mounts.
 *   2. Google Fonts promotion — replaces the inline onload="this.media='all'"
 *      that kept the font stylesheet non-render-blocking.
 *   3. Boot watchdog (white-screen guard) — replaces the inline onclick
 *      handlers in the recovery UI with addEventListener.
 */
(function () {
  // 1. Pre-paint theme guard. CSS :root defaults to the Sky palette, so without
  //    this the body would flash blue before React mounts and applies the
  //    saved/brand-default theme. Mirror ThemeContext: saved choice, else the
  //    'oatmeal' brand default.
  //    `retired` covers the two palettes removed in 2026-07: their CSS is
  //    gone, so a device still holding one of those ids would paint with no
  //    palette at all. ThemeContext rewrites the stored key once React
  //    mounts; this only has to survive the first frame, so it maps and does
  //    not write.
  //    No saved choice → seed from the OS colour scheme (prefers-color-scheme),
  //    midnight when dark, the brand default otherwise. The seed is never
  //    WRITTEN — an absent key means "not answered", so the site keeps
  //    following the OS until the visitor picks a theme. ThemeContext's
  //    resolveInitialTheme mirrors this exactly; test:reading-theme-mirror
  //    fails if the two drift. Midnight also gets the `dark` class on <html>
  //    pre-paint, so native controls (color-scheme) match from the first frame.
  try {
    var prefersDark = false;
    try {
      prefersDark = !!(window.matchMedia
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {}
    var legacy = { light: 'sky', warm: 'oatmeal', dark: 'midnight' };
    var retired = { lavender: 'sky', vivid: 'solar' };
    var ids = ['oatmeal', 'sky', 'solar', 'midnight'];
    var saved = localStorage.getItem('examprep:theme');
    saved = legacy[saved] || retired[saved] || saved;
    var resolved = ids.indexOf(saved) !== -1
      ? saved
      : (prefersDark ? 'midnight' : 'oatmeal');
    document.body.classList.add('theme-' + resolved);
    if (resolved === 'midnight') document.documentElement.classList.add('dark');
  } catch (e) {
    document.body.classList.add('theme-oatmeal');
  }

  // 1b. Pre-paint TEACHER workspace theme guard. Separate from the learner
  //     palette above: that one is a body class, this one is `data-theme` on
  //     <html> driving the --zt-* tokens (src/index.css). Mirrors
  //     src/contexts/teacherThemeCore.js — keep the id list and the default in
  //     step with it; test:teacher-theme-boot fails if they drift.
  //
  //     This lives here rather than as an inline <script> in index.html's
  //     <head> (which is where a theme guard normally goes) because the CSP
  //     deliberately has no 'unsafe-inline' in script-src — see the header
  //     comment. boot.js is render-blocking at the top of <body> and is
  //     preloaded in <head>, so it still runs before first paint and there is
  //     no flash of the default theme.
  //     No saved choice → the same prefers-color-scheme seeding as the learner
  //     guard above (night when the OS is dark, the default otherwise), never
  //     written. Mirrors teacherThemeStore.readInitial.
  try {
    var teacherPrefersDark = false;
    try {
      teacherPrefersDark = !!(window.matchMedia
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {}
    var teacherIds = ['terracotta', 'miombo', 'copperbelt', 'night'];
    var savedTeacher = localStorage.getItem('zedexams-theme');
    if (teacherIds.indexOf(savedTeacher) === -1) {
      // Same migration as teacherThemeStore: the retired per-device dashboard
      // toggle counts as a saved dark choice.
      savedTeacher = localStorage.getItem('zedexams:tdv2-theme') === 'dark'
        ? 'night'
        : (teacherPrefersDark ? 'night' : 'terracotta');
    }
    document.documentElement.setAttribute('data-theme', savedTeacher);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'terracotta');
  }

  // 2. Promote the deferred Google Fonts stylesheet from media="print" to "all"
  //    once it loads (replaces the inline onload attribute on #zed-fonts). If
  //    it already loaded before this ran, promote immediately.
  try {
    var fontCss = document.getElementById('zed-fonts');
    if (fontCss) {
      var promote = function () { fontCss.media = 'all'; };
      if (fontCss.sheet) promote();
      else fontCss.addEventListener('load', promote);
    }
  } catch (e) {}

  // 2.5 LCP hero preload — ONLY on the public landing route ('/').
  //     The marketing hero image is the LCP element, but it lives inside the
  //     lazy Marketing chunk, so the browser can't discover its URL until the
  //     eager JS bundle parses + React mounts + Marketing renders — which is
  //     what pushed real-user mobile LCP to ~13s. Injecting a high-priority
  //     preload here (boot.js runs during early body parse, before the JS
  //     bundle) starts the image download in parallel with the JS. Gated to '/'
  //     so we preload ONLY the true LCP resource and never waste bytes on
  //     /login, /papers, etc. Idempotent + failure-safe.
  try {
    if (location.pathname === '/' && !document.getElementById('zed-hero-preload')) {
      var heroLink = document.createElement('link');
      heroLink.id = 'zed-hero-preload';
      heroLink.rel = 'preload';
      heroLink.as = 'image';
      heroLink.href = '/images/characters/zed-hero-team.webp';
      heroLink.setAttribute('fetchpriority', 'high');
      document.head.appendChild(heroLink);
    }
  } catch (e) {}

  // 3. Boot watchdog (white-screen guard). If anything throws while the app is
  //    starting up — before React's <ErrorBoundary> has mounted — this replaces
  //    the blank #root with a recoverable message. main.jsx sets
  //    window.__ZED_APP_MOUNTED__ once it renders, so a successful (even slow)
  //    boot never trips it.
  var HARD_TIMEOUT = 12000; // silent-hang backstop (slow ZM mobile networks)
  var ERROR_GRACE = 2000;   // wait after a boot error in case React still recovers
  var shown = false;
  function appMounted() {
    if (window.__ZED_APP_MOUNTED__) return true;
    var root = document.getElementById('root');
    if (!root) return false;
    // The inline boot skeleton lives inside #root before React mounts; it must
    // NOT count as "mounted" or the white-screen guard would never fire on a
    // genuine hang. Any other child means React has rendered.
    for (var i = 0; i < root.children.length; i++) {
      if (root.children[i].id !== 'zed-boot-skeleton') return true;
    }
    return false;
  }
  window.zedClearCacheReload = function () {
    var done = function () { location.reload(); };
    try {
      var jobs = [];
      if ('serviceWorker' in navigator) {
        jobs.push(
          navigator.serviceWorker.getRegistrations()
            .then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
            .catch(function () {})
        );
      }
      if (window.caches && caches.keys) {
        jobs.push(
          caches.keys()
            .then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
            .catch(function () {})
        );
      }
      Promise.all(jobs).then(done, done);
    } catch (e) { done(); }
  };
  function showFallback() {
    if (shown || appMounted()) return;
    shown = true;
    var root = document.getElementById('root');
    if (!root) return;
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;background:#FDF6EC;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1A1F2E;text-align:center;">' +
        '<div style="max-width:480px;">' +
          '<h1 style="font-size:1.5rem;font-weight:800;margin:0 0 0.5rem;">We could not finish loading ZedExams</h1>' +
          '<p style="margin:0 0 1.25rem;line-height:1.5;color:#4B6280;">This is usually a temporary loading or cached-version problem. Reloading the page fixes it most of the time.</p>' +
          '<div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;margin-bottom:1.25rem;">' +
            '<button type="button" id="zed-fallback-reload" style="cursor:pointer;border:0;border-radius:0.625rem;padding:0.7rem 1.25rem;font-weight:700;font-size:0.95rem;color:#fff;background:#B95C3A;">Reload</button>' +
            '<button type="button" id="zed-fallback-clear" style="cursor:pointer;border:1px solid #CBD5E1;border-radius:0.625rem;padding:0.7rem 1.25rem;font-weight:700;font-size:0.95rem;color:#1A1F2E;background:#fff;">Clear cache &amp; reload</button>' +
          '</div>' +
          '<p style="margin:0;font-size:0.875rem;color:#4B6280;">Still stuck? Email <a href="mailto:support@zedexams.com" style="color:#AA5435;font-weight:700;">support@zedexams.com</a> or WhatsApp <a href="https://wa.me/260977740465" style="color:#AA5435;font-weight:700;">+260 977 740 465</a>.</p>' +
        '</div>' +
      '</div>';
    // Wire the recovery buttons via addEventListener (the inline onclick
    // handlers these replace are what forced script-src 'unsafe-inline').
    var reloadBtn = document.getElementById('zed-fallback-reload');
    if (reloadBtn) reloadBtn.addEventListener('click', function () { location.reload(); });
    var clearBtn = document.getElementById('zed-fallback-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { window.zedClearCacheReload(); });
  }
  function onBootError() {
    if (appMounted()) return;
    setTimeout(function () { if (!appMounted()) showFallback(); }, ERROR_GRACE);
  }
  // Capture-phase catches failed <script>/<link> loads (e.g. a stale-SW
  // ChunkLoadError) as well as thrown errors.
  window.addEventListener('error', onBootError, true);
  window.addEventListener('unhandledrejection', onBootError);
  window.addEventListener('load', function () {
    setTimeout(function () { if (!appMounted()) showFallback(); }, HARD_TIMEOUT);
  });
})();
