import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BoltIcon,
  ArrowPathIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { useAuth } from '../../../contexts/AuthContext'
import { useAssessmentEngineFlag } from '../../../hooks/useAssessmentEngineFlag'
import { fromGame, markAttempt, unrenderableTypes } from '../../../engines/assessment-engine'
import { ChoiceQuestion } from '../../../engines/assessment-engine/render'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { capture } from '../../../utils/analytics'
import { BUILD_ID } from '../../../utils/buildId'
import { saveScore, shuffle, readRoundBaseline, readRoundOutcome, reportGameStart } from '../services/gamesService'
import { evaluateAndAwardGameBadges } from '../../../utils/gameBadgesService'
import { getTodaysChallenge, recordDailyPlay } from '../../../utils/dailyChallengeService'
import { playCorrect, playWrong, playWin, playStreak, primeSounds } from '../lib/gameSounds'
import Leaderboard from './Leaderboard'
import BadgeToast from './BadgeToast'
import ShareButton from './ShareButton'
import Confetti from '../../../shared/components/Confetti'
import MascotCelebration from './MascotCelebration'
import MascotGreeting from './MascotGreeting'
import SmartFeedback from './SmartFeedback'
import ComboPill from './ComboPill'
import ScorePops, { useScorePops } from './ScorePops'
import { LevelUpBanner, XpProgressBar, PersonalBestBanner } from './Progress'
import { comboHeat } from '../lib/gameFeel'
import { DoneStat, SaveBanner, StreakBanner } from './DoneBanners'
import { RatingStars } from './gamesUi'
import {
  accuracyPct,
  advanceDeck,
  correctIndexFor,
  isTimerDanger,
  optionLetter,
  questionAt,
  ratingStars,
  resolveGameConfig,
  shouldCelebrate,
  timerPct,
} from '../lib/timedQuizCore'
import { EMPTY_ROUND, applyPick, roundOutcome } from '../lib/timedQuizRound'

/**
 * Engine for any `type: "timed_quiz"` game document.
 *
 * Mechanics:
 *   1. The player sees a "Ready?" splash that explains the rules.
 *   2. On start, the global timer (`game.timer` seconds) begins counting
 *      down. Questions are drawn from a shuffled deck of game.questions.
 *      When the deck runs out, it gets reshuffled — and we make sure the
 *      first question of the new deck is NOT the same as the last question
 *      of the old deck, so nothing ever feels like an immediate repeat.
 *   3. The score is points-per-correct (`game.points`) minus a small
 *      penalty for wrong answers, with a streak bonus.
 *   4. On time-up the player sees their stats, the leaderboard, and a
 *      sign-in nudge if their score wasn't saved.
 */
