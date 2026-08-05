/**
 * The learner session's behaviour, as a suite that any implementation must pass.
 *
 * ## Why this exists
 *
 * Steps 1 and 5 of the Phase 3 work order used extract-then-compare: pull a pure
 * function out of the runner, then diff its output against the engine's. That
 * only works where there is a seam. The session — timer, autosave, resume,
 * navigation, submit gating — has none: it is React state inside a 1,985-line
 * component, and there is nothing to extract without changing the behaviour
 * being preserved.
 *
 * So the discipline here is **characterise-then-conform**. The old behaviour is
 * pinned as a test suite rather than as a function, that suite is reviewed as
 * the specification, and the engine session must then pass the identical suite.
 * The old runner passing proves the tests describe reality; the new session
 * passing proves conformance. Same epistemology as the replay differ, lifted
 * from function level to behaviour level.
 *
 * ## Contract vs incidental — the classification IS the spec
 *
 * Written down deliberately. Without it, every deviation the engine shows
 * becomes a judgement call made under cutover pressure, which is exactly what
 * agreeing the differ's rules in advance was designed to prevent.
 *
 * **CONTRACT — must match exactly.** Anything a learner can lose marks or work
 * to:
 *   • the timer's deadline arithmetic, and that it is recomputed rather than
 *     decremented (a refresh must never add time);
 *   • auto-submit on expiry, exactly once, however many paths reach it;
 *   • what autosave persists — the field set, not merely "something";
 *   • which state changes trigger a save;
 *   • resume: every field restored, the section index clamped, and an EXPIRED
 *     session submitted rather than discarded;
 *   • navigation bounds, and that Submit is always reachable;
 *   • submit-once, with retry allowed after a genuine failure.
 *
 * **INCIDENTAL — may differ.** Anything a learner cannot lose work to:
 *   • the tick interval (500ms today) — a display cadence, not a deadline;
 *   • feedback-toast duration (1300ms);
 *   • image prefetching;
 *   • animation, progress-bar easing, focus order, DOM structure.
 *
 * The line between them is "can a learner lose marks or work to this". Moving an
 * item across it is a decision to state in a PR, not one to make while making a
 * test pass.
 *
 * ## Approved deviations — where the engine must NOT match the old runner
 *
 * One so far. Recorded here rather than discovered at cutover, so the
 * conformance suite demonstrably does not enforce a bug and the write differ
 * knows the difference is expected rather than a surprise.
 *
 * **`timeSpent` when the true start is unknown.** On resume the old runner does
 * `setStartTime(saved.startTime || Date.now())`, so a draft missing `startTime`
 * yields a duration measured from the RESUME rather than from the attempt — a
 * number indistinguishable from a measured one, which is worse than an honest
 * absence. The engine records `null`. The old runner is left alone; it retires
 * with the quirk. Two constraints ride with this, and both are on the PR that
 * gives the engine a write path (`persist/`), because that is the first moment
 * anything can write null:
 *
 *   1. **`QuizResultsV2:228` must be fixed in that same PR.** It reads
 *      `result.timeSpent ? … : 0` and would render an honest null to a learner
 *      as a confident "0m 0s" — the exact failure this deviation avoids, just
 *      displayed instead of averaged. The other three readers already treat
 *      absence as unknown (both admin `fmtTime`s return '—', the CSV export
 *      writes an empty cell), and NOTHING aggregates the field: `classAnalytics`
 *      does not read it, so there is no average to poison.
 *   2. **The nullability belongs in `persist/`'s own contract.** There is no zod
 *      write schema for `results` to amend — `src/schemas/result.js` is a
 *      read-side coercer that says in its own docblock why no write schema
 *      exists yet, and does not touch `timeSpent`, which passes through as an
 *      undocumented extra.
 *
 * ## A premise this suite was nearly built on, and the correction
 *
 * The deviation above was first raised as a fairness bug: that a refresh resets
 * the clock, letting a learner extend a timed quiz. **It does not.** Reading the
 * runner: `endTime` IS persisted and restored (`:390`), and the countdown reads
 * `endTime` and nothing else (`:460`). `startTime` is used in exactly two
 * places — the autosave payload and the submitted `timeSpent`. The deadline was
 * never resettable, so there is no fairness edge, nothing competitive is
 * affected, and the residual bug is one under-reported duration on a corrupt or
 * legacy draft.
 *
 * Written down because a stale premise outlives the conversation that produced
 * it, and the next person to touch the timer should meet the correction rather
 * than re-derive it. It is the second time in this phase a confident claim
 * shrank once someone read the artifact — the first was the `agentJobs` grant.
 *
 * ## Timers
 *
 * Every timing assertion runs on fake timers with explicit advancement. A
 * characterisation suite that waits on real time is flaky in CI, and a suite
 * that goes flaky gets retried, then skipped, then deleted — losing exactly the
 * authority it was written to hold.
 *
 * ## The harness
 *
 * An implementation supplies the adapter below. Nothing in this file imports a
 * runner, which is what lets the same assertions run against both.
 *
 * @typedef {object} SessionHarness
 * @property {(opts: object) => Promise<object>} mount  render the runner
 * @property {(mode: 'practice'|'exam') => Promise<void>} start
 * @property {(optionIndex: number) => Promise<void>} answerCurrent
 * @property {() => Promise<void>} next
 * @property {() => Promise<void>} prev
 * @property {() => Promise<void>} openSubmit
 * @property {() => Promise<void>} confirmSubmit
 * @property {() => object|null} lastSavedSession   the autosave payload
 * @property {() => number} savedSessionCount       how many saves have happened
 * @property {() => object|null} submittedResult    the result payload, or null
 * @property {() => boolean} canGoPrev
 * @property {() => boolean} hasNext
 * @property {(ms: number) => Promise<void>} tick  advance the clock, inside act
 * @property {() => boolean} hasSubmit
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The fields the CURRENT runner's autosave writes.
 *
 * DESCRIPTIVE, not a contract. It records the mechanism as it stands so a
 * reader can see what a persisted draft looks like today — it is deliberately
 * not asserted, because the promise to a learner is that the answer survives,
 * not that it survives in this shape. An engine that persists a different set,
 * or writes deltas, or debounces, conforms as long as the durability
 * assertions stay green. (Owner decision, 2026-08-05.)
 */
