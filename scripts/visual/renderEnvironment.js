/**
 * renderEnvironment — who rendered this, and may it be compared? (§4.6)
 *
 * A visual baseline is only meaningful against the environment that produced it.
 * Change the Chromium build, the LibreOffice build, the OS image or a font
 * package, and every page differs a little — which, without this module, arrives
 * as several hundred unexplained visual failures across every fixture at once.
 * A reviewer facing that has no way to tell an environment drift from a genuine
 * regression, and the rational response is to update all the baselines, which
 * destroys the suite's value in a single commit.
 *
 * So the identity of the renderer is recorded with every result, and a mismatch
 * is an ENVIRONMENT ERROR — a different kind of failure with a different remedy,
 * reported once rather than per page.
 *
 * ## Two renderers, two baseline families
 *
 * `browser-print/chromium-<version>` and `docx/libreoffice-<version>` are
 * separate baseline identities and are never compared against each other. They
 * are not two views of one thing: Chromium is authoritative for the preview, the
 * print window, print CSS and SVG, and LibreOffice is a deterministic DOCX
 * renderer for CI.
 *
 * LibreOffice is explicitly NOT proof that Microsoft Word renders the same. It
 * cannot be — it is a different implementation. What Word will do with the file
 * is answered by the OOXML assertions in `paperGolden.test.js` (the SVG part
 * exists, the raster fallback exists, the relationship is declared), and those
 * remain load-bearing. A pixel comparison of a LibreOffice render cannot tell you
 * which embedded representation was chosen; the OOXML assertion cannot tell you
 * whether the result looks right. Neither proves the other, so both run.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Raised when the toolchain is absent or mismatched. Never a visual finding. */
export class RenderEnvironmentError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.name = 'RenderEnvironmentError'
    this.detail = detail
  }
}

/** The A4 page and raster settings every fixture is rendered at. Pinned. */
export const RENDER_SETTINGS = Object.freeze({
  pageSize: 'A4',
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginsMm: { top: 20, right: 18, bottom: 16, left: 18 },
  // 150dpi is enough to see a decimal point and small enough to keep the
  // artefacts reviewable. Changing it invalidates every baseline, by design.
  dpi: 150,
  deviceScaleFactor: 1,
  locale: 'en-GB',
  timeZone: 'Africa/Lusaka',
  // Every fixture uses this date. A paper that printed today's date would
  // produce a new baseline every day.
  fixedDate: '2026-01-15',
})

/** Run a version command, returning '' rather than throwing. */
function probe(command, args) {
  try {
    return String(execFileSync(command, args, { encoding: 'utf8', timeout: 30000 })).trim()
  } catch {
    return ''
  }
}

/**
 * Fonts installed for the render, as a stable digest.
 *
 * A hash rather than a list: the list is long and its usefulness is only ever
 * "is this the same set as last time". The digest covers each file's name and
 * size, which is enough to notice a package upgrade without reading every byte
 * of every font on the image.
 */
export function fontDigest(dirs = ['/usr/share/fonts', '/usr/local/share/fonts']) {
  const entries = []
  const walk = (dir, depth = 0) => {
    if (depth > 4 || !existsSync(dir)) return
    let names
    try {
      names = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of names) {
      const full = path.join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full, depth + 1)
      else if (/\.(ttf|otf|ttc|pfb)$/i.test(name)) entries.push(`${name}:${st.size}`)
    }
  }
  for (const dir of dirs) walk(dir)
  if (!entries.length) return { count: 0, digest: 'none' }
  return {
    count: entries.length,
    digest: createHash('sha256').update(entries.join('|')).digest('hex').slice(0, 16),
  }
}

/** Chromium's version, or '' when the binary is absent. */
/**
 * The Chromium binary this suite renders with.
 *
 * ASYNC, because that is what puppeteer's `executablePath()` is — and getting
 * that wrong is how this module recorded a version for a browser that drew none
 * of the pages. The first attempt probed a fixed path (the container's Playwright
 * install) while puppeteer launched its own bundled Chrome; the second called
 * `executablePath()` synchronously, got a pending Promise, and silently fell back
 * to the same wrong path. On a CI runner nothing was at that path at all, so the
 * gate reported "Chromium not available" with a perfectly good browser sitting in
 * puppeteer's cache.
 *
 * Asking the launcher — and then LAUNCHING with what it answered — makes the
 * recorded version and the rendering binary the same one by construction.
 *
 * `CHROMIUM_PATH` wins, for pinning a build by hand. When neither resolves, this
 * returns '' and `assertToolchain` reports infrastructure: a wrong version
 * recorded against a baseline is worse than a refusal to run.
 */
export async function resolveRenderChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  try {
    const puppeteer = (await import('puppeteer')).default
    const resolved = await puppeteer.executablePath()
    if (resolved && existsSync(resolved)) return resolved
  } catch {
    // No puppeteer, or no downloaded browser.
  }
  return ''
}

export function chromiumVersion(executable = process.env.CHROMIUM_PATH || '') {
  if (!executable || !existsSync(executable)) return ''
  // "Chromium 141.0.7390.37" → "141.0.7390.37"
  const raw = probe(executable, ['--version'])
  const m = /([\d.]+)/.exec(raw)
  return m ? m[1] : ''
}

/** LibreOffice's version, or '' when the binary is absent. */
export function libreOfficeVersion(executable = process.env.SOFFICE_PATH || 'soffice') {
  // "LibreOffice 7.4.7.2 40(Build:2)" → "7.4.7.2"
  const raw = probe(executable, ['--version'])
  const m = /([\d.]+)/.exec(raw)
  return m ? m[1] : ''
}

