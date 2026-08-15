// ESLint flat-config.
//
// Philosophy: catch bugs, not stylistic preferences. Every rule here is
// either (a) caught a real bug we shipped, or (b) catches an entire class
// of bugs with zero false-positive churn.
//
// If a rule becomes noisy, prefer downgrading to 'warn' over disabling —
// warnings stay visible in the editor and can be tightened later.

import js from '@eslint/js'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import promisePlugin from 'eslint-plugin-promise'
import globals from 'globals'

export default [
  // Paths to ignore entirely.
  {
    ignores: [
      '.claude/**',
      '.tmp-*/**',
      'dist/**',
      'dist_test*/**',
      'Zedexams/**',            // legacy fork, will be deleted
      'android/app/build/**',
      'android/app/src/main/assets/**',
      'android/build/**',
      'node_modules/**',
      'functions/node_modules/**',
      'functions/lib/**',
      '.firebase/**',
      '.playwright/**',
      // Generated coverage reports. Both are gitignored, but a local
      // `npm run test:coverage` / `functions:coverage` leaves the HTML
      // reporter's own bundled scripts on disk, and linting those reports
      // warnings about a third party's code on an otherwise clean tree.
      'coverage/**',
      'coverage-functions/**',
      'coverage-src/**',
      'public/**',
      'postman/**',
      'qa-samples/**',
      'tmp/**',
      'output/**',
      'vite.config.js.timestamp-*.mjs',
    ],
  },

  // Base config for application source files.
  {
    files: ['src/**/*.{js,jsx}', 'vite.config.js', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      promise: promisePlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // ---- ESLint core recommended ----
      ...js.configs.recommended.rules,

      // ---- React ----
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',   // Vite + modern JSX transform
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',            // no PropTypes in this codebase
      'react/display-name': 'off',          // noisy false positives
      'react/no-unescaped-entities': 'off', // apostrophes in copy are fine

      // ---- React hooks ----
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ---- Promise / async correctness (this catches missing-await bugs) ----
      'promise/catch-or-return': ['warn', { allowFinally: true, terminationMethod: ['catch', 'finally'] }],
      'promise/no-nesting': 'warn',

      // ---- Rules that would have caught bugs we shipped ----
      // Caught-error bindings are exempted (`caughtErrors: 'none'`) — too
      // many `catch (err)` blocks intentionally discard the error (audio
      // playback failures, sessionStorage quota, third-party SDK noise)
      // and forcing `_err` everywhere is churn without bug payoff.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
      'no-undef': 'error',
      // Allow `catch {}` and `catch (err) {}` empty bodies. Several call
      // sites in this codebase deliberately swallow non-critical errors
      // (e.g. `audio.play().catch(() => {})` for browsers that block
      // autoplay). Re-tightening this is a future cleanup pass.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-self-compare': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'require-atomic-updates': 'warn',
      'no-await-in-loop': 'off',  // common + intentional in this codebase (batch uploads)
      'no-debugger': 'error',
      'no-console': 'off',         // we rely on console.error/warn

      // ---- Style-ish but catch real bugs ----
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
      // Pure stylistic — over-escaped regex chars don't cause bugs but the
      // signal is useful for cleanup, so it stays as a warning rather than
      // blocking deploys.
      'no-useless-escape': 'warn',
    },
  },

  // ---- Import boundaries (docs/architecture.md §3, §12, §14.7) ----
  //
  // The target architecture layers src/ top-down:
  //
  //   app  →  features  →  engines / curriculum  →  shared / services / config
  //
  // An arrow may only be followed downwards. `src/shared/` importing a feature,
  // or an engine importing `src/app/`, is the cycle that turns a layer into a
  // synonym for "everything", and it is cheap to prevent and expensive to undo.
  // Cross-feature imports go through a feature's public `index.js` so one
  // feature never reaches into another's internals.
  //
  // These use core `no-restricted-imports` — no new lint plugin — which checks
  // static import/export declarations by SPECIFIER, not by resolved path. Three
  // consequences, all of them gaps, all covered by
  // `npm run test:import-boundaries` (which resolves every import in src/ to a
  // real path, and lints synthetic violations through this very file so a
  // pattern that stops matching fails a test instead of reading as a clean
  // codebase):
  //
  //   • Sibling features are invisible. Every layer rule below is total,
  //     because the layers are sibling directories under src/ and the path has
  //     to name them — but `src/features/A/` reaching `src/features/B/` is
  //     written `../../B/lib/x`, which names no layer at all and is
  //     indistinguishable, as a string, from its own `../lib/x`.
  //   • Dynamic `import()` is not checked at all, by any of these rules. A
  //     lazily-loaded module crosses any boundary it likes in silence.
  //   • Warnings do not fail `eslint .`, so the legacy debt below could double
  //     without a red build. The test ratchets it.
  //
  // One imprecision to know about: the patterns match a path SEGMENT, so
  // `**/curriculum/**` matches any directory named `curriculum`, wherever it
  // sits. (`src/components/teacher/curriculum/` used to be the live example;
  // it migrated into src/shared/ on 2026-08-15 — flat, deliberately not as a
  // `curriculum/` subdirectory, because of exactly this.) Nothing hits it
  // today, and such an import would be refused on its own merits anyway — but
  // the message it prints would name the wrong reason.
  //
  // Rules are ordered general → specific: flat config replaces (not merges) a
  // rule's options when a later block names the same rule, so each specific
  // block below restates everything that applies to it.
  {
    files: ['src/**/*.{js,jsx}'],
    rules: {
      // Legacy tree (src/components, src/hooks, src/utils, ...) reaching into a
      // feature's internals. `warn`, not `error`, because 11 such imports exist
      // today and predate the boundary — they are Phase 4 debt, and each one
      // clears when its caller migrates. It flips to `error` once the last is
      // gone. A twelfth is not merely discouraged: it fails
      // `npm run test:import-boundaries`, which holds the eleven as a
      // shrink-only list precisely because a warning cannot fail a build.
      'no-restricted-imports': ['warn', {
        patterns: [{
          group: ['**/features/*/**', '!**/features/*/index', '!**/features/*/index.js', '!**/features/*/index.jsx'],
          message:
            'Import a feature through its public index.js (docs/architecture.md §14.7). ' +
            'Reaching past it couples you to internals the feature is free to change.',
        }],
      }],
    },
  },
  {
    // The app shell may use every layer below it, but still only through a
    // feature's front door.
    files: ['src/app/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/features/*/**', '!**/features/*/index', '!**/features/*/index.js', '!**/features/*/index.jsx'],
          message: 'Import a feature through its public index.js (docs/architecture.md §14.7).',
        }],
      }],
    },
  },
  {
    files: ['src/features/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/features/*/**', '!**/features/*/index', '!**/features/*/index.js', '!**/features/*/index.jsx'],
            message: 'Import another feature through its public index.js (docs/architecture.md §14.7).',
          },
          {
            group: ['**/app/**'],
            message: 'A feature must not import the app shell — routes, providers and guards mount features, not the reverse.',
          },
        ],
      }],
    },
  },
  {
    files: ['src/engines/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/app/**', '**/features/**'],
            message: 'An engine is consumed BY features (docs/architecture.md §2). Importing one inverts that and makes the engine unusable elsewhere.',
          },
          {
            group: ['firebase', '**/firebase/**'],
            message: 'Engines reach Firebase through src/services/ (docs/architecture.md §14.2), which is what keeps an engine testable without the SDK.',
          },
        ],
      }],
    },
  },
  {
    files: ['src/curriculum/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/app/**', '**/features/**', '**/engines/**'],
            message: 'The Curriculum Engine is upstream of every consumer (docs/architecture.md §5). It may read src/config/ and src/shared/, nothing above.',
          },
          {
            group: ['firebase', '**/firebase/**'],
            message: 'Curriculum resolution reaches Firebase through src/services/ (docs/architecture.md §14.2).',
          },
        ],
      }],
    },
  },
  {
    files: ['src/shared/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/app/**', '**/features/**', '**/engines/**', '**/curriculum/**'],
            message: 'src/shared is the bottom layer (docs/architecture.md §12). Anything that needs a feature, an engine or curriculum knowledge belongs to that layer, not to shared.',
          },
          {
            group: ['firebase', '**/firebase/**'],
            message: 'Shared code must not touch the Firebase SDK (docs/architecture.md §14.2) — that is what makes it shareable.',
          },
        ],
      }],
    },
  },
  {
    // src/services/ and src/config/ are the other two bottom layers — the arrow
    // ends at them. They may not reach back up, and config additionally refuses
    // services: config is data, and data that reaches a Firebase-backed service
    // inverts the direction the whole taxonomy depends on. Both directories
    // predate the scaffold and neither violates this today.
    files: ['src/services/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/app/**', '**/features/**', '**/engines/**', '**/curriculum/**'],
          message: 'Services sit at the bottom of the layering (docs/architecture.md §12) — a feature or engine calls a service, never the reverse.',
        }],
      }],
    },
  },
  {
    files: ['src/config/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/app/**', '**/features/**', '**/engines/**', '**/curriculum/**', '**/services/**'],
          message: 'src/config is data at the bottom of the layering (docs/architecture.md §12). canonicalEducation.js is the taxonomy root — everything reads it, it reads nothing above.',
        }],
      }],
    },
  },

  // Tests and Cloud Functions: allow Node globals, relax a bit.
  {
    files: ['**/*.test.js', '**/*.test.jsx', 'functions/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },

  // Vitest specs (`*.spec.{js,jsx}`, jsdom). Separate from the `*.test.js`
  // node scripts above — these run under `npm run test:unit`. Register the
  // injected test globals (vitest.config.js sets `globals: true`) so specs
  // don't have to import describe/it/expect/vi by hand, and relax
  // no-unused-vars as for the other test files.
  {
    files: ['**/*.spec.js', '**/*.spec.jsx'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
]
