/**
 * Print the rendering identity, and refuse to continue without the tools (§4.6).
 *
 * Recorded in the CI log and in every comparison summary so a reviewer can tell
 * an environment drift from a regression without rerunning anything.
 *
 *   node scripts/visual/reportEnvironment.mjs                 # both paper renderers
 *   node scripts/visual/reportEnvironment.mjs --stages=screen  # Chromium only
 *
 * ## The stages are an argument because the families need different tools
 *
 * The paper families need Chromium AND LibreOffice. The learner-SCREEN family
 * renders in Chromium only and deliberately does not install LibreOffice — so
 * asserting the paper toolchain there fails a job that has everything it needs.
 * That is not hypothetical: it is what this script did on the screen job's
 * first run, reporting "cannot render: LibreOffice (soffice) not available" for
 * a render that never wanted it.
 *
 * The default is unchanged, so every existing caller keeps asserting both.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  captureRenderEnvironment, assertToolchain, resolveRenderChromium, RenderEnvironmentError,
} from './renderEnvironment.js'

const chromiumPath = await resolveRenderChromium()
const environment = captureRenderEnvironment({ chromiumPath })

// Written before anything can fail. A toolchain failure happens BEFORE the gate
// creates its output directory, so without this the artefact upload finds nothing
// and the one piece of evidence a reviewer needs — what was and was not present —
// is only in the log.
const outputDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'visual', 'output')
fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(path.join(outputDir, 'environment.json'), JSON.stringify(environment, null, 2))

console.log('Rendering environment')
for (const [key, value] of Object.entries(environment)) {
  const shown = typeof value === 'object' ? JSON.stringify(value) : String(value)
  console.log(`  ${key.padEnd(20)} ${shown}`)
}

const stagesArg = process.argv.find((a) => a.startsWith('--stages='))
const stages = stagesArg ? stagesArg.slice('--stages='.length).split(',').filter(Boolean) : ['browser-print', 'docx']

try {
  assertToolchain(stages, environment)
  console.log(`\n✓ the tools for ${stages.join(' + ')} are available`)
} catch (err) {
  if (err instanceof RenderEnvironmentError) {
    console.error(`\n✗ ${err.message}`)
    process.exit(1)
  }
  throw err
}
