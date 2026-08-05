# The learner-screen visual gate

> Snapshot as of 2026-08-05 — verify before acting.

A third render family alongside `browser-print` and `docx`. Those protect
printed papers; this protects what a learner sees on a phone, which is the
first engine code they will meet and is measured by nothing today.

**Status: the fixtures, their self-validation and the baseline identity have
landed. The Chromium stage and the CI workflows have not.** The gate therefore
reports nothing yet — it is not wired to a workflow, and it must be green
before a cutover shows engine renderers to a learner.

This is the same order the write differ shipped in: the rules first, reviewed,
before anything depends on them passing.

## The finding that decided the design

The obvious implementation is `renderToStaticMarkup` — no browser, no bundler,
fast. It is **structurally incapable of measuring the thing this gate exists
for**, and that was measured rather than assumed:

```
renderToStaticMarkup(<RichContent value={a 3/4 fraction doc} />)
  → '<span class="rich-content">Simplify /</span>'
```

`RichContent` renders rich content from a `useEffect` and hydrates KaTeX in a
`setTimeout`. Under SSR no effect runs, so the fraction collapses to **a bare
slash** — the exact "slash form" §4.1 forbids. An SSR gate would have recorded
visibly wrong output as the reference and stayed green about it forever.

So the stage renders **client-side in a real Chromium**.

## The pipeline, verified end to end

Each step was run while designing this; the numbers are from that run.

1. **CSS** — `npx tailwindcss -i src/index.css -o <out>`. Tailwind's `content`
   glob is `./src/**/*.{js,jsx}`, which already covers the engine's renderers,
   so every utility class they use is emitted. ~366 KB, ~13 s.
2. **Bundle** — `esbuild <entry>.jsx --bundle --jsx=automatic --format=iife`
   with `--loader:.woff2=dataurl --loader:.woff=dataurl --loader:.ttf=dataurl`.
   The font loaders are not a workaround: they inline KaTeX's fonts as data
   URIs, so the page is offline by construction and a screenshot cannot depend
   on a font request succeeding. ~2.3 MB, ~200 ms.
   The entry must live **inside the repo** so `react` resolves.
3. **Render** — `page.setContent(html)`, `document.fonts.ready`, settle, then
   `page.screenshot()` at each declared viewport. Reuse `resolveRenderChromium`
   and `CHROMIUM_FLAGS`.

What that produced, on the fraction fixture at 390px:

```
.math-frac > .math-frac-stack > (.math-frac-num "3", .math-frac-den "4")
opt-grid   gridTemplateColumns: one column
letters    A B C D
slash anywhere on the page: none
```

Stacked, single-column, lettered. That is the §4 and §4.1 contract, drawn.

## What is left

- `screenStage.mjs` — build CSS + bundle, launch Chromium, screenshot each
  fixture × viewport, returning PNGs with the captured environment.
- A runner alongside `runVisualGate.mjs`, reusing `comparePages`,
  `assertComparableEnvironment` and the summary format.
- CI: the render job, plus `screen` in the bootstrap and update workflows. Both
  stay `workflow_dispatch`-only and open a draft PR, and
  `assertComparableEnvironment` still rejects a locally recorded baseline — so
  **baselines are recorded by CI or not at all**, exactly as for papers.
- Scope: the `Visual regression gate` check is required and must report on
  every PR, so the screen render is gated by its own classification inside the
  workflow rather than by a `paths:` filter. A filtered required check is
  *missing*, not passed, and wedges every unrelated PR.

## Rules carried over from the paper gate

- **Never record a baseline locally.** `baselineIdentity` keys each one to the
  renderer version and font digest; `assertComparableEnvironment` rejects one
  recorded anywhere else, so a hand-committed baseline is dead weight CI will
  never match.
- **A missing browser is an infrastructure refusal**, never a blank baseline.
  `assertToolchain(['screen'], …)` throws.
- **A fixture validates itself.** Every one declares `protects` and a `requires`
  list checked before rendering, so a fixture that lost the thing it watches
  fails immediately rather than passing quietly.
