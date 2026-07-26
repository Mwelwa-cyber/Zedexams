/**
 * Print the rendering identity, and refuse to continue without the tools (§4.6).
 *
 * Recorded in the CI log and in every comparison summary so a reviewer can tell
 * an environment drift from a regression without rerunning anything.
 *
 *   node scripts/visual/reportEnvironment.mjs
 */

import { captureRenderEnvironment, assertToolchain, RenderEnvironmentError } from './renderEnvironment.js'

const environment = captureRenderEnvironment()

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
