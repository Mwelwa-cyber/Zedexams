# The shared assessment package

> Snapshot as of 2026-07-27 — verify before acting.

Rules that decide whether a paper may leave the building, in one place, imported
unchanged by **both** the React app and the Cloud Functions export callable.

```
React application ─┐
                   ├── functions/shared/assessment
Cloud Functions ───┘
```

## Why it lives under `functions/` and not at the repo root

`firebase.json` sets the functions `source` to `functions`, and the Firebase CLI
uploads **only that directory**. A package at the repo root would exist on a
developer's machine and be absent at runtime — the deploy would either fail at
cold start or, with a sync step papering over it, ship a copy that can go stale.
A stale copy is the worst outcome available here: the server would enforce
yesterday's rules while the studio enforced today's, silently, and the whole
point of this package is that those two can never disagree.

Parenting it under `functions/` makes it one directory, checked in once,
uploaded automatically, with no build step and nothing to keep in sync. `src/`
reaches it by relative path through the two re-export shims
(`src/utils/unresolvedFigures.js`, `src/utils/assessmentExportGate.js`), which
exist so the boundary is visible where it is crossed.

## The contract

These modules **must not import**: React, DOM APIs (`document`, `window`,
`canvas`), Firebase client or admin SDKs, `docx`, KaTeX, any browser exporter,
or anything from `src/`. `test:shared-assessment-neutral` fails the build if
they do. They are plain ESM (`functions/shared/package.json` declares
`"type": "module"`, which is what makes `.js` here ESM inside an otherwise
CommonJS `functions/` package) and run under plain `node`, in Vite, in Vitest
and in the Cloud Functions runtime without a transform.

Cloud Functions is CommonJS, so it reaches them with `await import(...)` from
inside the async handler — never a top-level `require`.

## What is in here

| File | Owns |
|---|---|
| `unresolvedFiguresCore.js` | what an unresolved figure is, the sentence a teacher reads, and the static catalogue check |
| `questionNumberingCore.js` | the number printed beside a question — because every blocking message names questions by it |
| `exportReadinessCore.js` | the blocking classification and its wording (`describeExportBlock`) |

## What is deliberately NOT in here

`collectQuizIssues` — the definition of "this question is unfinished" — still
lives in `src/utils/quizValidation.js`, because its dependency closure is ~2,000
lines of editor machinery (rich-text, comprehension grouping, the TipTap schema)
that the server has no business loading. The server therefore reaches the same
verdict from the stored question shape via `assessmentValidationCore.js`, and
`test:shared-assessment-parity` asserts the two agree on every fixture. That
test is the reason the split is safe; delete it and the split becomes a fork.