export const SESSION_AUTOSAVE_MECHANISM_KEYS = Object.freeze([
  'mode', 'answers', 'flagged', 'revealed', 'shortText', 'aiResults',
  'activeSectionIndex', 'endTime', 'startTime', 'savedAt',
])

/** Minutes a quiz runs for when it declares no duration. */
export const DEFAULT_DURATION_MINUTES = 30

/**
 * Run the contract against one implementation.
 *
 * @param {string} name
 * @param {() => SessionHarness} makeHarness  fresh harness per test
 */
export function describeSessionContract(name, makeHarness) {
  describe(`${name} — session contract`, () => {
    /** @type {SessionHarness} */
    let h
    const T0 = 1_700_000_000_000

    beforeEach(() => {
      // `shouldAdvanceTime` is load-bearing, and was established by isolating
      // three configurations rather than guessed at. A frozen fake clock hangs
      // the mount outright: React Testing Library's async act schedules through
      // the timer APIs, so with them faked and never advanced the render never
      // settles and every assertion reports a 5s TIMEOUT rather than a failure
      // — which reads as a broken suite instead of wrong behaviour. The first
      // run of this suite did exactly that, 24 for 24.
      //
      //   A. real timers                        → mounts
      //   B. fake timers + shouldAdvanceTime    → mounts   ← this
      //   C. mount real, then install fake ones → hangs
      //
      // The cost is that the clock also creeps with real time, so nothing here
      // asserts an absolute instant — deadlines are asserted as DURATIONS
      // (endTime - startTime), which is the property that matters and which
      // cancels the drift.
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(T0)
      h = makeHarness()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    // ── Timer ────────────────────────────────────────────────────────────────

    describe('timer', () => {
      it('exam mode fixes a deadline from the quiz duration at start', async () => {
        await h.mount({ quiz: { duration: 10 } })
        await h.start('exam')
        const saved = h.lastSavedSession()
        expect(saved.endTime - saved.startTime).toBe(10 * 60 * 1000)
      })

      it('a quiz with no duration runs for the default', async () => {
        await h.mount({ quiz: { duration: undefined } })
        await h.start('exam')
        const saved = h.lastSavedSession()
        expect(saved.endTime - saved.startTime).toBe(DEFAULT_DURATION_MINUTES * 60 * 1000)
      })

      it('practice mode sets no deadline', async () => {
        await h.mount({ quiz: { duration: 10 } })
        await h.start('practice')
        expect(h.lastSavedSession().endTime).toBeFalsy()
      })

      it('the deadline is FIXED — time already elapsed is not given back', async () => {
        // The property that makes a refresh safe: remaining is recomputed from a
        // stored deadline, never decremented from a counter that restarts.
        const savedEnd = T0 + 60_000
        await h.mount({ quiz: { duration: 10 }, savedSession: {
          mode: 'exam', endTime: savedEnd, startTime: T0 - 540_000, answers: {},
        } })
        await h.tick(1000)
        // A decrementing timer would restart at the full 10 minutes on resume.
        // A recomputed one keeps the deadline it was given, so only ~1 minute
        // is left however many times the learner reloads.
        expect(h.lastSavedSession().endTime).toBe(savedEnd)
      })

      it('auto-submits when the deadline passes', async () => {
        await h.mount({ quiz: { duration: 1 } })
        await h.start('exam')
        expect(h.submittedResult()).toBeNull()
        await h.tick(61_000)
        expect(h.submittedResult()).not.toBeNull()
      })

      it('auto-submits EXACTLY ONCE however long the clock keeps running', async () => {
        // The timer and the expired-resume path share one guard. Two submits
        // means two result documents for one attempt.
        await h.mount({ quiz: { duration: 1 } })
        await h.start('exam')
        await h.tick(61_000)
        const after = h.submitCount()
        await h.tick(30_000)
        expect(h.submitCount()).toBe(after)
        expect(after).toBe(1)
      })
    })

    // ── Durability ───────────────────────────────────────────────────────────
    //
    // What the old runner promises a learner is not "a write per keystroke" —
    // it is "your answer survives". The mechanism today is an effect that
    // serialises the whole session on every state change, including every
    // keystroke; that is an implementation, and pinning it here would force the
    // engine to conform to an inefficiency it should be free to fix. The engine
    // may debounce, may write deltas, may batch — so long as every assertion
    // below stays green.
    //
    // So these assert OUTCOMES: put an answer in, lose the session the way a
    // learner actually loses one, come back, and find the answer. No assertion
    // counts writes or inspects cadence.

    describe('durability', () => {
      it('an answer survives losing the session and coming back', async () => {
        await h.mount({})
        await h.start('practice')
        await h.answerCurrent(1)

        // What a tab kill leaves behind is whatever was last persisted.
        const survived = h.lastSavedSession()
        const reopened = makeHarness()
        await reopened.mount({ savedSession: survived })

        expect(reopened.isStarted()).toBe(true)
        expect(Object.keys(reopened.lastSavedSession().answers)).toHaveLength(1)
      })

      it('an answer survives navigating away and back', async () => {
        await h.mount({ sections: 2 })
        await h.start('practice')
        await h.answerCurrent(1)
        await h.next()
        await h.prev()
        expect(Object.keys(h.lastSavedSession().answers)).toHaveLength(1)
      })

      it('answers from different sections all survive', async () => {
        await h.mount({ sections: 2 })
        await h.start('practice')
        await h.answerCurrent(1)
        await h.next()
        await h.answerCurrent(0)

        const survived = h.lastSavedSession()
        const reopened = makeHarness()
        await reopened.mount({ sections: 2, savedSession: survived })
        expect(Object.keys(reopened.lastSavedSession().answers)).toHaveLength(2)
      })

      it('the section the learner was on survives', async () => {
        await h.mount({ sections: 3 })
        await h.start('practice')
        await h.next()

        const survived = h.lastSavedSession()
        const reopened = makeHarness()
        await reopened.mount({ sections: 3, savedSession: survived })
        expect(reopened.lastSavedSession().activeSectionIndex).toBe(1)
      })

      it('nothing is persisted before the learner starts', async () => {
        // Not a cadence assertion: an unstarted quiz has no attempt to
        // recover, and writing one would resume a learner into a session they
        // never began.
        await h.mount({})
        expect(h.lastSavedSession()).toBeNull()
      })
    })

    // ── Resume ───────────────────────────────────────────────────────────────

    describe('resume', () => {
      it('restores answers and lands the learner back in the session', async () => {
        await h.mount({ savedSession: {
          mode: 'practice', answers: { q1: 1 }, activeSectionIndex: 0, startTime: T0 - 1000,
        } })
        expect(h.isStarted()).toBe(true)
        expect(h.lastSavedSession().answers).toMatchObject({ q1: 1 })
      })

      it('restores the section the learner was on', async () => {
        await h.mount({ sections: 3, savedSession: {
          mode: 'practice', answers: {}, activeSectionIndex: 2, startTime: T0 - 1000,
        } })
        expect(h.lastSavedSession().activeSectionIndex).toBe(2)
      })

      it('CLAMPS a section index past the end of a changed quiz', async () => {
        // The quiz can lose a section between save and resume. An out-of-range
        // index renders nothing, which is a blank screen mid-attempt.
        await h.mount({ sections: 2, savedSession: {
          mode: 'practice', answers: {}, activeSectionIndex: 99, startTime: T0 - 1000,
        } })
        expect(h.lastSavedSession().activeSectionIndex).toBe(1)
      })

      it('submits an EXPIRED exam rather than discarding the answers', async () => {
        // The whole reason resume opts into includeExpired: a learner who
        // answered, lost connectivity and never submitted would otherwise lose
        // the attempt entirely.
        await h.mount({ savedSession: {
          mode: 'exam', answers: { q1: 1 }, activeSectionIndex: 0,
          startTime: T0 - 3_600_000, endTime: T0 - 1000, expired: true,
        } })
        await h.tick(100)
        expect(h.submittedResult()).not.toBeNull()
        expect(h.submitCount()).toBe(1)
      })
    })

    // ── Navigation ───────────────────────────────────────────────────────────

    describe('navigation', () => {
      it('cannot go back from the first section', async () => {
        await h.mount({ sections: 2 })
        await h.start('practice')
        expect(h.canGoPrev()).toBe(false)
      })

      it('offers no Next on the last section', async () => {
        await h.mount({ sections: 2 })
        await h.start('practice')
        await h.next()
        expect(h.hasNext()).toBe(false)
      })

      it('a single-section quiz has no Next at all', async () => {
        await h.mount({ sections: 1 })
        await h.start('practice')
        expect(h.hasNext()).toBe(false)
      })

      it('going back preserves the answer already given', async () => {
        await h.mount({ sections: 2 })
        await h.start('practice')
        await h.answerCurrent(1)
        await h.next()
        await h.prev()
        expect(Object.keys(h.lastSavedSession().answers)).toHaveLength(1)
      })

      it('Submit is reachable from EVERY section — a session can never dead-end', async () => {
        await h.mount({ sections: 3 })
        await h.start('practice')
        expect(h.hasSubmit()).toBe(true)
        await h.next()
        expect(h.hasSubmit()).toBe(true)
        await h.next()
        expect(h.hasSubmit()).toBe(true)
      })

      it('an unanswered question never blocks advancing', async () => {
        await h.mount({ sections: 2 })
        await h.start('practice')
        await h.next()
        expect(h.lastSavedSession().activeSectionIndex).toBe(1)
      })
    })

    // ── Submit gating ────────────────────────────────────────────────────────

    describe('submit', () => {
      it('submits once, however many times the control is pressed', async () => {
        await h.mount({})
        await h.start('practice')
        await h.answerCurrent(1)
        await h.openSubmit()
        await h.confirmSubmit()
        await h.confirmSubmit()
        expect(h.submitCount()).toBe(1)
      })

      it('submitting with nothing answered is allowed', async () => {
        await h.mount({})
        await h.start('practice')
        await h.openSubmit()
        await h.confirmSubmit()
        expect(h.submittedResult()).not.toBeNull()
      })

      it('a failed save leaves the learner able to retry', async () => {
        await h.mount({ failSubmitOnce: true })
        await h.start('practice')
        await h.answerCurrent(1)
        await h.openSubmit()
        await h.confirmSubmit()
        expect(h.submittedResult()).toBeNull()
        await h.confirmSubmit()
        expect(h.submittedResult()).not.toBeNull()
      })
    })
  })
}
