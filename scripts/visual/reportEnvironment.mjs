/**
 * Print the rendering identity, and refuse to continue without the tools (§4.6).
 *
 * Recorded in the CI log and in every comparison summary so a reviewer can tell
 * an environment drift from a regression without rerunning anything.
 *
 *   node scripts/visual/reportEnvironment.mjs
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

try {
  assertToolchain(['browser-print', 'docx'], environment)
  console.log('\n✓ both renderers are available')
} catch (err) {
  if (err instanceof RenderEnvironmentError) {
    console.error(`\n✗ ${err.message}`)
    process.exit(1)
  }
  throw err
}
