import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest config — the frontend (jsdom) test runner.
 *
 * This is deliberately SEPARATE from the historical `node script.test.js`
 * suite. The repo has ~125 plain-`node` assertion scripts named `*.test.js`
 * / `test-*.mjs` (run via the `test:*` npm scripts and `test:all`). Those
 * stay exactly as they are. Vitest only ever picks up files named
 * `*.spec.{js,jsx}` (see `include` below), so the two worlds never collide:
 *
 *   • `*.test.js`  → existing node scripts, run by `npm run test:all`
 *   • `*.spec.jsx` → component/hook/behaviour tests, run by `npm run test:unit`
 *
 * Why add this at all: 560 files in src/ had zero rendered/behavioural
 * coverage and there was no way to MEASURE the gap. Vitest + v8 coverage
 * gives `npm run test:coverage`, which is the point — surface where the
 * frontend is untested so it can be backfilled deliberately.
 */
export default defineConfig({
  // Use the React plugin only — intentionally NOT the full vite.config.js,
  // whose VitePWA + manualChunks build plumbing has no place in unit tests.
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // Only `.spec.` files are Vitest tests. This is what keeps the existing
    // `.test.js` node scripts out of the runner.
    include: ['src/**/*.spec.{js,jsx}'],
    exclude: ['node_modules/**', 'dist/**', 'android/**', 'functions/**'],
    coverage: {
      provider: 'v8',
      // text-summary for the CLI, html for drilling in, json-summary so a
      // future CI gate can read totals without re-running.
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      // Coverage is scoped to the FRONTEND only. functions/ has its own
      // node-script suite (counting it here would falsely report 0%).
      // `all: true` instruments every src file — including untested ones —
      // so the report shows the real gap, not just what the seed tests hit.
      all: true,
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.spec.{js,jsx}',
        'src/**/*.test.{js,jsx}',
        'src/test/**',
        'src/main.jsx',
        'src/**/*.d.ts',
      ],
      // Ratchet gate. Thresholds sit just beneath the current measured
      // totals (run `npm run test:coverage` to see them) so coverage can
      // only ever go UP: any change that drops below these fails CI. When
      // you add tests and the totals rise, bump these numbers to lock the
      // gain in. Numbers are low because `all: true` instruments every src
      // file, including the hundreds still untested — that's the gap this
      // exists to close, one ratchet at a time.
      thresholds: {
        lines: 3.15,
        statements: 3.15,
        functions: 18,
        branches: 50,
      },
    },
  },
})