/**
 * Capture the full rendering identity.
 *
 * Recorded in every comparison summary so a reviewer can see, without rerunning
 * anything, whether a failure could be environmental.
 */
export function captureRenderEnvironment(opts = {}) {
  const chromium = chromiumVersion(opts.chromiumPath)
  const libreoffice = libreOfficeVersion(opts.sofficePath)
  const fonts = fontDigest(opts.fontDirs)
  return {
    chromium,
    // Recorded but NOT part of the comparable identity: which path the binary sits
    // at differs between a runner and a workstation while the build is the same.
    chromiumPath: opts.chromiumPath || '',
    libreoffice,
    os: `${os.type()} ${os.release()}`,
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    fonts,
    ...RENDER_SETTINGS,
    // The command matters: a flag change (say --font-render-hinting) shifts every
    // glyph edge, and a reviewer must be able to see that it was the cause.
    chromiumFlags: CHROMIUM_FLAGS.join(' '),
    libreOfficeArgs: LIBREOFFICE_ARGS.join(' '),
  }
}

/**
 * Chromium flags, pinned so the raster is reproducible.
 *
 * Every one of these is here to remove a source of variation rather than to make
 * the render nicer: deterministic hinting, no GPU path, no first-run state.
 */
export const CHROMIUM_FLAGS = Object.freeze([
  '--headless=new',
  '--disable-gpu',
  '--force-device-scale-factor=1',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--hide-scrollbars',
  '--no-first-run',
  '--disable-extensions',
  // Offline is a requirement, not an optimisation: a fixture that could reach the
  // network could produce a "valid" baseline from a failed external resource.
  '--disable-features=NetworkService',
])

/** LibreOffice conversion arguments, pinned for the same reason. */
export const LIBREOFFICE_ARGS = Object.freeze([
  '--headless',
  '--norestore',
  '--nolockcheck',
  '--nodefault',
  '--nofirststartwizard',
])

/**
 * The baseline family a render belongs to.
 *
 * Version-qualified on purpose: baselines from different renderer builds are
 * different baselines, stored side by side rather than overwritten. That is what
 * makes an upgrade a reviewable event instead of a mass baseline rewrite.
 */
export function baselineIdentity(stage, environment) {
  if (stage === 'browser-print') {
    const v = environment?.chromium
    if (!v) throw new RenderEnvironmentError('Chromium version unknown — cannot file a baseline')
    return `browser-print/chromium-${v}`
  }
  if (stage === 'docx') {
    const v = environment?.libreoffice
    if (!v) throw new RenderEnvironmentError('LibreOffice version unknown — cannot file a baseline')
    return `docx/libreoffice-${v}`
  }
  // The learner SCREEN. Chromium again, but a separate identity from
  // `browser-print` on purpose: the two render different documents at
  // different sizes, and a baseline recorded for one must never be reached for
  // by the other. Sharing the identity would let a print baseline satisfy a
  // screen comparison the day someone passed the wrong stage string.
  if (stage === 'screen') {
    const v = environment?.chromium
    if (!v) throw new RenderEnvironmentError('Chromium version unknown — cannot file a baseline')
    return `screen/chromium-${v}`
  }
  throw new RenderEnvironmentError(`unknown render stage "${stage}"`)
}

/** Fields that must match for a comparison to mean anything. */
const IDENTITY_FIELDS = [
  'chromium', 'libreoffice', 'os', 'dpi', 'deviceScaleFactor',
  'pageSize', 'locale', 'timeZone', 'chromiumFlags', 'libreOfficeArgs',
]

/**
 * Refuse to compare across environments.
 *
 * Throws rather than returning a verdict, because this is not a finding about
 * the paper — it is a statement that the question cannot be answered here. A
 * suite that answered it anyway would produce hundreds of failures whose only
 * honest resolution is "the renderer changed".
 */
export function assertComparableEnvironment(baselineEnv, currentEnv) {
  if (!baselineEnv) {
    throw new RenderEnvironmentError(
      'the baseline carries no recorded environment, so it cannot be compared — '
      + 're-record it through the reviewed baseline workflow',
    )
  }
  const differences = []
  for (const field of IDENTITY_FIELDS) {
    const before = baselineEnv[field]
    const after = currentEnv?.[field]
    if (before === undefined && after === undefined) continue
    if (String(before) !== String(after)) {
      differences.push({ field, baseline: before, current: after })
    }
  }
  const fontsBefore = baselineEnv.fonts?.digest
  const fontsAfter = currentEnv?.fonts?.digest
  if (fontsBefore !== fontsAfter) {
    differences.push({ field: 'fonts.digest', baseline: fontsBefore, current: fontsAfter })
  }
  if (differences.length) {
    throw new RenderEnvironmentError(
      'the rendering environment differs from the one that produced these baselines, '
      + 'so a pixel comparison would be meaningless:\n'
      + differences.map((d) => `  ${d.field}: ${d.baseline} → ${d.current}`).join('\n'),
      { differences },
    )
  }
}

/**
 * Refuse to run without the tools.
 *
 * A missing executable must never be read as "the page rendered blank" — that is
 * how an infrastructure failure becomes an accepted baseline of an empty page.
 */
export function assertToolchain(stages, environment) {
  const missing = []
  if (stages.includes('browser-print') && !environment.chromium) missing.push('Chromium')
  if (stages.includes('screen') && !environment.chromium) missing.push('Chromium')
  if (stages.includes('docx') && !environment.libreoffice) missing.push('LibreOffice (soffice)')
  if (missing.length) {
    throw new RenderEnvironmentError(
      `cannot render: ${missing.join(' and ')} not available. This is an `
      + 'infrastructure failure, not a visual difference — no comparison was attempted '
      + 'and no baseline was written.',
      { missing },
    )
  }
}
