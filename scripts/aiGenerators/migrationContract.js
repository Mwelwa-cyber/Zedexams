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
 *
 * ## What this proves, and what it does not
 *
 * Every clause below is decided by the PRESENCE of a marker in a file. That
 * proves a name occurs in the module — not that the required sequence executes
 * before the provider call. A generator could import `reserveAiOperation`, call
 * it after the model, and satisfy `reservation` here.
 *
 * This is a deliberate stopping point rather than an oversight. The alternative
 * — an AST analyser that proves ordering — is a large piece of machinery whose
 * own correctness nothing checks, and it would still not prove the sequence
 * holds at RUNTIME. The next slice removes the need for it instead: one
 * canonical `requireAndReserveAiOperation()` helper that refuses a missing or
 * malformed key and reserves before usage charging or provider access, so the
 * scanner can key on that single call rather than inferring a sequence.
 *
 * Until then, and after: the behavioural callable tests are the authority. This
 * contract is a completeness net over them, not a replacement — its job is to
 * notice a generator nobody wrote a test for.
 */

import { scanFile } from './scanModelCallSites.js'
import { existsSync, readFileSync } from 'node:fs'
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
    title: 'Curriculum is pinned (generation) or preserved (transformation)',
    defends: 'Grade, subject and curriculum drifting between what the teacher '
      + 'chose and what the model was told — the §3.5 failure. The two operation '
      + 'classes defend against it differently, and the contract must not treat '
      + 'them the same: a GENERATION originates curriculum content and must pin '
      + 'an explicit curriculum (resolveCbcContext); a TRANSFORMATION (revise / '
      + 'suggest / explain) works on an item that already exists and must '
      + 'PRESERVE that item\'s curriculum + subject, failing closed when it '
      + 'cannot name them (checkSourceCurriculum) so it can never silently pull '
      + 'in another curriculum\'s material. A blanket exemption for '
      + 'transformations was refused precisely because it would let exactly that '
      + 'drift through — the requirement is preservation, not absence.',
    holds: (scan, record) => (record.operationClass === 'transformation'
      ? scan.preservesSourceCurriculum
      : scan.curriculumGrounded),
  },
  {
    id: 'usage-metered',
    title: 'Server-side plan-limit enforcement',
    defends: 'A free-plan account generating without limit, and a failed '
      + 'generation still costing the teacher a quota unit.',
    holds: (scan) => scan.meteredUsage && scan.refundsUsage,
  },
  {
    id: 'deterministic-result-identity',
    title: 'The result document is derived from the operation, not auto-assigned',
    defends: 'Two documents for one logical generation. A reservation that '
      + 'settles onto an AUTO-ID document cannot resume: the retry has the key '
      + 'but no way back to what the first attempt wrote. Note this needs the '
      + 'auto-id branch to be ABSENT, not merely unused — the partial '
      + 'generators carry both behind a ternary, and the auto-id side is '
      + 'precisely the one a keyless request takes.',
    holds: (scan) => scan.keyedResultDoc && !scan.autoIdResultDoc,
  },
  {
    id: 'client-operation-lock',
    title: 'The client surface holds an operation lock',
    defends: 'A second provider call fired before the first request returns — '
      + 'a double-click, a rapid tap, a rerender. The server refuses the '
      + 'duplicate, but only if the client sends the SAME key; without '
      + 'useAiOperationLock it mints a fresh one and the refusal never '
      + 'triggers. Migrating only the backend leaves the user-visible half of '
      + 'the problem exactly where it was.',
    holds: (scan, record, root) => {
      if (!record.clientModule || !record.clientLockKey) return false
      const path = join(root, record.clientModule)
      if (!existsSync(path)) return false
      // The NAMED lock key, not merely `useAiOperationLock` somewhere in the
      // file. That weaker check passed WorksheetGenerator, whose only lock was
      // on the per-section regenerate while its primary Generate went through
      // an SSE endpoint that carried no key at all — the button teachers
      // actually press was completely unprotected, and the clause said fine.
      const text = readFileSync(path, 'utf8')
      return text.includes(`useAiOperationLock('${record.clientLockKey}')`)
        || text.includes(`useAiOperationLock("${record.clientLockKey}")`)
    },
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
  return CLAUSES.filter((c) => !c.holds(scan, record, root))
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
