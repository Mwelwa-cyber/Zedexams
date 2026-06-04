#!/usr/bin/env node
/**
 * kie-generate-image — dev-time CLI to generate an image via the Kie.ai API
 * and save it to disk. Uses the shared, firebase-free client in
 * functions/kieClient.js (the same module a future Cloud Function will call).
 *
 * The API key is read from the environment, NEVER hard-coded:
 *   - process.env.KIE_API_KEY, or
 *   - a `KIE_API_KEY=...` line in .env.local or .env at the repo root.
 *     Both files are gitignored — drop your key there and it won't be committed.
 *
 * Usage (PowerShell):
 *   $env:KIE_API_KEY="..."                 # or put it in .env.local
 *   node scripts/kie-generate-image.mjs "A friendly cartoon elephant teacher"
 *   node scripts/kie-generate-image.mjs --prompt "Map of Zambia" --aspect 16:9
 *   node scripts/kie-generate-image.mjs "A baobab tree" --model nano-banana-pro --resolution 2K
 *   node scripts/kie-generate-image.mjs --prompt "Logo" --out generated/logo.png
 *   # full per-model input passthrough (overrides --prompt/--aspect/--resolution):
 *   node scripts/kie-generate-image.mjs --input '{"prompt":"x","aspect_ratio":"1:1"}'
 *
 * Flags:
 *   --prompt <text>     prompt (or pass it as the first positional arg)
 *   --model  <id>       Kie model id (default: KIE_MODEL env or nano-banana-pro)
 *   --aspect <ratio>    aspect_ratio, e.g. 1:1, 16:9, 3:4 (default 1:1)
 *   --resolution <res>  e.g. 1K, 2K (model-dependent; omitted when unset)
 *   --input  <json>     full `input` object as JSON (power users / non-T2I models)
 *   --out    <path>     output file or directory (default: generated/)
 *   --timeout <sec>     max seconds to wait for the task (default 180)
 *
 * npm alias: `npm run kie:image -- "your prompt here"`
 */

import {writeFile, mkdir, readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import kieClient from '../functions/kieClient.js'

const {generateKieImage, downloadKieImage, DEFAULT_KIE_MODEL} = kieClient

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ─── arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {_: []}
  const flags = new Set(['prompt', 'model', 'aspect', 'resolution', 'input', 'out', 'timeout'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (!flags.has(key)) {
        console.error(`Unknown flag: --${key}`)
        process.exit(2)
      }
      out[key] = argv[++i]
    } else {
      out._.push(a)
    }
  }
  return out
}

// ─── .env loader (no dotenv dependency) ──────────────────────────────────
// Reads .env then .env.local (local wins) from the repo root and returns a
// plain key→value map. process.env still takes precedence over both.

async function readEnvFiles() {
  const merged = {}
  for (const file of ['.env', '.env.local']) {
    let text
    try {
      text = await readFile(path.join(REPO_ROOT, file), 'utf8')
    } catch (err) {
      continue // file is optional
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

// ─── output path helpers ─────────────────────────────────────────────────

function extFromContentType(contentType, url) {
  const ct = String(contentType || '')
  if (/png/i.test(ct)) return 'png'
  if (/jpe?g/i.test(ct)) return 'jpg'
  if (/webp/i.test(ct)) return 'webp'
  if (/gif/i.test(ct)) return 'gif'
  const m = String(url || '').match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)
  if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
  return 'png'
}

function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  )
}

function hasFileExtension(p) {
  return /\.[a-z0-9]{2,5}$/i.test(p)
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const fileEnv = await readEnvFiles()
  const apiKey = process.env.KIE_API_KEY || fileEnv.KIE_API_KEY || ''
  if (!apiKey) {
    console.error(
      'No Kie API key found.\n' +
        'Set it before running, e.g. (PowerShell):\n' +
        '  $env:KIE_API_KEY="your-key"\n' +
        'or add a line to .env.local (gitignored) at the repo root:\n' +
        '  KIE_API_KEY=your-key',
    )
    process.exit(1)
  }

  let inputOverride = null
  if (args.input) {
    try {
      inputOverride = JSON.parse(args.input)
    } catch (err) {
      console.error(`--input is not valid JSON: ${err.message}`)
      process.exit(2)
    }
  }

  const prompt = (args.prompt || args._.join(' ')).trim()
  if (!inputOverride && !prompt) {
    console.error('No prompt given. Pass one as the first argument or via --prompt.')
    process.exit(2)
  }

  const model = args.model || process.env.KIE_MODEL || fileEnv.KIE_MODEL || DEFAULT_KIE_MODEL
  const aspectRatio = args.aspect || '1:1'
  const extraInput = {}
  if (args.resolution) extraInput.resolution = args.resolution
  const timeoutMs = args.timeout ? Number(args.timeout) * 1000 : 180000

  console.log(`Model:  ${model}`)
  if (inputOverride) {
    console.log(`Input:  ${JSON.stringify(inputOverride)}`)
  } else {
    console.log(`Prompt: ${prompt}`)
    console.log(`Aspect: ${aspectRatio}${args.resolution ? ` · resolution ${args.resolution}` : ''}`)
  }
  console.log('Submitting task to Kie…')

  let lastState = ''
  const result = await generateKieImage(apiKey, {
    ...(inputOverride ? {input: inputOverride} : {prompt, aspectRatio, extraInput}),
    model,
    timeoutMs,
    onProgress: ({state, progress, taskId}) => {
      if (state !== lastState) {
        lastState = state
        const pct = typeof progress === 'number' ? ` (${progress}%)` : ''
        console.log(`  [${taskId}] ${state}${pct}`)
      }
    },
  })

  console.log(`Image ready: ${result.url}`)
  const {bytes, contentType} = await downloadKieImage(result.url)

  // Resolve the destination. --out may be a file path or a directory; with
  // no --out we drop into generated/ (gitignored) with a slug-based name.
  const ext = extFromContentType(contentType, result.url)
  let outPath
  if (args.out && hasFileExtension(args.out)) {
    outPath = path.resolve(REPO_ROOT, args.out)
  } else {
    const dir = path.resolve(REPO_ROOT, args.out || 'generated')
    const name = `${slugify(prompt || model)}-${Date.now()}.${ext}`
    outPath = path.join(dir, name)
  }
  await mkdir(path.dirname(outPath), {recursive: true})
  await writeFile(outPath, bytes)

  console.log(`Saved ${bytes.length} bytes -> ${outPath}`)
}

main().catch((err) => {
  const detail = err && err.message ? err.message : String(err)
  console.error(`\nKie image generation failed: ${detail}`)
  if (err && err.taskId) console.error(`  taskId: ${err.taskId}`)
  process.exit(1)
})
