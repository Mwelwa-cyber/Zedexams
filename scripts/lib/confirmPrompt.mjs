// Interactive confirmation for the one-off migration scripts that write or
// delete. A destructive run must be typed out in full: pressing return by
// accident, or piping the script into something, must never be enough.

import readline from 'node:readline'

/**
 * Ask the operator to type `word` exactly. Returns true only if they did.
 *
 * With no TTY (CI, a pipe) there is nobody to ask, so this refuses rather than
 * assuming yes — callers offer an explicit --yes flag for that case, which is
 * itself the confirmation.
 */
export async function confirmByTyping(question, word = 'DELETE') {
  if (!process.stdin.isTTY) {
    console.error(
      `\nRefusing to continue: no terminal to confirm on. Re-run with --yes if you `
      + `mean it (that flag IS the confirmation).`,
    )
    return false
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise((resolve) => {
      rl.question(`\n${question}\nType ${word} to continue: `, resolve)
    })
    return answer.trim() === word
  } finally {
    rl.close()
  }
}
