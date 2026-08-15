import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { NAVIGATE_FALLBACK_DENYLIST } from './scripts/lib/swNavigateFallback.mjs'

import { buildReleaseName } from './src/utils/releaseName.js'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * The app version stamped into the bundle.
 *
 * Read from package.json rather than the `VITE_APP_VERSION` secret, because a
 * version that lives only in CI settings has no reviewer and goes stale
 * silently — this one sat at 1.1.0 through every deploy while the repo's tags
 * moved to v1.2.7, so every production build shipped under the same Sentry
 * release id. In the repo it moves through a PR like anything else.
 *
 * Assigned into process.env so Vite picks it up as `import.meta.env.
 * VITE_APP_VERSION` through its normal env plumbing, which means the runtime
 * needs no new variable and the CI secret can simply be deleted. Set
 * unconditionally: an unset secret and a stale one are the same failure, and
 * letting either win is what caused this.
 */
process.env.VITE_APP_VERSION = pkg.version

/**
 * The Sentry release string for the uploaded source maps. Shares
 * buildReleaseName() with the runtime (src/utils/sentry.js) so the two cannot
 * drift — if they ever did, maps would stop binding to events and every
 * production stack trace would go silently minified.
 */
function sentryRelease(mode, env) {
  return buildReleaseName({
    version: pkg.version,
    sha: process.env.VITE_BUILD_SHA || env.VITE_BUILD_SHA,
    mode,
  })
}

/**
 * Production source-map upload for Sentry — so a frame like
 * `LessonPlanStudio-DuIX0BPH.js:142:5420` resolves back to the original JSX
 * file + line instead of a minified column.
 *
 * Gated on SENTRY_AUTH_TOKEN (a build-time secret, NOT a VITE_ var — it must
 * never reach the browser bundle). With no token the plugin is skipped
 * entirely and the build is unchanged, so local + lint-only CI builds don't
 * need it. The plugin (`@sentry/vite-plugin`) is imported dynamically for the
 * same reason the runtime SDK is: a build without the secret pays nothing, and
 * a missing dev-dependency can't break the core build.
 *
 * Maps are emitted `hidden` (no sourceMappingURL comment in the shipped JS) and
 * deleted from dist/ after upload, so the .map files are never publicly served
 * — Sentry has them, the origin does not.
 */
async function maybeSentryPlugin(mode, env) {
  const authToken = process.env.SENTRY_AUTH_TOKEN
  const org = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  if (!authToken || !org || !project) return []
  try {
    const { sentryVitePlugin } = await import('@sentry/vite-plugin')
    return [
      sentryVitePlugin({
        org,
        project,
        authToken,
        release: { name: sentryRelease(mode, env) },
        sourcemaps: {
          // Upload every emitted chunk map, then remove the .map files from the
          // build output so they aren't shipped to the CDN.
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
        // Don't fail a production deploy just because the symbol upload hiccuped;
        // the app is already built. A telemetry gap is preferable to a blocked ship.
        errorHandler: (err) => {
          console.warn('[sentry] source-map upload failed (build continues):', err?.message || err)
        },
      }),
    ]
  } catch (err) {
    console.warn('[sentry] vite plugin unavailable — skipping source-map upload:', err?.message || err)
    return []
  }
}

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

/**
 * Per-chunk size budgets. Vite's chunkSizeWarningLimit is one global
 * threshold, but the chunk profile here has a deliberate outlier: `pdfjs`
 * bundles the legacy PDF.js core AND its worker module into one lazy chunk
 * (~1.74 MB minified) so old Android WebViews never have to spawn a module
 * Worker — see src/utils/pdfjsLoader.js for why that's load-bearing. One
 * global limit must therefore either nag on every build (limit below pdfjs)
 * or go blind to regressions in every other chunk (limit above it). Instead:
 * pdfjs gets its own cap with modest headroom, everything else keeps the
 * tight one. A warning from this plugin is a real signal — a heavy dep fell
 * into the wrong chunk (check rollupOptions.output.manualChunks below) or a
 * dependency upgrade ballooned a chunk.
 */
/**
 * Backstop: after everything has been written (and Sentry has uploaded), delete
 * every leftover *.map from dist/ so no source map is served from the origin.
 * The Sentry plugin already prunes the app-chunk maps it uploads, but VitePWA's
 * generated service-worker maps (sw.js.map / workbox-*.js.map) are written later
 * and slip past it — this closeBundle pass, ordered LAST, sweeps whatever
 * remains. Only active when we actually emitted maps for an upload.
 */
function pruneSourceMaps({ enabled }) {
  return {
    name: 'prune-source-maps',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      if (!enabled) return
      const distDir = resolve(__dirname, 'dist')
      let removed = 0
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = resolve(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (entry.name.endsWith('.map')) { rmSync(full, { force: true }); removed += 1 }
        }
      }
      try { walk(distDir) } catch { /* dist absent (lib build) — nothing to prune */ }
      if (removed) console.info(`[prune-source-maps] removed ${removed} .map file(s) from dist/`)
    },
  }
}

