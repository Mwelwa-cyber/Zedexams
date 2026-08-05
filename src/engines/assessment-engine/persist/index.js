/**
 * `persist/` — what the engine writes, and nothing about how.
 *
 * The modules here are pure builders: they turn a finished attempt into the
 * document that should be stored. Actually storing it is `src/services/`'s job
 * (`docs/architecture.md` §14.2 — the engine reaches Firebase through
 * services), which is what keeps every write assertable without an emulator and
 * lets the replay harness diff documents rather than mock an SDK.
 *
 * One builder today: the learner `results` document. The daily-exam and games
 * writes are the next two, and they are separate builders rather than options
 * on this one — `scores` stores grade as a Number and subject lowercased by
 * documented, deliberate divergence, and a single builder with a flag would
 * make that divergence look like a mistake somebody could tidy away.
 */
export {
  buildResultDocument,
  elapsedSeconds,
  RESULT_DOCUMENT_KEYS,
} from './resultDocument.js'
