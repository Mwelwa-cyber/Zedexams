/**
 * src/utils/swRecovery.js
 *
 * Recovery for the "stale lazy chunk after a Firebase Hosting deploy" failure.
 *
 * Every route in App.jsx is `React.lazy(() => import('…'))`, so each page ships
 * as a content-hashed chunk (e.g. `Login-I0CPmIMJ.js`). After a deploy the old
 * hashes 404. `index.html` is served `no-cache` (see firebase.json), so a plain
 * reload would normally pull a fresh shell with the new hashes — EXCEPT the PWA
 * service worker precaches `index.html` and keeps serving the stale shell that
 * points at the dead chunks. So `window.location.reload()` alone loops straight
 * back into the same failed import (observed in production: 28 chunk-load
 * failures across 5 users reaching the error boundary, May 2026).
 *
 * The only reliable recovery is to evict the service-worker shell before
 * reloading: clear Cache Storage and unregister the SW, then reload so the
 * browser fetches the live `index.html` (which references the new chunks).
 *
 * Pure, dependency-injectable functions so the behaviour can be unit-tested
 * without a browser (see scripts/test-sw-recovery.mjs).
 */

/**
 * True for the family of errors a browser throws when a lazily-imported ES
 * module / Webpack-style chunk can't be fetched. Covers Chrome/Edge, Firefox,
 * Safari, and the legacy Webpack `ChunkLoadError` shape.
 */
export function isChunkLoadError(err) {
  if (!err) return false
  if (err.name === 'ChunkLoadError') return true
  const msg = String(err.message || err)
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk .* failed/i.test(msg) ||
    /Loading CSS chunk .* failed/i.test(msg)
  )
}

/**
 * Drop every Cache Storage entry and unregister all service workers. Resolves
 * once both are done (or immediately in environments without the APIs). Never
 * rejects — each side is independently best-effort so a failure clearing caches
 * still lets us unregister the SW and vice-versa.
 *
 * Dependencies are injectable for testing; in the browser they default to the
 * global `caches` and `navigator.serviceWorker`.
 */
export async function purgeServiceWorkerCaches({ cacheStorage, serviceWorker } = {}) {
  const cacheApi =
    cacheStorage ?? (typeof caches !== 'undefined' ? caches : null)
  const sw =
    serviceWorker ??
    (typeof navigator !== 'undefined' ? navigator.serviceWorker : null)

  const tasks = []

  if (cacheApi && typeof cacheApi.keys === 'function') {
    tasks.push(
      cacheApi
        .keys()
        .then((keys) => Promise.all(keys.map((key) => cacheApi.delete(key))))
        .catch(() => {}),
    )
  }

  if (sw && typeof sw.getRegistrations === 'function') {
    tasks.push(
      sw
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .catch(() => {}),
    )
  }

  await Promise.allSettled(tasks)
}

/**
 * Recover from a chunk-load failure: purge the service-worker shell, then hard
 * reload so the next navigation pulls the live `index.html` + new chunks.
 *
 * The purge is raced against a timeout so a hung `caches`/`unregister` call can
 * never strand the user on a broken page — we always reload. The reload still
 * fires even if the purge rejects.
 *
 * Dependencies injectable for testing.
 */
export async function recoverFromChunkError({ purge, reload, timeoutMs = 4000 } = {}) {
  const doPurge = purge ?? purgeServiceWorkerCaches
  const doReload =
    reload ??
    (() => {
      if (typeof window !== 'undefined') window.location.reload()
    })

  await Promise.race([
    Promise.resolve()
      .then(doPurge)
      .catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])

  doReload()
}
