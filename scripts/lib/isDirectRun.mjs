/**
 * Is this module the one node was asked to run?
 *
 * The idiom every script here used was:
 *
 *     if (import.meta.url === `file://${process.argv[1]}`) main()
 *
 * which is false whenever the path contains a character that is percent-encoded
 * in a file URL — a space is enough. `import.meta.url` carries `%20`,
 * `process.argv[1]` carries the raw path, the comparison fails, and the script
 * **exits 0 having done nothing and printed nothing**.
 *
 * That is the worst shape of failure for a tool whose job is to report: not a
 * crash, not an error, a clean success that means the opposite of what it looks
 * like. Reproduced with the sweep script under `/tmp/zed review space` — exit 0,
 * empty output, for a command whose entire purpose is to print what it found.
 *
 * Raised by Codex on #2146 (`r3730024107`). One helper rather than four local
 * fixes because it was in four scripts, including both `sync-*` mirrors, where
 * "did nothing" reads as "the mirror is already in sync".
 *
 * `process.argv[1]` may be relative, so it is resolved before comparing.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function isDirectRun(importMetaUrl) {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return fileURLToPath(importMetaUrl) === path.resolve(entry)
  } catch {
    return false
  }
}
