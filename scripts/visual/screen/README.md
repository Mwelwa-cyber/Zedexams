# The learner-screen visual gate

> Snapshot as of 2026-08-05 — verify before acting.

A third render family alongside `browser-print` and `docx`. Those protect
printed papers; this protects what a learner sees on a phone, which is the
first engine code they will meet and is measured by nothing today.

**Status: complete except for the baselines themselves.** Fixtures, stage,
runner, named page checks and CI wiring have all landed. `tests/visual/baselines/screen/`
is empty, so the gate reports RED — and that is correct, not broken:
`runScreenGate.mjs` never creates a baseline from a comparison run, so it
cannot approve its own first render.

To record them: dispatch **Visual baseline bootstrap** from `main` with
`family=screen`. It opens a draft pull request with the recorded pages, which
is the one human look this gate gets — baselines lock whatever they show.

Replacing an approved screen baseline is NOT yet supported (the update
workflow's sweep path is not routed to this runner), and nothing is blocked by
that: a baseline that does not exist cannot be replaced.

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

## Named page checks — what a pixel baseline cannot tell you

A baseline answers "did this change". It cannot answer "was it ever right": a
baseline recorded from wrong output looks identical to one recorded from right
output, forever. So each fixture declares `pageChecks`, run IN THE PAGE before
the screenshot, and a failure refuses the capture rather than recording it.

| check | what it measures |
|---|---|
| `stackedNotation` | the numerator's box sits ABOVE the denominator's, there is a bar, and no slash appears |
| `letteredChoices` | every row carries a letter, in order from A |
| `singleColumn` | all rows start at one x position — a column, not a grid |
| `noVerdictLeak` | an unrevealed question carries no correctness signal in its markup |

`stackedNotation` measures geometry, not markup, and that distinction is the
whole point: before #2128 the classes were all present and both boxes had
`top: 58`. Verified by reverting that fix against the live stage — the render
refuses with *"numerator and denominator are side by side (num top 60, den top
60)"*.

## Scope, and why it is not a `paths:` filter

The `Visual regression gate` check is required and must report on every pull
request. The screen render is therefore gated by `screenAffectingPaths.js`
INSIDE the workflow. A filtered required check is *missing*, not passed, and
branch protection then holds every unrelated pull request open forever.

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
