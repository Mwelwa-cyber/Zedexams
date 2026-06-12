/*
 * sw-reload-clients.js — imported into the generated Workbox service worker
 * (see vite.config.js → workbox.importScripts). Runs in service-worker scope.
 *
 * Purpose: heal devices frozen on an OLD precached bundle. registerType
 * 'autoUpdate' + skipWaiting + clientsClaim already make a new SW activate and
 * take control at once, but the page that's *currently rendered* keeps showing
 * the old assets until something reloads it — and a page running a bundle old
 * enough won't reload itself. That mismatch is exactly why the live site
 * appeared to "revert" (old study-plan card, removed admin previews) for
 * returning users.
 *
 * When a newly-installed SW activates as an UPDATE (it is replacing an
 * existing worker), notify every open tab so it can reload onto the
 * freshly-activated precache at a safe moment.  We do NOT call
 * client.navigate() directly here because that is a hard, immediate reload
 * that interrupts any in-progress async operation (e.g. a document-quiz
 * import that may take 15-30 s on a slow connection).  Instead we
 * postMessage({ type: 'SW_RELOAD_REQUEST' }) so the page can schedule the
 * reload after its current operation finishes.  The page's usePwaUpdate hook
 * receives this message and surfaces the existing "New version available"
 * prompt; users on frozen old tabs will still cross over — just gracefully.
 *
 * A first-ever install (no prior worker) is skipped so a brand-new visitor
 * never sees a redundant prompt. Any failure is swallowed — a messaging
 * hiccup must never wedge SW activation.
 */
(function () {
  // Captured during install: a truthy active worker means this SW is
  // replacing an existing one (an update), not a first-time install. Read at
  // install time because by activate the registration's active worker is us.
  var replacingExisting = false

  self.addEventListener('install', function () {
    try {
      replacingExisting = Boolean(self.registration && self.registration.active)
    } catch (e) {
      replacingExisting = false
    }
  })

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      (async function () {
        try {
          await self.clients.claim()
          // Only notify when crossing over from a previous build.
          if (!replacingExisting) return
          var windows = await self.clients.matchAll({ type: 'window' })
          await Promise.all(
            windows.map(function (client) {
              // Ask the page to reload at a safe moment rather than
              // navigating immediately — prevents interrupting long-running
              // async operations such as document-quiz imports.
              return client.postMessage({ type: 'SW_RELOAD_REQUEST' })
                .catch(function () {})
            })
          )
        } catch (e) {
          // Never let a reload failure block activation.
        }
      })()
    )
  })
})()
