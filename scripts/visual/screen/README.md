# The learner-screen visual gate

> Snapshot as of 2026-08-05 — verify before acting.

A third render family alongside `browser-print` and `docx`. Those protect
printed papers; this protects what a learner sees on a phone, which is the
first engine code they will meet and is measured by nothing today.

**Status: complete except for the baselines themselves.** Fixtures, stage,
runner, named page checks and CI wiring have all landed.
`tests/visual/baselines/screen/` is empty, so the gate reports **green and
UNARMED** — it renders every fixture, runs every page check, and compares
nothing, saying so loudly on every run.

To arm it: dispatch **Visual baseline bootstrap** from `main` with
`family=screen`. It opens a draft pull request with the recorded pages, which
is the one human look this gate gets — baselines lock whatever they show.

### The second dispatch succeeded and was still unusable

Run `31089421536` recorded all 16, opened #2137 — and stamped
`libreoffice: 24.2.7.2` into `environment.json`, with a 54-font digest that
includes `fonts-liberation`.

The bootstrap installed LibreOffice unconditionally, for the paper families,
and then recorded the screen family in the same job. Both of those values are
compared by `assertComparableEnvironment` (`libreoffice` is an identity field;
`fonts.digest` is checked separately), and the comparing job in
`visual-regression.yml` installs neither. So the baselines were
**irreproducible by construction**: correct images, a clean review sheet, and
every later comparison throwing an environment error instead of comparing
anything.

The bootstrap now records in two jobs, mirroring the compare workflow's own
split — `record-paper` with LibreOffice, `record-screen` with Chromium alone —
and `open-pull-request` needs both, tolerating whichever the dispatch skipped.
Two guards hold it: `assertScreenEnvironmentIsClean` refuses the recording
before a single byte is written, and `test:visual-gate` refuses a workflow edit
that puts LibreOffice back in the screen job. Neither is a comment.

Because the recorders no longer share a workspace, each hands its work over as
an artifact and `collectBootstrapRecordings.mjs` merges them — including the
review-sheet sidecars, since taking either one whole would describe half the
diff.

### The third dispatch recorded everything and delivered none of it

Run `31094944867` proved the environment fix — `record-screen` ran Chromium
alone, clean digest, all 16 rendered — and then **lost them in the handoff**.
`upload-artifact@v4` roots its archive at the least common ancestor of its
search paths, so two paths under `tests/visual/` produced a zip holding
`baselines/…` and `output/…` with the prefix stripped, while the collector
looked under `tests/visual/…`. It found nothing, and printed *"Every baseline
already exists — nothing was recorded"* — the message for a completely
different, legitimate outcome — and exited **0**. A green run, 4,990,794 bytes
of correct renders, zero delivered.

The bug did not break a check. It walked into an existing success path. So the
fix is two things, and the second matters more:

- the artifact's root is **found**, against `ARTIFACT_ROOT_CANDIDATES`, rather
  than assumed — the action's rooting rule is its business, not ours;
- each recorder publishes **how many baselines it wrote** as a job output, and
  the pull-request job refuses to continue unless that many arrive. The count
  travels through the Actions API, never inside the artifact: a count packed
  into the archive would be lost by the very bug it exists to catch and would
  agree with itself at zero. `"nothing to commit"` is now reachable only when
  the recorder independently reported zero.

Codex predicted this in a review comment posted four minutes after #2138 merged,
naming the least-common-ancestor rule and the two exact line numbers. Nobody
read it before the dispatch. `docs/MIGRATION_TEMPLATE.md` §7a is the standing
fix for that.

### The first dispatch failed, and where

Run `31072103730` rendered all 16 captures, wrote them, committed them and
pushed `baseline/bootstrap-31072103730` — then died at `gh pr create`. The
workflow treats a missing `tests/visual/output/baseline-summary.md` as a hard
stop (baselines nobody can review must not become a pull request), and only the
PAPER recorder wrote one. Everything expensive succeeded; the cheap part did not
exist; and the images were stranded on an orphan branch.

The review sheet now comes from `scripts/visual/baselineSummary.js`, which both
recorders share, and each screen section states the fixture's claims, its
viewport, the environment, the page checks that passed before the shutter, the
sha256 of the approved bytes, and a checklist of what to look at. Entries
ACCUMULATE across recorders rather than overwrite, so a `family=all` dispatch
cannot have one recorder erase the other's half of its own diff.

Why it reached main green: the workflow-side assertion existed from the start
(`gate.test.js` — every writer reads the sheet and exits 1 without it); its
recorder-side twin did not, so "a recorder that writes baselines writes a sheet"
was true of one recorder and untested for the other. Both halves are asserted
now, and `test:baseline-summary` builds the sheet the screen bootstrap would
build, from the real fixture set, without a browser.

### Three states, three different claims

| state | verdict | why |
|---|---|---|
| every baseline missing | **green, UNARMED** | nothing has been approved, so nothing can differ from it. Failing here would block the pull request that introduces the gate, and "does not match the recorded baselines" would be false — there are none |
| some missing | **red**, "NO BASELINE RECORDED" | a fixture added after the bootstrap has no approved appearance; skipping it would let it ride in unwatched |
| none missing | compare | any difference fails |

The unarmed window is real: between the gate landing and the bootstrap running,
the screen family is green and watching nothing. It is bounded by one dispatch,
shouted on every run, and ends the moment a single baseline exists.

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