export default function TimedQuizGame({ game }) {
  const { points, duration } = resolveGameConfig(game)
  const pool = useMemo(() => game.questions || [], [game.questions])

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [seed, setSeed] = useState(0)
  const [deck, setDeck] = useState(() => shuffle(pool, Date.now()))
  const [pos, setPos] = useState(0)
  const [questionNo, setQuestionNo] = useState(0) // total questions seen in this round
  const [picked, setPicked] = useState(null)
  const [revealedAt, setRevealedAt] = useState(0)
  // The round's five numbers as ONE value, advanced by the shared reducer in
  // `timedQuizRound.js`. They used to be five `useState`s mutated together
  // inside `pick()`, which meant the only way to observe what a round scored
  // was to drive this component under jsdom — and §5.1's byte-compatibility
  // comparison has to produce a round outcome without a browser. Folding them
  // into one value is what lets the component and the harness run the SAME
  // arithmetic rather than two copies of it.
  const [round, setRound] = useState(EMPTY_ROUND)
  const { score, correct, wrong, streak, bestStreak } = round
  const [timeLeft, setTimeLeft] = useState(duration)
  const [saveResult, setSaveResult] = useState(null)
  const [newBadges, setNewBadges] = useState([])
  const [streakResult, setStreakResult] = useState(null)
  const [confettiKey, setConfettiKey] = useState(0)
  const [shakeAt, setShakeAt] = useState(-1) // questionNo that got a wrong answer (drives card shake)
  const [levelChange, setLevelChange] = useState(null)
  const [personalBest, setPersonalBest] = useState(null)
  const { pops, pushPop } = useScorePops()
  const startedAtRef = useRef(null)
  // Mirrors `picked`, but synchronously — see the guard in `pick()`. It is the
  // authority for "has this question been answered"; `picked` remains the
  // authority for what the card DRAWS, which is a render concern.
  const pickedRef = useRef(null)

  // ── Assessment Engine cutover (docs/phase3-plan.md §10.1 step 8) ───────────
  //
  // Games is the LAST of the three cutovers and the write-heaviest: a finished
  // round touches `scores`, `badges`, `dailyStreaks` and `learner_profiles`.
  // None of those four writes moves here. The flag selects exactly two things —
  // the CHOICE CARD and the VERDICT — and every number the four writes are
  // built from flows through `timedQuizRound.js`, which is the same code on
  // both paths. So a divergence in a written document can only come from the
  // verdict, which is what makes the replay comparison able to isolate one.
  //
  // The visible half is real and intended: the engine draws §4's single
  // vertical column with A/B/C/D badges, where this game's own card is a
  // two-column grid on desktop (D3 in §1.6, resolved to vertical). A learner in
  // the rollout sees a different answer layout; that is the cutover, not a
  // regression, and it is why the flag ramps.
  const engineFlag = useAssessmentEngineFlag('game')

  // The canonical assessment, or null when the engine path must not serve.
  //
  // Null on ANY doubt — the fallback is the known-good card. Unlike the quiz
  // cutover there is no id refusal to make: nothing the engine produces reaches
  // a written document, because `buildGameScorePayload` is built from the
  // `games` doc directly and never from the canonical model. That is deliberate
  // (D5: `scores` stores grade as a Number and subject lowercased, and every
  // games read query depends on it), and it is the reason the engine can serve
  // this runner without `persist/` being involved at all.
  const engineAssessment = useMemo(() => {
    // `resolved` gates the decision, per the hook's contract.
    if (!engineFlag.resolved || !engineFlag.engine || !game || pool.length === 0) return null
    try {
      const assessment = fromGame({ game })
      // Position IS identity for a game question (`fromGame` ids them
      // `game-q{n}` by their index in the pool), and this component looks the
      // canonical question up by the pool index of the deck slot it drew. If
      // the two lists ever differed in length, that lookup would silently mark
      // an answer against a DIFFERENT question — no throw, no red test, just a
      // learner's correct answer scored wrong. Refused structurally.
      if (assessment.questions.length !== pool.length) {
        reportClientError(new Error('canonical questions misaligned with the game pool'), 'game-engine')
        return null
      }
      // "Can this learner be shown this whole round." Every `timed_quiz` item
      // normalises to `mcq`, so this is vacuous today — kept because it is the
      // question a cutover is required to ask, and a normaliser that learns a
      // second type must not quietly start serving one nobody drew.
      if (unrenderableTypes(assessment).length > 0) return null
      // A question whose stored `answer` matches none of its options. Game
      // documents "store answers loosely" and `fromGame` reports that honestly
      // as `correctIndex: null` rather than as -1.
      //
      // The old card is no better here — `correctIndexFor` returns -1 and every
      // pick is marked wrong — so refusing does not rescue the learner. What it
      // buys is attribution: the engine never serves a round that is unwinnable
      // for a reason predating the cutover, so a report of "the new card marked
      // me wrong" is always about the new card. The corpus is also the ramp's
      // input, and a round nobody can win would depress it for the wrong reason.
      if (assessment.questions.some((q) => q.correctIndex == null)) return null
      // Per-option MEDIA, the refusal the type check cannot make because it is
      // a property of the data (the quiz cutover's fourth P2, and the open
      // question it left about the canary). Inventoried for games: a
      // `timed_quiz` option is a bare string — this card renders `{opt}`
      // directly, so an option that were an object would already throw here
      // today. The check is therefore a tripwire rather than a live refusal: it
      // is what fails FIRST if the games schema ever grows picture options,
      // instead of the engine drawing four blank-looking rows because
      // `String({…})` is '[object Object]'.
      const hasNonTextOption = pool.some((q) => (Array.isArray(q?.options) ? q.options : [])
        .some((o) => o !== null && typeof o === 'object'))
      if (hasNonTextOption) return null
      return assessment
    } catch (err) {
      reportClientError(err, 'game-engine')
      return null
    }
  }, [engineFlag.resolved, engineFlag.engine, game, pool])

  // The decision is LATCHED for the duration of a round, in ONE direction.
  //
  // Keyed on `seed` rather than on `phase`, because "Play again" goes from
  // `done` straight back to `playing` without passing through `ready` — a latch
  // re-armed on the ready card would pin a whole sitting to the first round's
  // decision. `start()` bumps the seed, so every round re-decides.
  //
  // false→true is held: a round that began before the decision landed finishes
  // on the old card, because swapping a learner onto the engine mid-question is
  // the harm. true→false is NOT held: an operator disabling the flag is an
  // emergency rollback and must reach the learners currently on the engine, who
  // are precisely the population it is for. A latch on a rollback path is
  // one-directional or it is not a latch (Codex P1 on #2336).
  const roundEngineRef = useRef(null)
  const latchedSeedRef = useRef(null)
  const roundStarted = phase !== 'ready'
  if (roundStarted && latchedSeedRef.current !== seed) {
    latchedSeedRef.current = seed
    roundEngineRef.current = engineAssessment
  } else if (!roundStarted && latchedSeedRef.current !== null) {
    latchedSeedRef.current = null
    roundEngineRef.current = null
  }
  const roundAssessment = roundStarted
    ? (engineAssessment ? roundEngineRef.current : null)
    : engineAssessment
  // The round-level hold the hook's own `latched` cannot see: this game was
  // ELIGIBLE and the engine was on, but the round had already started before
  // the decision landed. Counting it as a refusal would understate how much of
  // the games corpus the engine can serve, and the refusal rate is the number
  // the ramp decision is made on.
  const heldByRoundLatch = roundStarted && engineAssessment != null && roundAssessment == null
  const engineActive = roundAssessment != null

  // §7.2: ONE PostHog event per round, both paths, aggregate only. `engine`
  // records which card actually SERVED — a flag that said engine while
  // normalisation refused it reports false, because false is what the learner
  // saw.
  //
  // Keyed on `seed`, like the latch, so it is genuinely once per ROUND and not
  // once per mount. "Play again" starts a new round that re-decides, and a
  // report-once-per-mount ref would leave every round after the first
  // unreported — with the first round's card attributed to the whole sitting.
  const reportedSeedRef = useRef(null)
  useEffect(() => {
    // Gated on `final`, not `resolved`: under a partial rollout the hook's
    // answer is provisional during the auth watchdog window, and a once-only
    // event recorded then is permanently wrong whenever settlement overturns it.
    if (reportedSeedRef.current === seed || !engineFlag.final || !game || !roundStarted) return
    reportedSeedRef.current = seed
    capture('assessment_engine_path', {
      runner: 'game',
      engine: engineActive,
      flagSource: engineFlag.source,
      // Separates the watchdog hold (engine:false, latched:true) from a
      // normalisation refusal (engine:false, latched:false).
      latched: engineFlag.latched,
      // A dead `settings/global` subscription forces the decision closed and
      // reports the same `runner-off` source as a deliberate rollback, so
      // without this a client that lost its config feed is indistinguishable in
      // PostHog from an intentional one.
      live: engineFlag.live,
      heldByRoundLatch,
      build: BUILD_ID,
    })
  }, [engineFlag.final, engineFlag.source, engineFlag.latched, engineFlag.live,
    engineActive, heldByRoundLatch, game, roundStarted, seed])

  /**
   * Is this option correct? The verdict seam.
   *
   * On the engine path the round asks `markAttempt` and never compares inline;
   * the card paints its ✓/✗ from the same canonical `correctIndex`, so the
   * score, the highlight and the four writes cannot disagree. The old path
   * keeps `correctIndexFor`'s loose string comparison, untouched.
   */
  function isPickCorrect(poolIndex, optionIndex) {
    const engineQuestion = engineActive ? roundAssessment.questions[poolIndex] : null
    if (!engineQuestion) return optionIndex === correctIndexFor(pool[poolIndex])
    return markAttempt({
      assessment: roundAssessment,
      answers: { [engineQuestion.id]: optionIndex },
      strategy: 'clientKey',
    }).score > 0
  }

  // Countdown
  useEffect(() => {
    if (phase !== 'playing') return
    if (timeLeft <= 0) { finish(); return }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft])

  // Auto-advance after a brief reveal beat (simulates quiz feel)
  useEffect(() => {
    if (picked === null) return
    const t = setTimeout(() => {
      advanceToNextQuestion()
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedAt])

  function advanceToNextQuestion() {
    pickedRef.current = null
    setPicked(null)
    setQuestionNo((n) => n + 1)
    // Deck sequencing (reshuffle-on-exhaustion + no immediate repeat) lives
    // in timedQuizCore; the fresh seed keeps runtime shuffles varied.
    const next = advanceDeck({
      deck,
      pos,
      pool,
      shuffle,
      seed: Date.now() + Math.random() * 9999,
    })
    setDeck(next.deck)
    setPos(next.pos)
  }

  function start() {
    primeSounds()
    // Per ROUND, not per mount: "Play again" re-enters start() without
    // remounting, and saveScore() fires once per finished round.
    reportGameStart(game)
    setSeed((s) => s + 1)
    setPhase('playing')
    setDeck(shuffle(pool, Date.now()))
    setPos(0)
    setQuestionNo(0)
    pickedRef.current = null
    setPicked(null)
    setRound(EMPTY_ROUND)
    setTimeLeft(duration)
    setSaveResult(null)
    setNewBadges([])
    setStreakResult(null)
    setShakeAt(-1)
    setLevelChange(null)
    setPersonalBest(null)
    startedAtRef.current = Date.now()
  }

  function pick(i) {
    // The guard is the REF, not the state, and that is the whole point.
    //
    // `picked !== null` catches ordinary rapid clicking, because the browser
    // dispatches each click as its own task and React commits between them. It
    // does NOT catch two handlers running inside one React batch — both read
    // the pre-commit `picked === null` and both proceed. That path scored one
    // question twice before this extraction (`setScore(s => s + gained)` and
    // `setCorrect(c => c + 1)` are functional updates, so both applied and a
    // single question landed as `correct: 1` AND `wrong: 1`), and after it the
    // second write silently replaced the first. Neither is protection.
    //
    // A ref claimed synchronously before any state update is — the same idiom
    // `useAiOperationLock` uses for the same reason: "a synchronous `useRef`
    // claims the lock BEFORE any await, so a second call in the same tick is
    // refused; React `status` state alone updates too late to catch this."
    if (phase !== 'playing' || pickedRef.current !== null) return
    pickedRef.current = i
    // The verdict comes from the seam — `correctIndexFor` on the old path,
    // `markAttempt` against the canonical assessment on the engine's — and
    // everything after it is the same code either way.
    const isCorrect = isPickCorrect(poolIndexOf(currentQuestion()), i)
    const step = applyPick(round, { correct: isCorrect, points })
    setPicked(i)
    setRevealedAt(Date.now())
    setRound(step.round)
    if (isCorrect) {
      playCorrect()
      const heat = comboHeat(step.round.streak)
      if (heat.level > 0) playStreak(heat.level)
      // Drawn from the same arithmetic that scored the round, never recomputed.
      pushPop(step.gained)
    } else {
      playWrong()
      pushPop(-step.penalty)
      setShakeAt(questionNo)
    }
  }

  async function finish() {
    setPhase('done')
    // Closed through the shared function, so a live round and a replayed one
    // reach the four writes by the same road (see timedQuizRound.js).
    const outcome = roundOutcome({
      round,
      duration,
      startedAtMs: startedAtRef.current,
      nowMs: Date.now(),
    })
    const { accuracy } = outcome
    // Celebrate if they played well
    if (shouldCelebrate(outcome.score, accuracy)) {
      playWin()
      setConfettiKey((k) => k + 1)
    }
    // Snapshot progression (windowed total + all-time best for this game)
    // before saving, so level-up / personal best resolve exactly.
    const baseline = await readRoundBaseline(game.id)

    const result = await saveScore({ game, ...outcome })
    setSaveResult(result)

    // Only evaluate/award badges if the score actually saved (i.e. signed in).
    if (result?.ok) {
      try {
        const { levelChange: lc, personalBest: pb } = await readRoundOutcome({ score: outcome.score, baseline })
        if (lc) setLevelChange(lc)
        if (pb) setPersonalBest(pb)
      } catch { /* progression is non-critical */ }
      try {
        // Every one of the four writes is handed a subset of the SAME outcome
        // object, which is what makes one identical outcome the
        // byte-compatibility argument for all four rather than only for `scores`.
        const { newlyEarned } = await evaluateAndAwardGameBadges({
          game,
          score: outcome.score,
          correct: outcome.correct,
          wrong: outcome.wrong,
          accuracy: outcome.accuracy,
          bestStreak: outcome.bestStreak,
        })
        if (newlyEarned?.length) {
          setNewBadges(newlyEarned)
          playWin()
          setConfettiKey((k) => k + 1)
        }
      } catch (err) {
        console.warn('badge evaluation failed', err)
      }

      // Check if this game is today's daily challenge — if so, bump streak.
      try {
        const { game: todaysGame } = await getTodaysChallenge()
        if (todaysGame?.id) {
          const streakOutcome = await recordDailyPlay({
            gameId: game.id,
            dailyGameId: todaysGame.id,
          })
          if (streakOutcome.isDaily) setStreakResult(streakOutcome)
        }
      } catch (err) {
        console.warn('daily streak update failed', err)
      }
    }
  }

  if (phase === 'ready') return <ReadyCard game={game} onStart={start} />
  if (phase === 'done') {
    const accuracy = accuracyPct(correct, wrong)
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={score}
          correct={correct}
          wrong={wrong}
          accuracy={accuracy}
          bestStreak={bestStreak}
          saveResult={saveResult}
          newBadges={newBadges}
          streakResult={streakResult}
          levelChange={levelChange}
          personalBest={personalBest}
          onRestart={start}
        />
      </>
    )
  }

  const q = currentQuestion()
  const poolIndex = poolIndexOf(q)
  const engineQuestion = engineActive ? roundAssessment.questions[poolIndex] : null
  const correctIdx = correctIndexFor(q)
  const pct = timerPct(timeLeft, duration)

  return (
    <div className="space-y-5">
      <TimerBar timeLeft={timeLeft} pct={pct} />

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="relative">
          <Pill label="Score" value={score} tone="amber" />
          <ScorePops pops={pops} />
        </div>
        <ComboPill streak={streak} />
        <Pill label="Wrong"  value={wrong}   tone="rose" />
      </div>

      <div
        key={`card-${seed}-${questionNo}-${shakeAt === questionNo ? 'w' : 'q'}`}
        className={`zx-card rounded-[22px] bg-white p-6 sm:p-8 ${shakeAt === questionNo ? 'zx-shake' : ''}`}
        style={shakeAt === questionNo ? undefined : { animation: 'zx-question-in 0.3s ease-out both' }}
      >
        <p className="zx-eyebrow mb-3">Question #{questionNo + 1}</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold leading-tight mb-6 text-slate-900">
          {q.question}
        </h2>
        {engineQuestion ? (
          // §4's layout contract: one vertical column of full-width rows with
          // A/B/C/D badges. The game's own two-column grid below is D3, and
          // this is the resolved side of it.
          <div key={`engine-${seed}-${questionNo}`}>
            <ChoiceQuestion
              question={engineQuestion}
              answer={picked}
              revealed={picked !== null}
              onAnswer={(optionIndex) => pick(optionIndex)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" key={`${seed}-${questionNo}`}>
            {q.options.map((opt, i) => (
              <Choice
                key={`${seed}-${questionNo}-${i}`}
                label={opt}
                letter={optionLetter(i)}
                picked={picked}
                isPicked={picked === i}
                isAnswer={correctIdx === i}
                onClick={() => pick(i)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={finish}
          className="text-sm font-bold text-slate-500 hover:text-slate-900 underline"
        >
          End round early
        </button>
      </div>
    </div>
  )

  function currentQuestion() {
    return questionAt(deck, pos)
  }

  /**
   * Where the drawn question sits in the POOL — which is the canonical
   * question's identity (`fromGame` ids them `game-q{n}` by pool position).
   *
   * `shuffle` reorders the same object references, so this is exact rather than
   * a content match. A deck slot that fell back to `EMPTY_QUESTION` is not in
   * the pool and yields -1, which both verdict paths already treat as "nothing
   * is correct here" — the same answer they gave before this cutover.
   */
  function poolIndexOf(question) {
    return pool.indexOf(question)
  }
}

/* ── Sub-components ─────────────────────────────────────────────── */

function ReadyCard({ game, onStart }) {
  const { currentUser } = useAuth()
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 sm:p-10 text-center">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-orange-100 text-slate-900">
        <BoltIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display text-3xl font-bold mb-2 mt-4 text-slate-900">{game.title}</h2>
      <p className="text-slate-700 max-w-md mx-auto mb-6">
        {game.description}
      </p>
      <ul className="text-sm text-slate-700 max-w-sm mx-auto text-left mb-7 space-y-1.5">
        <li><b>{game.timer}s</b> on the clock</li>
        <li><b>+{game.points}</b> per correct answer, plus streak bonus points</li>
        <li>Small penalties apply for wrong answers</li>
        {currentUser
          ? <li>Your score saves automatically to the leaderboard</li>
          : <li>Sign in to save your score and climb the leaderboard</li>}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <BoltIcon className="h-4 w-4" />
        Start sprint
      </button>
      <p className="mt-5 text-xs text-slate-500">Tip: tap the answer or use the A / B / C / D keys.</p>
    </div>
  )
}

function DoneCard({ game, score, correct, wrong, accuracy, bestStreak, saveResult, newBadges, streakResult, levelChange, personalBest, onRestart }) {
  return (
    <div className="space-y-5">
      {levelChange?.leveledUp && <LevelUpBanner change={levelChange} />}
      {personalBest?.isBest && <PersonalBestBanner personalBest={personalBest} />}
      {streakResult?.isDaily && <StreakBanner result={streakResult} />}
      {newBadges?.length > 0 && <BadgeToast badges={newBadges} />}

      <div className="zx-card rounded-[22px] bg-white p-8 text-center">
        <MascotCelebration game={game} accuracy={accuracy} score={score} />
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-slate-900 text-white">
          <TrophyIcon className="h-8 w-8 text-amber-300" />
        </span>
        <h2 className="font-display text-3xl font-bold mb-1 mt-4 text-slate-900">{score} pts</h2>
        <p className="text-slate-600 mb-6">Final score</p>
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-6">
          <DoneStat label="Correct" value={correct} tone="emerald" />
          <DoneStat label="Accuracy" value={`${accuracy}%`} tone="amber" />
          <DoneStat label="Best streak" value={bestStreak} tone="rose" />
        </div>
        <div className="mb-4 flex justify-center">
          <RatingStars filled={ratingStars(accuracy)} />
        </div>
        <SaveBanner saveResult={saveResult} />
        {levelChange?.after && (
          <div className="mt-4"><XpProgressBar progress={levelChange.after} gained={score} /></div>
        )}
        <SmartFeedback
          game={game}
          result={{ score, accuracy, correct, wrong, bestStreak }}
          saveResult={saveResult}
        />
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <button
            type="button"
            onClick={onRestart}
            className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Play again
          </button>
          <ShareButton game={game} score={score} accuracy={accuracy} bestStreak={bestStreak} />
          <Link
            to={`/games/g/${game.grade}/${game.subject}`}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-4 py-2.5 text-sm"
          >
            More {game.subject} games
          </Link>
        </div>
      </div>

      <Leaderboard gameId={game.id} />
    </div>
  )
}

function TimerBar({ timeLeft, pct }) {
  const danger = isTimerDanger(timeLeft)
  return (
    <div className="zx-card-dark flex items-center gap-3 rounded-[22px] px-4 py-3">
      <div className="flex-1 h-3 rounded-full bg-white/15 overflow-hidden border border-white/10">
        <div
          className={`h-full transition-all ${danger ? 'bg-rose-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`w-16 text-center font-display font-bold text-2xl tabular-nums ${danger ? 'text-rose-300 animate-timer-urgent' : 'text-white'}`}>
        {timeLeft}s
      </div>
    </div>
  )
}

const PILL_TONE = {
  emerald: 'bg-emerald-100',
  amber:   'bg-amber-100',
  rose:    'bg-rose-100',
  slate:   'bg-slate-100',
}

function Pill({ label, value, tone = 'slate' }) {
  return (
    <div className={`zx-card rounded-[14px] px-3 py-2 text-center text-slate-900 ${PILL_TONE[tone]}`}>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="font-display text-xl font-bold leading-none mt-1">{value}</div>
    </div>
  )
}

function Choice({ label, letter, picked, isPicked, isAnswer, onClick }) {
  let cls = 'bg-white text-slate-900'
  let pop = ''
  if (picked !== null) {
    if (isAnswer) { cls = 'bg-emerald-100 text-emerald-900'; pop = 'zx-correct-pop' }
    else if (isPicked) cls = 'bg-rose-100 text-rose-900'
    else cls = 'bg-slate-50 text-slate-500 opacity-70'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={picked !== null}
      className={`zx-card w-full flex items-center gap-3 text-left p-4 rounded-[14px] font-bold text-lg transition active:translate-y-[2px] active:shadow-none ${cls} ${pop}`}
    >
      <span className="shrink-0 w-9 h-9 rounded-[10px] border-2 border-slate-900 bg-white flex items-center justify-center font-black text-slate-900">
        {letter}
      </span>
      <span className="flex-1 leading-tight">{label}</span>
    </button>
  )
}