function chunkSizeBudgets({ defaultBudget, budgets }) {
  return {
    name: 'chunk-size-budgets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        // Minified size (esbuild minify runs in renderChunk, before this
        // hook), pre-gzip — the same number Vite prints in its size report.
        const size = Buffer.byteLength(output.code, 'utf8')
        const budget = budgets[output.name] ?? defaultBudget
        if (size > budget) {
          this.warn(
            `${fileName} is ${Math.round(size / 1000)} kB — over the ${Math.round(budget / 1000)} kB budget for '${output.name}'.`
          )
        }
      }
    },
  }
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Source-map upload to Sentry (empty unless SENTRY_AUTH_TOKEN + org/project
  // are set). Must be the LAST plugin so it runs after the bundle is written.
  const sentryPlugins = await maybeSentryPlugin(mode, env)
  // Emit maps only when we're actually uploading them; 'hidden' keeps the
  // sourceMappingURL comment out of the shipped JS so browsers never fetch them.
  const uploadingSourceMaps = sentryPlugins.length > 0
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
          //   • pdfjs-* (~1.74 MB — legacy PDF.js core + its worker in one
          //     lazy chunk, see src/utils/pdfjsLoader.js) — PDF viewers only.
          //     No separate pdf.worker asset ships anymore; its pattern stays
          //     as a guard in case a workerSrc path ever comes back.
          //   • docx-vendor-* (~369 kB) — teacher Word export only
          //   • pdf-vendor-*  (~540 kB) — jsPDF/html2canvas, teacher PDF export only
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
          // ...except for Firebase's reserved namespace and anything that is
          // a FILE rather than a route. A browser navigation to /sitemap.xml,
          // /robots.txt or a bundled PDF is a `navigate` request, so without
          // this the SW answers it with index.html and the SPA renders its
          // 404 for a file that exists in dist/ and that Hosting serves fine.
          // Rules + rationale live in scripts/lib/swNavigateFallback.mjs so
          // they can be unit-tested (npm run test:sw-navigate-fallback).
          //
          // NOTE: these are matched against `url.pathname + url.search`, so
          // origin-shaped patterns (https://*.googleapis.com/…) can never
          // fire — don't add one back expecting it to do anything. Firestore
          // and Cloud Functions traffic is not navigation traffic and was
          // never reaching this route in the first place.
          navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST,
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
      chunkSizeBudgets({
        // Everything except pdfjs must stay under the classic 900 kB bar.
        // Current profile (minified, 2026-07): pdfjs 1734 kB, buildExtensions
        // 727 kB, pdf-vendor 540 kB, vendor 441 kB, docx-vendor 369 kB,
        // firebase-firestore 328 kB, index (the SPA entry) 204 kB.
        defaultBudget: 900_000,
        // pdfjs = legacy PDF.js core + its worker, deliberately one lazy
        // chunk (src/utils/pdfjsLoader.js). Headroom is modest on purpose so
        // a pdfjs-dist upgrade that grows it still trips the warning.
        budgets: { pdfjs: 1_800_000 },
      }),
      // Keep Sentry last: it reads the finished bundle to upload + prune maps.
      ...sentryPlugins,
      // Backstop after Sentry: strip any *.map the upload didn't remove (the
      // late-written service-worker maps) so nothing ships to the origin.
      pruneSourceMaps({ enabled: uploadingSourceMaps }),
    ],
    build: {
      outDir: 'dist',
      // 'hidden' source maps ONLY when uploading to Sentry — emitted for the
      // symbol upload, stripped of their sourceMappingURL comment so the shipped
      // JS doesn't reference them, then deleted from dist/ by the Sentry plugin.
      // Off otherwise, so a normal build ships no maps (unchanged behaviour).
      sourcemap: uploadingSourceMaps ? 'hidden' : false,
      // Chunk-size policing lives in the chunkSizeBudgets plugin above: the
      // known ~1.74 MB pdfjs chunk (legacy core + bundled worker, lazy,
      // precache-excluded) gets its own cap, every other chunk keeps the
      // tight 900 kB one. Vite's single global threshold can't express that,
      // so it's parked just above pdfjs as a backstop — a healthy build emits
      // no size warnings at all, and any warning that does appear (from
      // either mechanism) is a real regression, not known-outlier noise.
      chunkSizeWarningLimit: 1800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined

            const normalizedId = id.replace(/\\/g, '/')

            // @babel/runtime's helpers (`_typeof`, `_createClass`, …) are ~2 kB
            // shared by several babel-compiled deps. Left in the catch-all they
            // were emitted INTO `pdf-vendor`, and the always-loaded `vendor`
            // chunk then carried a real top-level
            // `import{r as l}from"./pdf-vendor-*.js"` to reach one of them — so
            // every visitor statically downloaded the ~578 kB jsPDF/html2canvas
            // bundle that the rule below exists to keep lazy, for a helper
            // smaller than this comment. Giving the helpers their own 2 kB
            // chunk removes the edge; measured before/after with
            // `npm run check:bundle-edges`, which now names `pdf-vendor` as a
            // heavy vendor precisely so this cannot come back unnoticed.
            if (normalizedId.includes('/node_modules/@babel/')) return 'babel-runtime'

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
