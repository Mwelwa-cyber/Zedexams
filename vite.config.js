import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * firebase-messaging-sw.js lives in /public so it ships untouched at the
 * origin root. Service-worker context can't read import.meta.env, so this
 * plugin substitutes __FIREBASE_*__ tokens with actual env values during
 * the build's writeBundle step (after Vite copies public/ to dist/).
 *
 * Values are PUBLIC web-app identifiers — apiKey is not a secret per
 * Firebase docs (security comes from rules, App Check, and OAuth). They
 * mirror the values already inlined in the bundled JS the page serves.
 */
function firebaseMessagingSwConfig(env) {
  return {
    name: 'firebase-messaging-sw-config',
    apply: 'build',
    writeBundle() {
      const swPath = resolve(__dirname, 'dist/firebase-messaging-sw.js')
      let sw
      try {
        sw = readFileSync(swPath, 'utf8')
      } catch {
        // No SW shipped (e.g. lib build). Quietly skip.
        return
      }
      // Vite's loadEnv reads .env* files; the deploy workflow passes
      // values via process.env, so prefer that and fall back to loadEnv.
      // Either source produces the same string; the OR keeps both happy.
      const pick = (k) => process.env[k] || env[k] || ''
      const subs = {
        __FIREBASE_API_KEY__:             pick('VITE_FIREBASE_API_KEY'),
        __FIREBASE_AUTH_DOMAIN__:         pick('VITE_FIREBASE_AUTH_DOMAIN'),
        __FIREBASE_PROJECT_ID__:          pick('VITE_FIREBASE_PROJECT_ID'),
        __FIREBASE_STORAGE_BUCKET__:      pick('VITE_FIREBASE_STORAGE_BUCKET'),
        __FIREBASE_MESSAGING_SENDER_ID__: pick('VITE_FIREBASE_MESSAGING_SENDER_ID'),
        __FIREBASE_APP_ID__:              pick('VITE_FIREBASE_APP_ID'),
      }
      // If the build is missing config (e.g. lint-only CI), warn loudly
      // so a deploy can't ship a SW with empty Firebase config.
      const missing = Object.entries(subs).filter(([, v]) => !v).map(([k]) => k)
      if (missing.length === Object.keys(subs).length) {
        console.warn(`[firebase-messaging-sw] all Firebase env vars missing — SW will be initialised with empty strings. This is fine for lint-only CI but will break push delivery in a real deploy.`)
      } else if (missing.length > 0) {
        console.warn(`[firebase-messaging-sw] missing env vars: ${missing.join(', ')}`)
      }
      for (const [token, value] of Object.entries(subs)) {
        sw = sw.split(token).join(value)
      }
      writeFileSync(swPath, sw)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [
      react(),
      // ── PWA ────────────────────────────────────────────────────────────
      // First half of audit A1 (full PWA + offline). The manifest already
      // ships from public/manifest.webmanifest (#274) so VitePWA is told
      // not to inject its own — `manifest: false`. The plugin's job here is
      // to generate a service worker that pre-caches the app shell and
      // applies sensible runtime caching to fonts + Firebase Storage assets.
      //
      // registerType: 'autoUpdate' — a new SW activates + claims clients
      // automatically once found. This is what makes HTML/meta changes (e.g.
      // theme-color) actually reach returning users instead of sitting behind
      // a stale precached index.html. Only the changed hashed assets download,
      // in the background, and the precache still serves the app offline — so
      // slow connections aren't penalised.
      //
      // The PAGE already rendered with the old chunks doesn't refresh itself,
      // so crossover happens at two safe moments (never a hard reload mid-op):
      //   • public/sw-reload-clients.js posts SW_RELOAD_REQUEST on activation,
      //     which usePwaUpdate turns into <UpdatePrompt />'s "Refresh now" toast;
      //   • <UpdatePrompt /> also auto-applies the update on the user's next
      //     in-app navigation (src/hooks/pwaAutoReload.js) so returning users
      //     cross over without tapping anything. Long-running ops (imports)
      //     don't navigate, so they're never interrupted.
      //
      // NOTE: do NOT switch this back to 'prompt' (it was, briefly, in #778).
      // In prompt mode a new build sits in the SW "waiting" state until the
      // user taps a toast — so returning users freeze on whatever bundle they
      // already have. That is exactly how the live site appeared to "revert":
      // the exam timetable, the removed admin previews, and the compact
      // study-plan card all shipped but never reached users still holding the
      // old precache. autoUpdate is the documented, intended behaviour.
      //
      // Capacitor: src/main.jsx skips registerSW() on native platforms
      // because Capacitor already serves bundled assets locally — a SW
      // there is dead weight and the file:// protocol blocks it anyway.
      VitePWA({
        strategies: 'generateSW',
        registerType: 'autoUpdate',
        manifest: false,            // already shipped at /manifest.webmanifest
        injectRegister: false,      // we register manually from main.jsx
        workbox: {
          // Pre-cache every shipped asset so the app shell works offline
          // after the first successful load. globPatterns are scoped to
          // dist/ at build time, not the public/ directory at runtime.
          globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ttf,png,webmanifest,ico}'],
          // Keep the precache to the shell + core learner experience. Anything
          // here is downloaded on first install for EVERY visitor, so heavy
          // chunks that only a teacher (or a learner opening a past paper) ever
          // reaches are excluded and instead runtime-cached on first use (see
          // the same-origin app-assets rule in runtimeCaching below — that keeps
          // them working offline after the first online load, without taxing the
          // install for everyone).
          //   • pdf.worker* (2.3 MB) + pdfjs-* (~409 kB) — past-paper viewer only
          //   • docx-vendor-* (~430 kB) — teacher Word export only
          //   • pdf-vendor-*  (~400 kB) — jsPDF/html2canvas, teacher PDF export only
          //   • notes/*.png — study-note diagrams, runtime-cached on first view
          //   • studio/vendor/** — vendored html-docx converter, fetched on demand
          globIgnores: [
            '**/pdf.worker*.{js,mjs}',
            '**/pdfjs-*.js',
            '**/docx-vendor-*.js',
            '**/pdf-vendor-*.js',
            '**/notes/*.png',
            '**/studio/vendor/**',
          ],
          // Default is 2 MB. Bump so our largest hashed chunks (vendor,
          // index, react-vendor) all fit under the cache-eligible cap.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // SPA fallback — any navigation that 404s on the network falls
          // back to the cached index.html, which then router-handles the
          // route client-side. Keeps deep links working offline.
          navigateFallback: '/index.html',
          // ...except for Firebase / Cloud Functions / auth domains; we
          // never want the SW to hijack those — Firestore handles its own
          // offline persistence (enabled in src/firebase/config.js) and
          // Cloud Functions calls must always reach the network.
          navigateFallbackDenylist: [
            /^\/__\//,                                 // Firebase reserved
            /^https?:\/\/.*googleapis\.com/,
            /^https?:\/\/.*firebaseio\.com/,
            /^https?:\/\/identitytoolkit\.googleapis\.com/,
            // Static files opened in a new tab (e.g. the bundled exam
            // timetable PDF) are navigation requests — without this the SW
            // would serve index.html and the SPA would 404 the unknown route.
            /^\/timetables\//,
          ],
          runtimeCaching: [
            // Same-origin JS/CSS chunks that are deliberately kept OUT of the
            // precache (the heavy on-demand vendor chunks in globIgnores, plus
            // any lazy route chunk that loads after first paint). Filenames are
            // content-hashed and therefore immutable, so CacheFirst is correct:
            // a given URL never changes, a new build ships new URLs, and stale
            // entries age out. This is what keeps the trimmed precache offline-
            // safe — the first online use of a teacher export or past-paper
            // viewer caches its chunk; every later use works offline.
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && (request.destination === 'script' || request.destination === 'style'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'app-assets',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Google Fonts — short cache for the CSS (font URLs change
            // when Google rolls fonts) and long cache for the woff2 files.
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-css',
                expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-files',
                expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Firebase Storage assets (uploaded teacher images, lesson
            // attachments). Cache-first means a learner who's seen a
            // lesson once can re-open it offline without re-downloading
            // its images.
            {
              urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'firebase-storage',
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Same-origin note diagrams (public/notes/*.png). Excluded from the
            // precache so they don't bloat install for everyone; cached on first
            // view so re-opening a study note works offline.
            {
              urlPattern: /\/notes\/[^/]+\.(?:png|jpe?g|webp|gif)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'note-diagrams',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
          // autoUpdate: take over open clients and activate immediately so
          // the next open lands on the newest cached shell without a prompt.
          clientsClaim: true,
          skipWaiting: true,
          // Imported at the top of the generated SW. Adds an activate-time
          // handler that reloads open tabs when a NEW build takes over, so a
          // device frozen on an old precache crosses over automatically on its
          // next visit — no manual cache clear. Shipped from public/ and
          // served no-cache (see firebase.json) so the import is never stale.
          importScripts: ['/sw-reload-clients.js'],
          // Purge precaches from older SW revisions (incl. the stale
          // index.html that held the old theme-color) on activate.
          cleanupOutdatedCaches: true,
        },
      }),
      firebaseMessagingSwConfig(env),
    ],
    build: {
      outDir: 'dist',
      // The original warning fired on a 1.48 MB catch-all `vendor` chunk —
      // the whole @firebase/* SDK had fallen into it. The manualChunks split
      // below routes the heavy deps into capped, independently-cached chunks
      // (largest now: sentry-vendor ~479 kB lazy, firebase-firestore ~411 kB,
      // pdfjs ~409 kB on-demand). The one chunk still over the limit is
      // `index` — the SPA entry: the app shell plus shared code reachable from
      // the static graph (contexts, nav, banners, shared UI/hooks/utils).
      // Every route in App.jsx is already React.lazy, so this is genuine
      // common code, not un-split routes; it's 842 kB raw but 252 kB gzipped,
      // which is reasonable for an entry chunk. The limit is set to 900 so the
      // warning still fires on a real regression (a heavy dep slipping into a
      // chunk) without nagging about the known shell.
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined

            const normalizedId = id.replace(/\\/g, '/')

            // Loaded lazily, only when learners view a past paper.
            if (normalizedId.includes('pdfjs-dist')) return 'pdfjs'

            // Keep the React chunk limited to the core React runtime packages.
            // Packages like @tiptap/react also include "/react" in their path and
            // must stay out of this bucket or Rollup creates a circular vendor split.
            if (
              normalizedId.includes('/node_modules/react/') ||
              normalizedId.includes('/node_modules/react-dom/') ||
              normalizedId.includes('/node_modules/scheduler/')
            ) {
              return 'react-vendor'
            }
            if (normalizedId.includes('/node_modules/react-router')) return 'router-vendor'

            // Firebase: the public `firebase/*` umbrella only re-exports from
            // the much heavier `@firebase/*` implementation packages, so both
            // prefixes have to be routed here — otherwise the bulk of the SDK
            // (which lives under @firebase/*) falls into the catch-all vendor
            // chunk. Firestore is by far the largest surface, so it gets its
            // own chunk to keep either bundle under the size warning.
            if (
              normalizedId.includes('/node_modules/firebase/firestore') ||
              normalizedId.includes('/node_modules/@firebase/firestore') ||
              normalizedId.includes('/node_modules/@firebase/webchannel-wrapper')
            ) {
              return 'firebase-firestore'
            }
            if (
              normalizedId.includes('/node_modules/firebase/') ||
              normalizedId.includes('/node_modules/@firebase/')
            ) {
              return 'firebase-vendor'
            }

            // Analytics + error reporting are both large, always-loaded, and
            // change on their own release cadence — splitting them keeps the
            // catch-all vendor chunk under the warning limit and lets each be
            // cached independently.
            if (normalizedId.includes('/node_modules/posthog-js/')) return 'posthog-vendor'
            if (
              normalizedId.includes('/node_modules/@sentry/') ||
              normalizedId.includes('/node_modules/@sentry-internal/')
            ) {
              return 'sentry-vendor'
            }

            // i18next family + the markdown parser are mid-sized leaf libs;
            // pulling them out trims the remaining vendor catch-all.
            if (
              normalizedId.includes('/node_modules/i18next') ||
              normalizedId.includes('/node_modules/react-i18next/')
            ) {
              return 'i18n-vendor'
            }
            if (normalizedId.includes('/node_modules/marked/')) return 'markdown-vendor'

            // Icons are used across almost every page but are relatively small;
            // keep them in their own chunk so the main vendor bundle doesn't
            // re-download them when other deps change.
            if (normalizedId.includes('/node_modules/lucide-react/')) return 'icons-vendor'

            // Heroicons ships solid + outline + mini SVG modules — large enough
            // to dominate the vendor chunk if they fall into the catch-all.
            if (normalizedId.includes('/node_modules/@heroicons/')) return 'heroicons-vendor'

            // DOCX export + file-saver are only reached from the teacher export
            // flows (worksheet/lesson-plan/scheme-of-work/rubric/notes/assessment
            // toDocx utilities), all behind lazy teacher routes. Keep them in
            // their own chunk so a learner never pays for the docx assembler.
            if (normalizedId.includes('/node_modules/docx/')) return 'docx-vendor'
            if (normalizedId.includes('/node_modules/file-saver/')) return 'docx-vendor'

            // jsPDF + html2canvas power the real one-click PDF export
            // (src/utils/htmlToPdf.js). They're only reached via dynamic
            // import() the first time a teacher downloads a PDF, so keep them
            // in their own lazy chunk — without this rule the catch-all vendor
            // bucket would pull ~400 kB into the eager initial load.
            if (
              normalizedId.includes('/node_modules/jspdf/') ||
              normalizedId.includes('/node_modules/html2canvas/') ||
              normalizedId.includes('/node_modules/css-line-break/') ||
              normalizedId.includes('/node_modules/text-segmentation/')
            ) {
              return 'pdf-vendor'
            }

            // Capacitor's native shell only matters inside the Android wrapper
            // but ships to the web too via initNativeShell(). Splitting it keeps
            // the web vendor bundle from carrying ~100 kB of unused plugin glue.
            if (normalizedId.includes('/node_modules/@capacitor/')) return 'capacitor-vendor'

            // DOMPurify + fflate are only used inside the authoring flows.
            if (normalizedId.includes('/node_modules/dompurify/')) return 'sanitize-vendor'
            if (normalizedId.includes('/node_modules/fflate/')) return 'fflate-vendor'

            // Let Vite auto-split @tiptap, katex, and prosemirror — they are
            // already reached via dynamic imports from the editor routes.
            if (
              normalizedId.includes('/node_modules/@tiptap/') ||
              normalizedId.includes('/node_modules/katex/') ||
              normalizedId.includes('/node_modules/prosemirror')
            ) {
              return undefined
            }

            return 'vendor'
          },
        },
      },
    },
  }
})
