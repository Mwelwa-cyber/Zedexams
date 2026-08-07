/**
 * Regenerate functions/data/paperTerminology.json from the canonical config in
 * src/config/paperTerminology.js.
 *
 * Same reason as sync-assessment-bands.mjs: functions/ is a separate package and
 * only its own directory is uploaded on deploy, so it cannot import from src/.
 * The vocabulary is DATA, so it is generated rather than hand-mirrored — a
 * second hand-kept copy of the wording would drift on the first correction, and
 * the whole point of the config is that one word means one thing everywhere.
 *
 * The DIRECTIVE BUILDER stays on the server side (functions/teacherTools/
 * paperTerminology.js), following buildBandDirective: only the data crosses.
 *
 *   npm run sync:paper-terminology
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PAPER_TERMS, INSTRUCTION_REGISTER, FORBIDDEN_ON_PAPER, CURRICULA, CURRICULUM_ALIASES,
  DEFAULT_CURRICULUM,
} from '../src/config/paperTerminology.js'
import { isDirectRun } from './lib/isDirectRun.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The exact bytes the generated copy must contain. Shared with the test. */
export function renderTerminologyJson() {
  return `${JSON.stringify({
    _generated: 'npm run sync:paper-terminology — edit src/config/paperTerminology.js, not this file',
    curricula: CURRICULA,
    // The aliases travel too: the generator passes a framework YEAR, so a server
    // that did not know '2013' means OBC would give an OBC paper CBC's wording.
    curriculumAliases: CURRICULUM_ALIASES,
    defaultCurriculum: DEFAULT_CURRICULUM,
    terms: PAPER_TERMS,
    instructionRegister: INSTRUCTION_REGISTER,
    forbiddenOnPaper: FORBIDDEN_ON_PAPER,
  }, null, 2)}\n`
}

export const TERMINOLOGY_JSON_PATH = path.join(ROOT, 'functions/data/paperTerminology.json')

// Refuse to publish a config that would put developer vocabulary on a paper.
// The generated copy is what the generator prompt grounds on, so a term that
// resolves to a camelCase key must not reach it.
const problems = []
for (const [topic, group] of Object.entries(PAPER_TERMS)) {
  for (const [key, entry] of Object.entries(group)) {
    const values = entry.byCurriculum ? Object.values(entry.byCurriculum) : [entry.term]
    for (const value of values) {
      if (!value || !String(value).trim()) problems.push(`${topic}.${key} has no term`)
      else if (/[a-z][A-Z]/.test(value)) problems.push(`${topic}.${key} = "${value}" looks like a key`)
    }
  }
}
for (const [formality, register] of Object.entries(INSTRUCTION_REGISTER)) {
  if (!register.verbs?.length) problems.push(`${formality} has no instruction verbs`)
  if (!Array.isArray(register.topics)) problems.push(`${formality} declares no vocabulary topics`)
  for (const topic of register.topics || []) {
    if (!PAPER_TERMS[topic]) problems.push(`${formality} lists unknown topic "${topic}"`)
  }
}
if (problems.length > 0) {
  console.error('Refusing to sync — the terminology config is invalid:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

if (isDirectRun(import.meta.url)) {
  writeFileSync(TERMINOLOGY_JSON_PATH, renderTerminologyJson())
  console.log(
    `✓ wrote ${path.relative(ROOT, TERMINOLOGY_JSON_PATH)} `
    + `(${Object.keys(PAPER_TERMS).length} topics, ${Object.keys(INSTRUCTION_REGISTER).length} levels)`,
  )
}
