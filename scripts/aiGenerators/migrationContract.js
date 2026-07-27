/**
 * What "migrated" means — the acceptance test every Phase 6 pull request must pass.
 *
 * ## Why this is executable and not a checklist
 *
 * A migration checklist in a document is satisfied by whoever is reading it.
 * Eleven refactors reviewed against prose will drift by the third one, and the
 * drift is invisible: each PR looks like the last, and none of them is checked
 * against the first. Encoding the contract means a PR that claims to migrate a
 * generator either satisfies it or fails `test:ai-generator-inventory`.
 *
 * ## The clauses, and what each one is defending against
 *
 * Each maps to a failure that has either already happened in this repo or is
 * one line of code away.
 */

import { scanFile } from './scanModelCallSites.js'
import { join } from 'node:path'

/**
 * The contract. Every clause is derived from the SOURCE, never asserted by the
 * record — a record that could assert its own compliance would be a comment.
 */
export const CLAUSES = Object.freeze([
  {
    id: 'reservation',
    title: 'One aiOperations registration',
    defends: 'Two provider calls, two saved documents and two usage charges for '
      + 'one intentional generation.',
    holds: (scan) => scan.idempotency !== 'none',
  },
  {
    id: 'idempotency-enforced',
    title: 'Idempotency cannot be opted out of',
    defends: 'The `partial` state: a request with no idempotency key silently '
      + 'taking the old unprotected path, with nothing recording that it did. '
      + 'A guard that skips the reservation when the key is absent makes the '
      + 'protection a client courtesy rather than a server guarantee.',
    holds: (scan) => scan.idempotency === 'enforced',
  },
  {
    id: 'settlement',
    title: 'Structured failure reasons',
    defends: 'An operation stuck in `processing` forever because the failure '
      + 'path never settled it — every retry then refuses to restart it.',
    holds: (scan) => scan.settlesOperation,
  },
  {
    id: 'input-validation',
    title: 'A strict input schema',
    defends: 'A malformed request reaching the provider and being paid for '
      + 'before anything notices.',
    holds: (scan) => scan.validatesInput,
  },
  {
    id: 'curriculum-pinned',
    title: 'Curriculum and subject identity pinned before generation',
    defends: 'Grade, subject and curriculum drifting between what the teacher '
      + 'chose and what the model was told — the §3.5 failure.',
    holds: (scan) => scan.curriculumGrounded,
  },
  {
    id: 'usage-metered',
    title: 'Server-side plan-limit enforcement',
    defends: 'A free-plan account generating without limit, and a failed '
      + 'generation still costing the teacher a quota unit.',
    holds: (scan) => scan.meteredUsage && scan.refundsUsage,
  },
])

/**
 * Check one generator record against the source.
 *
 * Returns the clauses it fails. An empty array means the contract holds, which
 * is the ONLY thing that entitles a record to say `state: 'migrated'`.
 */
export function checkContract(record, root) {
  const scan = scanFile(join(root, record.file), root)
  if (!scan) {
    return [{ id: 'reachable', title: 'The file makes a model call',
      reason: `${record.file} makes no direct model call — the inventory is out of date.` }]
  }
  return CLAUSES.filter((c) => !c.holds(scan))
    .map((c) => ({ id: c.id, title: c.title, defends: c.defends }))
}

/**
 * The state the SOURCE says a generator is in, independent of what it claims.
 *
 * `migrated` requires the whole contract, not just a reservation. That is the
 * distinction the inventory exists to make: five generators reserve an
 * operation and would pass a naive "is it wired" check while still letting a
 * keyless request through.
 */
export function derivedState(record, root) {
  const scan = scanFile(join(root, record.file), root)
  if (!scan || scan.idempotency === 'none') return 'unmigrated'
  return checkContract(record, root).length === 0 ? 'migrated' : 'partial'
}
