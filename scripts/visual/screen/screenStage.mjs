/**
 * screenStage — a fixture becomes a screenshot (§4.6, the screen family).
 *
 * Three steps, each of which was run end to end while this was designed. The
 * measurements in `README.md` come from that run.
 *
 *   1. **CSS** — Tailwind over `src/index.css`. Its `content` glob already
 *      covers `src/**\/*.{js,jsx}`, so every utility the engine's renderers use
 *      is emitted. Built once per run, not per fixture.
 *   2. **Bundle** — esbuild over `screenEntry.jsx`. The font loaders are not a
 *      workaround: they inline KaTeX's fonts as data URIs, so **the page is
 *      offline by construction** and a screenshot can never depend on a font
 *      request succeeding. Built once per run.
 *   3. **Render** — Chromium: set the content, wait for fonts AND for the
 *      entry's own readiness flag, screenshot at each viewport.
 *
 * ## Failures are refusals, never blank pages
 *
 * Every way this can go wrong throws `RenderIncompleteError` or
 * `RenderEnvironmentError` rather than returning a screenshot. A missing
 * browser, a page error, a request that escaped to the network, a mount that
 * never signalled ready, an all-white capture — each of those, recorded as a
 * baseline, would be an infrastructure failure permanently enshrined as the
 * correct appearance. The paper stage holds the same rule; this is it applied
 * to a viewport instead of a page.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { RENDER_SETTINGS, resolveRenderChromium, RenderEnvironmentError } from '../renderEnvironment.js'
// The SAME launch flags the paper stage uses. They are part of the baseline
// identity (`assertComparableEnvironment` compares `chromiumFlags`), so a
// second list here would let the two families disagree about the environment
// they claim to have rendered in.
import { chromiumLaunchFlags } from '../pdfPages.js'
import { RenderIncompleteError } from '../renderGuards.js'
import { SCREEN_FIXTURES, SCREEN_VIEWPORTS, screenFixtureProblems } from './screenFixtures.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')

/**
 * Fonts must be inlined, not fetched. A `.woff2` left as a file URL is a
 * request, and a request that fails leaves the page rendering in a fallback
 * face — which looks like a subtle regression on every fixture at once.
 */
const FONT_LOADERS = ['--loader:.woff2=dataurl', '--loader:.woff=dataurl', '--loader:.ttf=dataurl']

/** Build the app's CSS. One call per run; the result is reused for every page. */
export function buildScreenCss(outDir) {
  const out = path.join(outDir, 'screen.css')
  execFileSync('npx', ['tailwindcss', '-i', 'src/index.css', '-o', out, '--minify'],
    { cwd: ROOT, stdio: 'pipe', timeout: 180_000 })
  const css = readFileSync(out, 'utf8')
  // A Tailwind build that emitted nothing useful would paint an unstyled page
  // and record it as correct. `.zx-opt` is the option row; if it is absent the
  // stylesheet is not the app's.
  if (!css.includes('.zx-opt')) {
    throw new RenderIncompleteError('the built stylesheet does not contain the quiz option styles — the CSS build did not produce the app\'s CSS')
  }
  return css
}

/**
 * Bundle the client entry. Returns `{ js, css }` — esbuild emits a sibling
 * stylesheet for the CSS the bundle imports (KaTeX's), which must reach the
 * page too or the maths renders unstyled.
 */
export function buildScreenBundle(outDir) {
  const outfile = path.join(outDir, 'entry.js')
  execFileSync('npx', [
    'esbuild', 'scripts/visual/screen/screenEntry.jsx',
    '--bundle', '--jsx=automatic', '--format=iife',
    `--outfile=${outfile}`,
    '--define:process.env.NODE_ENV="production"',
    ...FONT_LOADERS,
  ], { cwd: ROOT, stdio: 'pipe', timeout: 180_000 })
  const js = readFileSync(outfile, 'utf8')
  let css = ''
  try {
    css = readFileSync(outfile.replace(/\.js$/, '.css'), 'utf8')
  } catch {
    throw new RenderIncompleteError('the bundle emitted no stylesheet — KaTeX\'s CSS is missing, and the maths would render unstyled')
  }
  return { js, css }
}

