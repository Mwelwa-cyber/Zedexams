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
      'dist/**',
      'dist_test*/**',
      'Zedexams/**',            // legacy fork, will be deleted
      'node_modules/**',
      'functions/node_modules/**',
      'functions/lib/**',
      '.firebase/**',
      '.playwright/**',
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
]
