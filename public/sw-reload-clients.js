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
 * So when a newly-installed SW activates as an UPDATE (it is replacing an
 * existing worker), reload every open tab onto the freshly-activated precache.
 * A first-ever install (no prior worker) is skipped, so a brand-new visitor
 * never sees a redundant double-load. Any failure is swallowed — a reload
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
          // Only force a reload when crossing over from a previous build.
          if (!replacingExisting) return
          var windows = await self.clients.matchAll({ type: 'window' })
          await Promise.all(
            windows.map(function (client) {
              // navigate() reloads the controlled tab to the new shell.
              return client.navigate(client.url).catch(function () {})
            })
          )
        } catch (e) {
          // Never let a reload failure block activation.
        }
      })()
    )
  })
})()
