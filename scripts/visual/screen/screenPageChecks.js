/**
 * The named checks the stage runs IN THE PAGE, before each screenshot.
 *
 * ## Why they live here and not beside the renderer machinery
 *
 * `screenStage.mjs` imports `pngjs` and reaches for puppeteer, so anything
 * importing it needs `node_modules`. These checks are pure functions —
 * serialised into a browser and run there — and the fixture tests that assert
 * they are wired must stay runnable with NO dependencies installed, because
 * the `Visual scope` CI job runs them that way on purpose: plain node over pure
 * modules, no npm ci, no browser, seconds instead of minutes.
 *
 * That was not a design decision made up front. `screenFixtures.test.js`
 * imported these from the stage, and the scope job failed with
 * `Cannot find package 'pngjs'`. `screenPurity.test.js` now fails if either
 * module regains a dependency-bearing import.
 *
 * ## What they are for
 *
 * A pixel baseline answers "did this change". It cannot answer "was it ever
 * right": a baseline recorded from wrong output looks identical to one
 * recorded from right output, forever after. These answer the second question
 * for the properties whose failure is invisible in a diff against a baseline
 * recorded from the same wrong render — which is exactly how the fraction bug
 * would have been enshrined.
 *
 * `stackedNotation` is the one the owner asked for by name. It measures
 * GEOMETRY rather than markup: `.math-frac-num` must sit ABOVE
 * `.math-frac-den`. Before #2128 both had top 58 with the CSS unreachable;
 * after it, 58 and 75. A class-presence check would have passed in both cases.
 */
export const SCREEN_PAGE_CHECKS = Object.freeze({
  stackedNotation: {
    describe: 'the fraction is stacked — numerator above denominator, with a bar',
    // Serialised into the page, so it must be self-contained.
    run: () => {
      const frac = document.querySelector('.math-frac')
      if (!frac) return 'no .math-frac on the page — the fixture claims a fraction and none rendered'
      const num = frac.querySelector('.math-frac-num')
      const den = frac.querySelector('.math-frac-den')
      if (!num || !den) return 'the fraction has no numerator/denominator elements'
      const n = num.getBoundingClientRect()
      const d = den.getBoundingClientRect()
      if (!(n.bottom <= d.top + 1)) {
        return `numerator and denominator are side by side (num top ${Math.round(n.top)}, `
          + `den top ${Math.round(d.top)}) — the stacking CSS is not reaching the renderer`
      }
      const bar = window.getComputedStyle(num).borderBottomWidth
      if (!bar || parseFloat(bar) <= 0) return 'the fraction has no bar — a stack without a bar is not the school form'
      if (document.body.innerText.includes('/')) return 'a slash appears on the page — §4.1 forbids the slash form'
      return null
    },
  },
  letteredChoices: {
    describe: 'every choice row carries a letter badge, in order from A',
    run: () => {
      const rows = [...document.querySelectorAll('.zx-opt')]
      if (rows.length === 0) return 'no choice rows rendered'
      const letters = rows.map((r) => r.querySelector('.zx-opt-letter')?.textContent ?? '')
      const expected = rows.map((_, i) => String.fromCharCode(65 + i))
      if (letters.join(',') !== expected.join(',')) {
        return `letters are ${JSON.stringify(letters)}, expected ${JSON.stringify(expected)}`
      }
      return null
    },
  },
  singleColumn: {
    describe: 'the choices are one vertical column of full-width rows',
    run: () => {
      const rows = [...document.querySelectorAll('.zx-opt')]
      if (rows.length < 2) return 'fewer than two rows — nothing to tell a column from a grid'
      const lefts = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left)))
      if (lefts.size !== 1) return `rows start at ${lefts.size} different x positions — this is a grid, not a column`
      return null
    },
  },
  noVerdictLeak: {
    describe: 'an unrevealed question carries no correctness signal in its markup',
    run: () => {
      if (document.querySelector('[data-correct="true"], [data-wrong="true"]')) {
        return 'a verdict attribute is present on an unrevealed question — the answer key is readable in the DOM'
      }
      if (document.querySelector('[aria-label="Correct"], [aria-label="Incorrect"]')) {
        return 'a verdict mark is rendered on an unrevealed question'
      }
      return null
    },
  },
})
