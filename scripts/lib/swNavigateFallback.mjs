/**
 * Which top-level navigations the service worker must NOT answer with the
 * SPA shell.
 *
 * VitePWA's `navigateFallback` (see vite.config.js) registers a workbox
 * NavigationRoute that answers EVERY request with `mode === 'navigate'` from
 * the precached /index.html. A browser navigation to a real static file is a
 * navigate request — typing zedexams.com/sitemap.xml in the address bar,
 * "open link in new tab" on a PDF, a share-sheet link — so without an entry
 * here the service worker hands back the SPA shell for a file that exists in
 * dist/ and is served correctly by Firebase Hosting. React Router then finds
 * no matching route and renders NotFound, which is exactly how /sitemap.xml
 * and /robots.txt came to render a styled "404 — Page not found" screen in a
 * browser while the origin was serving both files the whole time. The bug is
 * invisible to curl and to crawlers (no service worker, so they get the real
 * file) and invisible on a first visit (the SW is not yet controlling the
 * page) — it only reproduces on a return visit in a real browser, which is
 * what makes it read like a hosting misconfiguration.
 *
 * Workbox matches these patterns against `url.pathname + url.search` — never
 * a full URL. See `_match` in workbox-routing/NavigationRoute.js:
 *
 *     const pathnameAndSearch = url.pathname + url.search;
 *     for (const regExp of this._denylist) {
 *       if (regExp.test(pathnameAndSearch)) return false;
 *     }
 *
 * So an origin-shaped pattern such as `/^https?:\/\/.*googleapis\.com/` can
 * never fire. Three of those sat in this denylist looking like protection
 * until 2026-07-31; they are deliberately not carried over, and
 * test-sw-navigate-fallback.mjs fails if one is added back.
 *
 * This module exists separately from vite.config.js so the rules are
 * testable without booting Vite — the same reason scripts/lib/declaredRoutes.mjs
 * exists.
 */

/**
 * The denylist handed to VitePWA's `navigateFallbackDenylist`.
 *
 * Deliberately only two rules. The second is the one that makes this stop
 * recurring: rather than naming the files we already know about, it denies
 * anything that looks like a file, so a new asset dropped into public/ is
 * covered the day it ships instead of the day someone reports a 404 for it.
 */
export const NAVIGATE_FALLBACK_DENYLIST = [
  // Firebase's reserved namespace — /__/auth/handler and friends must always
  // reach the network.
  /^\/__\//,
  // Any path whose final segment carries a file extension: /sitemap.xml,
  // /robots.txt, /llms.txt, /timetables/grade-7-2026-exam-timetable.pdf,
  // /notes/*.png, /syllabi/*.json …
  //
  // Safe as a blanket rule because no route in the app has a dot in its last
  // segment — all 200-odd declared routes plus every blog slug are checked
  // against this in test-sw-navigate-fallback.mjs, so a future route that
  // does (say /v1.5/whats-new) fails the test loudly instead of silently
  // rendering NotFound for real users.
  //
  // `[^/?#]` rather than `.` so a query string can't smuggle a match in:
  // /papers?q=notes.pdf is a route, not a file.
  /^\/(?:[^/?#]+\/)*[^/?#]+\.[^/?#]+(?:[?#]|$)/,
]

/**
 * Mirror of workbox's NavigationRoute denylist check, so tests can assert on
 * the same decision the service worker will make at runtime.
 *
 * @param {string} pathnameAndSearch e.g. '/sitemap.xml' or '/papers?q=x'
 * @param {RegExp[]} [denylist]
 * @returns {boolean} true when the SPA fallback must NOT be used
 */
export function isNavigateFallbackDenied(pathnameAndSearch, denylist = NAVIGATE_FALLBACK_DENYLIST) {
  return denylist.some((re) => re.test(pathnameAndSearch))
}
