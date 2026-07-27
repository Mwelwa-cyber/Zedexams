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

## This is the only place assessment-readiness rules may be added

If a change decides whether a paper may be downloaded, printed or exported — a
new completeness check, a new blocking classification, a change to the words a
teacher reads, a new figure requirement — **it goes in this directory**. Not in
`src/utils/`, not in `functions/assessmentExports/`, not in a component.

The files in `src/` that carry these names are re-export shims and nothing else.
`test:shim-guard` fails if one of them grows a function body, a branch or a
constant with a rule in it, because that is the quiet way the fork comes back:
someone opens the file the studio imports, adds a condition there because that
is where the bug appeared, and the server never sees it.

There is **one** diagram catalogue, and it is here. Do not add a second one for
the server.

## The contract

These modules **must not import**: React, DOM APIs (`document`, `window`,
`canvas`, `DOMParser`), Firebase client or admin SDKs, `docx`, KaTeX, any
browser exporter, or anything from `src/`. `test:shared-assessment-neutral`
fails the build if they do. They are plain ESM (`functions/shared/package.json`
declares `"type": "module"`, which is what makes `.js` here ESM inside an
otherwise CommonJS `functions/` package) and run under plain `node`, in Vite, in
Vitest and in the Cloud Functions runtime without a transform.

Cloud Functions is CommonJS, so it reaches them with `await import(...)` from
inside the async handler — never a top-level `require`.

## What is in here

| File | Owns |
|---|---|
| `assessmentValidationCore.js` | whether a question is finished, and whether the paper's details are set |
| `exportReadinessCore.js` | the blocking classification and its wording (`describeExportBlock`) |
| `unresolvedFiguresCore.js` | what an unresolved figure is, the sentence a teacher reads, and the static catalogue check |
| `richTextContentCore.js` | whether a rich-text value carries anything a learner would see |
| `questionNumberingCore.js` | the number printed beside a question — because every blocking message names questions by it |
| `questionTypeCore.js` | canonical question types and their labels |
| `fillBlanksCore.js` | blank counting and the fill-in-the-blanks answer key |
| `comprehensionGroupingCore.js` | mis-grouped comprehension runs |
| `diagramCatalogCore.js` | every catalogue shape, as SVG |

## Identity comes from the adapter, never from the question

`assessmentValidationCore` does not look for `localId`. It is handed
`{ question, identity, number }` and keys its issues on `identity`, because the
two callers know different things:

- **live studio** — `localId`, minted by the editor and never persisted
- **saved paper** — the Firestore document id, or failing that its printed position

`number` is always the display-order number, so a stored question with no
`localId` still produces *"Question 3 is not finished"* rather than an unnamed
blocker. A core that reached for `localId` itself would produce
`question-text-undefined` for every saved question and a blocked paper whose
message names nothing — the failure that looks most like success.

## What is deliberately NOT in here

Editor-only concerns stay in `src/utils/quizValidation.js`: the checklist
summary the pre-publish modal renders, the "image still uploading" flags (live
state a saved paper cannot have), and Part membership (Parts are an authoring
construct). `collectQuizIssues` calls into this package for everything that
blocks an export.
