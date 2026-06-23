/**
 * Shared PDF.js loader.
 *
 * PDF.js parses a document inside a *worker*. The default path is an
 * off-main-thread module Worker created from `GlobalWorkerOptions.workerSrc`
 * (internally `new Worker(url, { type: 'module' })`). On the older Android
 * System WebViews much of our audience runs (low-end Tecno / Itel phones)
 * that module Worker can't start, so PDF.js falls back to its "fake worker",
 * which tries to `import()` the worker URL a second time and dies with:
 *
 *     Setting up fake worker failed: "Unexpected token '{'".
 *
 * That left the in-app PDF surfaces — the 2026 exam timetable
 * (PdfScrollViewer), the past-paper viewer (PdfJsViewer), and the
 * document-quiz importer — broken on exactly the devices we care about
 * most. (The timetable viewer exists *because* those WebViews can't open a
 * `target="_blank"` PDF link, so "open in a new tab" isn't a real fallback
 * there.)
 *
 * The fix: register the worker's message handler on `globalThis.pdfjsWorker`.
 * PDF.js checks `globalThis.pdfjsWorker?.WorkerMessageHandler` *before* it
 * tries to spawn a real Worker and, when present, runs the worker logic on
 * the main thread using THAT already-bundled module — so `new Worker(...)`
 * is never called and the worker URL is never re-`import()`-ed. That removes
 * the entire class of worker-startup failures: module-worker support,
 * the cross-origin CDN-wrapper blob, service-worker interception of the
 * worker request, and stale hashed-asset URLs after a deploy.
 *
 * Trade-off: parsing now runs on the main thread. Page *rendering* already
 * does (canvas), our PDFs are small (the timetable is 3 pages and the
 * viewers parse pages lazily), and this codebase deliberately favours
 * reliability on low-end devices over throughput — so giving up off-thread
 * parsing is the right call.
 *
 * Everything is dynamically imported, so a learner who never opens a PDF
 * doesn't pay the parse cost — it all lands in the lazy `pdfjs` chunk.
 */

let pdfjsLoader = null

/**
 * Lazily load PDF.js with the main-thread worker handler registered.
 * Returns the resolved `pdfjs-dist` module (use `.getDocument`).
 */
export function loadPdfjs() {
  if (!pdfjsLoader) {
    pdfjsLoader = (async () => {
      const [pdfjs, workerModule] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
      ])
      // Make PDF.js run the worker on the main thread from this bundled
      // module instead of spawning a module Worker or re-importing the
      // worker URL — see the file header for why that path fails on old
      // WebViews. With the handler registered here, `workerSrc` is never
      // read, so we don't ship the worker as a second `?url` asset.
      if (typeof globalThis !== 'undefined' && !globalThis.pdfjsWorker) {
        globalThis.pdfjsWorker = workerModule
      }
      return pdfjs
    })()
  }
  return pdfjsLoader
}

export default loadPdfjs
