#!/usr/bin/env node
/**
 * generate-grade7-ss-covers — batch-generate the cover illustrations for the
 * 25 Grade 7 Social Studies lessons via the Kie.ai API and save them under
 * public/notes/covers/.
 *
 * It reuses the shared, firebase-free Kie client (functions/kieClient.js) and
 * the cover spec (scripts/data/grade7-ss-covers.js). The prompt for each
 * lesson is COVER_TEMPLATE filled with that lesson's subtopic + Zambian scene,
 * so the whole set keeps one cohesive flat-vector textbook look.
 *
 * The API key is read from the environment, NEVER hard-coded:
 *   - process.env.KIE_API_KEY, or
 *   - a `KIE_API_KEY=...` line in .env.local or .env at the repo root
 *     (both gitignored).
 *
 * It is IDEMPOTENT: a cover already present on disk is skipped, so a re-run
 * after a partial failure only generates the missing ones (no double spend).
 * Use --force to regenerate everything, or --only <seedKey,…> to target a few.
 *
 * Usage:
 *   KIE_API_KEY=... node scripts/generate-grade7-ss-covers.mjs
 *   node scripts/generate-grade7-ss-covers.mjs --dry-run        # print prompts, no calls
 *   node scripts/generate-grade7-ss-covers.mjs --only g7sci_ss_1_1,g7sci_ss_3_2
 *   node scripts/generate-grade7-ss-covers.mjs --force --aspect 16:9
 *
 * Flags:
 *   --dry-run         print the filled prompt for each cover and exit (no key needed)
 *   --force           regenerate even if the output file already exists
 *   --only <keys>     comma-separated seedKeys to limit the run to
 *   --aspect <ratio>  aspect_ratio (default 16:9 — wide lesson-card cover)
 *   --resolution <r>  e.g. 1K, 2K (model-dependent; omitted when unset)
 *   --model <id>      Kie model id (default: KIE_MODEL env or nano-banana-pro)
 *   --timeout <sec>   max seconds to wait per image (default 180)
 *
 * npm alias: `npm run kie:covers:g7ss -- --dry-run`
 */

import {writeFile, mkdir, readFile, access} from 'node:fs/promises'
import {constants as FS} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const kieClient = require('../functions/kieClient.js')
const {COVERS, buildCoverPrompt} = require('./data/grade7-ss-covers.cjs')

const {generateKieImage, downloadKieImage, DEFAULT_KIE_MODEL} = kieClient

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(REPO_ROOT, 'public', 'notes', 'covers')

// ─── arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {_: [], 'dry-run': false, force: false}
  const valueFlags = new Set(['only', 'aspect', 'resolution', 'model', 'timeout'])
  const boolFlags = new Set(['dry-run', 'force'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (boolFlags.has(key)) out[key] = true
      else if (valueFlags.has(key)) out[key] = argv[++i]
      else {
        console.error(`Unknown flag: --${key}`)
        process.exit(2)
      }
    } else {
      out._.push(a)
    }
  }
  return out
}

// ─── .env loader (no dotenv dependency, mirrors kie-generate-image.mjs) ────

async function readEnvFiles() {
  const merged = {}
  for (const file of ['.env', '.env.local']) {
    let text
    try {
      text = await readFile(path.join(REPO_ROOT, file), 'utf8')
    } catch (err) {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let value = m[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      merged[m[1]] = value
    }
  }
  return merged
}

async function fileExists(p) {
  try {
    await access(p, FS.F_OK)
    return true
  } catch (err) {
    return false
  }
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let covers = COVERS
  if (args.only) {
    const wanted = new Set(args.only.split(',').map((s) => s.trim()).filter(Boolean))
    covers = COVERS.filter((c) => wanted.has(c.seedKey))
    const missing = [...wanted].filter((k) => !COVERS.some((c) => c.seedKey === k))
    if (missing.length) {
      console.error(`Unknown seedKey(s) in --only: ${missing.join(', ')}`)
      process.exit(2)
    }
  }

  const aspectRatio = args.aspect || '16:9'
  const model = args.model || process.env.KIE_MODEL || DEFAULT_KIE_MODEL
  const extraInput = {}
  if (args.resolution) extraInput.resolution = args.resolution
  const timeoutMs = args.timeout ? Number(args.timeout) * 1000 : 180000

  // --dry-run needs no key: just show what would be sent.
  if (args['dry-run']) {
    console.log(`Dry run — ${covers.length} cover prompt(s), aspect ${aspectRatio}, model ${model}:\n`)
    for (const c of covers) {
      console.log(`# ${c.seedKey} → public/notes/covers/${c.file}`)
      console.log(buildCoverPrompt(c.subtopic, c.scene))
      console.log('')
    }
    return
  }

  const fileEnv = await readEnvFiles()
  const apiKey = process.env.KIE_API_KEY || fileEnv.KIE_API_KEY || ''
  if (!apiKey) {
    console.error(
      'No Kie API key found.\n' +
        'Set it before running, e.g.:\n' +
        '  KIE_API_KEY=your-key node scripts/generate-grade7-ss-covers.mjs\n' +
        'or add a line to .env.local (gitignored) at the repo root:\n' +
        '  KIE_API_KEY=your-key\n' +
        '(Use --dry-run to preview the prompts without a key.)',
    )
    process.exit(1)
  }

  await mkdir(OUT_DIR, {recursive: true})

  const summary = {generated: [], skipped: [], failed: []}

  for (let i = 0; i < covers.length; i++) {
    const c = covers[i]
    const outPath = path.join(OUT_DIR, c.file)
    const label = `[${i + 1}/${covers.length}] ${c.seedKey}`

    if (!args.force && (await fileExists(outPath))) {
      console.log(`${label} — skip (already exists: public/notes/covers/${c.file})`)
      summary.skipped.push(c.seedKey)
      continue
    }

    const prompt = buildCoverPrompt(c.subtopic, c.scene)
    console.log(`${label} — generating "${c.subtopic}"…`)

    try {
      let lastState = ''
      const result = await generateKieImage(apiKey, {
        prompt,
        aspectRatio,
        extraInput,
        model,
        timeoutMs,
        onProgress: ({state, progress, taskId}) => {
          if (state !== lastState) {
            lastState = state
            const pct = typeof progress === 'number' ? ` (${progress}%)` : ''
            console.log(`    [${taskId}] ${state}${pct}`)
          }
        },
      })
      const {bytes} = await downloadKieImage(result.url)
      await writeFile(outPath, bytes)
      console.log(`    saved ${bytes.length} bytes -> public/notes/covers/${c.file}`)
      summary.generated.push(c.seedKey)
    } catch (err) {
      const detail = err && err.message ? err.message : String(err)
      console.error(`    FAILED: ${detail}`)
      summary.failed.push({seedKey: c.seedKey, error: detail})
    }
  }

  console.log('\n──────────────────────────────────────────')
  console.log(`Generated: ${summary.generated.length}`)
  console.log(`Skipped (already on disk): ${summary.skipped.length}`)
  console.log(`Failed: ${summary.failed.length}`)
  if (summary.failed.length) {
    for (const f of summary.failed) console.log(`  - ${f.seedKey}: ${f.error}`)
    console.log('Re-run to retry the failed ones (existing files are skipped).')
    process.exitCode = 1
  }
}

main().catch((err) => {
  const detail = err && err.message ? err.message : String(err)
  console.error(`\nCover generation failed: ${detail}`)
  process.exit(1)
})
