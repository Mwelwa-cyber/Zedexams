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
      // registerType: 'autoUpdate' — a new SW activates and reloads the
      // app automatically on the next open, no user prompt. This is what
      // makes HTML/meta changes (e.g. theme-color) actually reach returning
      // users instead of sitting behind a stale precached index.html. Only
      // the changed hashed assets download, in the background, and the
      // precache still serves the app offline — so slow connections aren't
      // penalised. onNeedRefresh never fires in this mode, so <UpdatePrompt />
      // simply never renders (left in place; harmless).
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
          // Don't cache the PDF.js worker (2.3 MB) by default — it's only
          // ever loaded when a learner opens a past paper, and pre-caching
          // it would balloon the install size for everyone else.
          globIgnores: ['**/pdf.worker*.{js,mjs}'],
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
          ],
          runtimeCaching: [
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
          ],
          // autoUpdate: take over open clients and activate immediately so
          // a deploy reaches users on next open without a manual tap.
          clientsClaim: true,
          skipWaiting: true,
          // Purge precaches from older SW revisions (incl. the stale
          // index.html that held the old theme-color) on activate.
          cleanupOutdatedCaches: true,
        },
      }),
      firebaseMessagingSwConfig(env),
    ],
    build: {
      outDir: 'dist',
      // The previous 500 kB warning was firing on the catch-all vendor chunk;
      // with the split below the largest shipped chunk is ~300 kB gzipped (pdf
      // worker is excluded — it's loaded on demand by past-paper viewing only).
      chunkSizeWarningLimit: 600,
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
            if (normalizedId.includes('/node_modules/firebase/')) return 'firebase-vendor'

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