/** The page a fixture is rendered in. Everything inline; nothing fetched. */
export function buildScreenHtml({ fixtureId, appCss, bundleCss, bundleJs }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${fixtureId}</title>
<style>${appCss}</style>
<style>${bundleCss}</style>
<style>
  /* The capture surround. Deliberately plain: a fixture's appearance must come
     from the app's own CSS, and anything decorative here would be baselined as
     though it were part of the renderer. */
  html, body { margin: 0; background: #ffffff; }
  .zx-screen-fixture { padding: 16px; }
</style>
</head><body><div id="root"></div>
<script>window.__screenFixtureId=${JSON.stringify(fixtureId)}</script>
<script>${bundleJs}</script>
</body></html>`
}

/** Is this capture blank? An all-one-colour page is a failed render, not a look. */
export function isBlankPng(bytes) {
  const png = PNG.sync.read(Buffer.from(bytes))
  const first = png.data.subarray(0, 4).join(',')
  for (let i = 4; i < png.data.length; i += 4) {
    if (png.data.subarray(i, i + 4).join(',') !== first) return false
  }
  return true
}

/**
 * Render every declared fixture at every declared viewport.
 *
 * @returns {Promise<Array<{ fixtureId, viewportId, target, png, width, height }>>}
 */
export async function renderScreenFixtures({ fixtures = SCREEN_FIXTURES, viewports = SCREEN_VIEWPORTS } = {}) {
  // Fixtures validate BEFORE anything renders. A fixture whose subject was
  // deleted must fail here rather than have its empty page recorded as the
  // reference every later comparison trusts.
  const problems = fixtures.flatMap(screenFixtureProblems)
  if (problems.length) {
    throw new RenderIncompleteError(`the screen fixtures do not validate:\n  ${problems.join('\n  ')}`)
  }

  const executable = await resolveRenderChromium()
  if (!executable) {
    throw new RenderEnvironmentError(
      'cannot render the screen family: no Chromium. This is an infrastructure failure, '
      + 'not a visual difference — nothing was compared and no baseline was written.',
    )
  }

  const workDir = mkdtempSync(path.join(os.tmpdir(), 'screen-gate-'))
  const results = []
  let browser
  try {
    const appCss = buildScreenCss(workDir)
    const { js: bundleJs, css: bundleCss } = buildScreenBundle(workDir)

    const puppeteer = (await import('puppeteer')).default
    browser = await puppeteer.launch({ executablePath: executable, args: chromiumLaunchFlags() })

    for (const fixture of fixtures) {
      const html = buildScreenHtml({ fixtureId: fixture.id, appCss, bundleCss, bundleJs })
      for (const viewport of viewports) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await captureOne({ browser, fixture, viewport, html }))
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    rmSync(workDir, { recursive: true, force: true })
  }
  return results
}

async function captureOne({ browser, fixture, viewport, html }) {
  const page = await browser.newPage()
  const failures = []
  try {
    page.on('pageerror', (err) => failures.push(`page error: ${err.message}`))
    // Any request at all is a bug here: the page is meant to be self-contained,
    // and a fixture that could fetch could produce a "valid" baseline out of a
    // failed request.
    page.on('request', (req) => {
      if (!/^(data|about|blob):/.test(req.url())) failures.push(`network request escaped: ${req.url()}`)
    })
    await page.emulateTimezone(RENDER_SETTINGS.timeZone)
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
    })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluateHandle('document.fonts.ready')
    // The entry's own readiness flag, not a sleep. A sleep long enough to be
    // safe on a slow runner is wasted on every fast one; a short one
    // screenshots a half-drawn page and files it as the reference.
    await page.waitForFunction('window.__screenReady === true', { timeout: 15_000 })

    const mountError = await page.evaluate(() => window.__screenError ?? null)
    if (mountError) failures.push(`mount error: ${mountError}`)
    if (failures.length) {
      throw new RenderIncompleteError(`${fixture.id}/${viewport.id}: ${failures.join('; ')}`)
    }

    const png = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }))
    if (isBlankPng(png)) {
      throw new RenderIncompleteError(
        `${fixture.id}/${viewport.id}: the capture is a single flat colour — the page did not draw, `
        + 'and recording this would enshrine an empty page as the correct appearance',
      )
    }
    const { width, height } = PNG.sync.read(png)
    return { fixtureId: fixture.id, viewportId: viewport.id, target: `${fixture.id}/${viewport.id}`, png, width, height }
  } finally {
    await page.close().catch(() => {})
  }
}
