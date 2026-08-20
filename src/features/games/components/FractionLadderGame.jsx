/**
 * FractionLadderGame — the `fraction_ladder` engine.
 *
 * Not a fraction quiz: a learning path. A learner sees a picture, names what
 * it shows, is told which mistake they made when they are wrong, walks the
 * working a step at a time, does the SAME question again unaided, and only
 * then moves on. Fractions → level → stage → question, and everything but the
 * shape of the screen is data.
 *
 * Ported from four prototypes in docs/learner/ — zedexams-fractions-level1,
 * -fraction-levels, -maths-notation and -maths-game — and the rules each one
 * argues for are the ones this engine holds to:
 *
 *   PICTURES BEFORE THE SYMBOL. The first stage of level 1 has no written
 *   fraction in any question, caption or option; the symbol appears in the
 *   feedback after a correct answer and nowhere else. That is a content rule
 *   `test:fraction-content` fails the build on, not a convention.
 *
 *   THE LADDER GATES ON PREREQUISITES, NEVER ON STARS. A level opens when the
 *   one before it is passed and every level it names is passed; a locked level
 *   NAMES what opens it. A learner who scrapes one star still moves on.
 *
 *   A WRONG ANSWER HAS A NAME. The question's own misconception list answers
 *   "1/2 + 1/4 = 2/6" with "you added the bottoms too" instead of a red cross.
 *
 *   SEEING A SOLUTION IS NOT LEARNING ONE. The retry after the working counts
 *   as RECOVERY, not mastery — three first-try corrects in three separate
 *   sessions is mastery, and `fractionProgressCore` is where that lives.
 *
 * The state machine is `fractionStageMachine`, and it is a module because the
 * states that must not exist — submitting twice, retrying with the answer on
 * screen, advancing before the stage is saved — are simply not in its table.
 *
 * Progress is per DEVICE (localStorage, like the spelling pool and the Number
 * Path level path): mastery counts sessions and there is no server-side
 * per-skill model to hang it on. Score, XP and badges stay the server-backed
 * truth through `useGameFinish`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useGameFinish } from '../hooks/useGameFinish'
import { reportGameStart } from '../services/gamesService'
import { playCorrect, playWrong, playWin, primeSounds } from '../lib/gameSounds'
import { BadgePop, GameTopBar, WinScreen, buildSaveNote } from './protoGameChrome'
import { readJson, writeJson } from '../../../shared/utils/safeStorage'
import { Frac } from '../../../shared/components/Fraction'
import FractionVisual from './FractionVisual'
import FractionAnswerPad, { emptyEntry, firstField, padShape } from './FractionAnswerPad'
import FractionWorking, { MathLine } from './FractionWorking'
import {
  FRACTION_LEVELS,
  answerGain,
  blockerText,
  levelById,
  levelState,
} from '../lib/fractionLadderCore'
import {
  COMPARE_SYMBOLS,
  MISCONCEPTION_CODES,
  hasWorking,
  workingSteps,
} from '../lib/fractionQuestionCore'
import {
  clearResume,
  composeStage,
  globalStageOrdinal,
  levelPassed,
  levelStars,
  masteryState,
  nextStageNumber,
  passedLevels,
  readProgress,
  recordCorrect,
  recordMiss,
  recordRecovery,
  recordStage,
  resumable,
  reviewList,
  skillEntry,
  snapshotStage,
  stageDone,
  stagesForLevel,
  starsFor,
  starsForStage,
  totalStars,
} from '../lib/fractionProgressCore'
import * as machine from '../lib/fractionStageMachine'

const progressKey = (gameId) => `zedexams:fraction-ladder:${gameId || 'default'}`

/* ── the ladder ────────────────────────────────────────────────────── */

function Stars({ earned, of = 3 }) {
  return (
    <span className="lhx-fl-stars" aria-label={`${earned} of ${of} stars`}>
      <span aria-hidden="true">{'★'.repeat(earned)}{'☆'.repeat(Math.max(0, of - earned))}</span>
    </span>
  )
}

function LadderScreen({ game, progress, onPick, onExit, onReview }) {
  const passed = passedLevels(progress, game)
  const stars = totalStars(progress, game)
  const review = reviewList(progress.pool)

  const groups = []
  for (const level of FRACTION_LEVELS) {
    if (!groups.length || groups[groups.length - 1].name !== level.group) {
      groups.push({ name: level.group, levels: [] })
    }
    groups[groups.length - 1].levels.push(level)
  }

  return (
    <>
      <div className="lhx-nt-head">
        <div className="lhx-nt-top">
          <button type="button" className="lhx-nt-x" aria-label="Leave the game" onClick={onExit}>✕</button>
          <div className="lhx-nt-title">{game?.title || 'Fraction Ladder'}</div>
        </div>
        <div className="lhx-nt-best">
          {passed.length} of {FRACTION_LEVELS.length} levels passed · ⭐ {stars.earned} / {stars.possible}
        </div>
      </div>

      {review.length > 0 && (
        <button type="button" className="lhx-fl-review" onClick={onReview}>
          <span className="lhx-fl-review-t">
            📌 {review.length} {review.length === 1 ? 'thing' : 'things'} to come back to
          </span>
          <span className="lhx-fl-review-s">They turn up again inside the stages. Tap to see them.</span>
        </button>
      )}

      <div className="lhx-fl-ladder">
        {groups.map((group) => (
          <div key={group.name}>
            <div className="lhx-fl-group">{group.name}</div>
            {group.levels.map((level) => {
              const state = levelState(level.id, passed)
              const stages = stagesForLevel(game, level.id)
              const playable = state.state !== 'locked' && stages.length > 0
              const earned = levelStars(progress, game, level.id)
              const doneCount = stages.filter((s) => stageDone(progress, level.id, s.number)).length
              // The lock reason sits inside the button, so it lands in the
              // button's accessible name by default — and an explicit label
              // keeps the level's own identity first.
              const label = `Level ${level.order}: ${level.name}`
                + (state.state === 'done' ? ', passed' : '')
                + (state.state === 'locked' ? `, locked — opens after ${blockerText(state.blockers)}` : '')
                + (state.state !== 'locked' && !stages.length ? ', no questions in this pack yet' : '')
                + (playable && stages.length ? `, ${doneCount} of ${stages.length} stages done` : '')
              return (
                <button
                  key={level.id}
                  type="button"
                  className={`lhx-fl-level is-${state.state}`}
                  aria-label={label}
                  disabled={!playable}
                  onClick={() => onPick(level.id)}
                >
                  <span className={`lhx-fl-badge is-${state.state}`} aria-hidden="true">
                    {state.state === 'done' ? '✓' : state.state === 'locked' ? '🔒' : level.order}
                  </span>
                  <span className="lhx-fl-text">
                    <b>{level.name}</b>
                    <small>{level.blurb}</small>
                    {state.state === 'locked' && (
                      <em className="lhx-fl-why">Opens after {blockerText(state.blockers)}</em>
                    )}
                    {state.state !== 'locked' && !stages.length && (
                      <em className="lhx-fl-why">No questions in this pack yet</em>
                    )}
                  </span>
                  {playable && stages.length > 0 && (
                    <span className="lhx-fl-rt" aria-hidden="true">
                      <Stars earned={Math.round((earned.earned / Math.max(1, earned.possible)) * 3)} />
                      <span className="lhx-fl-cnt">{doneCount}/{stages.length} stages</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

/* ── inside a level ────────────────────────────────────────────────── */

function LevelScreen({ game, levelId, progress, onPlay, onBack }) {
  const level = levelById(levelId)
  const stages = stagesForLevel(game, levelId)
  const doneCount = stages.filter((s) => stageDone(progress, levelId, s.number)).length
  const next = nextStageNumber(progress, game, levelId)

  return (
    <>
      <div className="lhx-nt-head">
        <div className="lhx-nt-top">
          <button type="button" className="lhx-nt-x" aria-label="Back to the levels" onClick={onBack}>‹</button>
          <div className="lhx-nt-title">Level {level.order}</div>
        </div>
        <div className="lhx-nt-best">{doneCount} of {stages.length} stages done</div>
      </div>

      <div className="lhx-fl-levelcard">
        <h2>{level.name}</h2>
        <p>{level.blurb}</p>
        <div className="lhx-fl-bar" aria-hidden="true">
          <i style={{ width: `${(doneCount / Math.max(1, stages.length)) * 100}%` }} />
        </div>
      </div>

      <ol className="lhx-fl-stages">
        {stages.map((stage) => {
          const done = stageDone(progress, levelId, stage.number)
          const stars = starsFor(progress, levelId, stage.number)
          const isNext = stage.number === next
          return (
            <li key={stage.number}>
              <button
                type="button"
                className={`lhx-fl-stage ${done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}`.trim()}
                aria-label={`Stage ${stage.number}: ${stage.title}. ${done ? `Done, ${stars} of 3 stars. Play it again` : 'Not played yet'}`}
                onClick={() => onPlay(stage.number)}
              >
                <span className={`lhx-fl-sd ${done ? 'is-d' : isNext ? 'is-n' : 'is-l'}`} aria-hidden="true">
                  {done ? '✓' : stage.number}
                </span>
                <span className="lhx-fl-text">
                  <b>{stage.title}</b>
                  <small>{stage.blurb || `${stage.questions.length} questions`}</small>
                </span>
                {done && <Stars earned={stars} />}
              </button>
            </li>
          )
        })}
      </ol>

      {/* Every stage stays replayable, at every level, for ever. A replay can
          raise a star count and can never add a second reward — `recordStage`
          keeps the best and is idempotent, which is why the guard is there and
          not here. */}
      <button type="button" className="lhx-fl-check" onClick={() => onPlay(next)}>
        {doneCount >= stages.length ? 'Play stage 1 again ▸' : `Play stage ${next} ▸`}
      </button>
    </>
  )
}

/* ── the review list ───────────────────────────────────────────────── */

const STATE_WORDS = {
  needs_review: 'Missed — coming back',
  recovering: 'Got it with help — coming back',
  learning: 'Getting there',
  mastered: 'Learnt',
  new: 'Not met yet',
}

function ReviewScreen({ progress, onBack }) {
  const list = reviewList(progress.pool)
  return (
    <>
      <div className="lhx-nt-head">
        <div className="lhx-nt-top">
          <button type="button" className="lhx-nt-x" aria-label="Back to the levels" onClick={onBack}>‹</button>
          <div className="lhx-nt-title">Coming back for you</div>
        </div>
        <div className="lhx-nt-best">These turn up again inside your next stages.</div>
      </div>
      <ul className="lhx-fl-reviewlist">
        {list.map((item) => {
          const entry = skillEntry(progress.pool, item.skill)
          return (
            <li key={item.skill} className="lhx-fl-reviewrow">
              <div className="lhx-fl-reviewrow-t">{skillLabel(item.skill)}</div>
              <div className="lhx-fl-reviewrow-s">
                {STATE_WORDS[masteryState(entry)]}
                {item.code && MISCONCEPTION_CODES[item.code] ? ` · ${MISCONCEPTION_CODES[item.code].toLowerCase()}` : ''}
              </div>
            </li>
          )
        })}
        {!list.length && <li className="lhx-fl-reviewrow"><div className="lhx-fl-reviewrow-t">Nothing waiting. Good.</div></li>}
      </ul>
    </>
  )
}

/** "add-same-denominator" → "Add same denominator". The skill id IS the label. */
function skillLabel(skill) {
  const words = String(skill).replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/* ── one question ──────────────────────────────────────────────────── */

function ChoiceOptions({ question, chosen, locked, correct, onPick }) {
  const pictorial = (question.options || []).some((o) => o.visual)
  return (
    <div className={pictorial ? 'lhx-fl-picopts' : 'lhx-fl-opts'}>
      {(question.options || []).map((option) => {
        const picked = chosen === option.id
        const isAnswer = option.id === question.answer
        // Once the question is settled the right one is shown — but only then,
        // and never in the retry, where `locked` is false and nothing is marked.
        const cls = locked
          ? (picked && !correct ? 'is-no' : isAnswer ? 'is-ok' : '')
          : (picked ? 'is-picked' : '')
        return (
          <button
            key={option.id}
            type="button"
            className={`${pictorial ? 'lhx-fl-po' : 'lhx-fl-opt'} ${cls}`.trim()}
            disabled={locked}
            aria-pressed={picked}
            onClick={() => onPick(option.id)}
          >
            {option.visual && <FractionVisual visual={option.visual} size="sm" />}
            {option.fraction && <Frac n={option.fraction.n} d={option.fraction.d} size="lg" />}
            {option.label && <span className="lhx-fl-optlab">{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

function CompareOptions({ question, chosen, locked, correct, onPick }) {
  const [left, right] = question.pair || []
  return (
    <>
      <div className="lhx-fl-compare">
        {left && <Frac n={left.n} d={left.d} size="lg" />}
        <span className="lhx-fl-compare-slot" aria-hidden="true">{chosen || '?'}</span>
        {right && <Frac n={right.n} d={right.d} size="lg" />}
      </div>
      <div className="lhx-fl-opts is-row">
        {COMPARE_SYMBOLS.map((symbol) => {
          const picked = chosen === symbol
          const isAnswer = symbol === question.answer
          const cls = locked
            ? (picked && !correct ? 'is-no' : isAnswer ? 'is-ok' : '')
            : (picked ? 'is-picked' : '')
          return (
            <button
              key={symbol}
              type="button"
              className={`lhx-fl-opt is-sym ${cls}`.trim()}
              disabled={locked}
              aria-label={symbol === '>' ? 'is bigger than' : symbol === '<' ? 'is smaller than' : 'is the same as'}
              onClick={() => onPick(symbol)}
            >
              <span aria-hidden="true">{symbol}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function OrderOptions({ question, chosen, locked, onPick, onClear }) {
  const order = chosen || []
  return (
    <>
      <div className="lhx-fl-orderslots" aria-live="polite">
        {order.length
          ? order.map((id, index) => {
            const option = question.options.find((o) => String(o.id) === String(id))
            return (
              <span key={id} className="lhx-fl-orderslot">
                <span className="lhx-fl-ordern" aria-hidden="true">{index + 1}</span>
                {option?.fraction && <Frac n={option.fraction.n} d={option.fraction.d} />}
              </span>
            )
          })
          : <span className="lhx-fl-orderempty">Tap them in order below.</span>}
      </div>
      <div className="lhx-fl-opts is-row">
        {question.options.map((option) => {
          const at = order.indexOf(String(option.id))
          return (
            <button
              key={option.id}
              type="button"
              className={`lhx-fl-opt is-tile ${at >= 0 ? 'is-picked' : ''}`.trim()}
              disabled={locked || at >= 0}
              onClick={() => onPick(option.id)}
            >
              <Frac n={option.fraction.n} d={option.fraction.d} size="lg" />
            </button>
          )
        })}
      </div>
      {!locked && order.length > 0 && (
        <button type="button" className="lhx-fl-clear" onClick={onClear}>Start the order again</button>
      )}
    </>
  )
}

/**
 * What a correct answer reveals. This is the ONE place a written fraction
 * appears in the first stage of level 1 — the child has met the picture and
 * said the name, and now they are shown how it is written.
 */
function Reveal({ reveal }) {
  if (!reveal) return null
  return (
    <div className="lhx-fl-reveal">
      <Frac n={reveal.n} d={reveal.d} size="lg" />
      {reveal.also && (
        <>
          <span className="lhx-fl-eq" aria-label="is the same as">=</span>
          <Frac n={reveal.also.n} d={reveal.also.d} size="lg" />
        </>
      )}
    </div>
  )
}

/* ── the playable stage ────────────────────────────────────────────── */

/**
 * A fresh answer draft for one question, stamped with what it belongs to.
 * A tapped type starts as an empty list, a written one as an empty pad.
 */
function blankDraft(question, stamp) {
  const type = question?.type
  return {
    stamp,
    chosen: type === 'shade' || type === 'select' || type === 'order' ? [] : null,
    entry: emptyEntry(question || {}),
    field: firstField(padShape(question || {})),
  }
}

function StageScreen({ game, levelId, stageNumber, progress, session, onExit, onFinish }) {
  const composed = useMemo(
    () => composeStage({ game, levelId, stageNumber, pool: progress.pool, salt: game?.id || 'default' }),
    // The stage is composed ONCE per mount, deliberately: recomposing as the
    // pool changes mid-stage would swap the questions under the learner's feet
    // the moment they got one wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game?.id, levelId, stageNumber],
  )
  const questions = composed.questions
  const stage = composed.stage
  const ordinal = useMemo(
    () => globalStageOrdinal(game, levelId, stageNumber),
    [game, levelId, stageNumber],
  )

  const resume = progress.resume
  const canResume = resume
    && resume.levelId === levelId
    && Number(resume.stageNumber) === Number(stageNumber)
    && resume.answered.length < questions.length

  const [state, setState] = useState(() => {
    const base = machine.initialState({ intro: !canResume, total: questions.length })
    if (!canResume) return base
    // Resuming replays neither the questions nor the rewards: the answered
    // list and the score come back from the snapshot, and the index with them.
    return {
      ...base,
      phase: 'asking',
      index: Math.min(resume.answered.length, questions.length - 1),
      answered: resume.answered.map((a, i) => ({ index: i, correct: a.correct, firstTry: a.firstTry })),
      score: resume.score,
    }
  })
  const question = questions[state.index]
  const steps = useMemo(() => workingSteps(question || {}), [question])

  const poolRef = useRef(progress.pool)

  /**
   * What the learner has entered, STAMPED with what they entered it for.
   *
   * This was three pieces of state cleared by an effect on the question index,
   * and it was wrong twice. An effect runs AFTER the render, so the first frame
   * of a new question still held the previous one's answer — a choice id
   * arriving at a shading picture, which expects a list of regions. And the
   * RETRY does not change the index at all, so the pad came back still holding
   * the wrong answer the learner had just been shown the working for, which is
   * exactly the help the retry exists to remove.
   *
   * Stamping and deriving fixes both by construction: a draft belongs to one
   * question and one attempt, and anything else reads as blank on the render
   * it happens, not one frame later.
   */
  const stamp = `${state.index}:${state.phase === 'retrying' ? 'retry' : 'first'}`
  const [draft, setDraft] = useState(() => blankDraft(question, stamp))
  const live = draft.stamp === stamp ? draft : blankDraft(question, stamp)
  const { chosen, entry, field } = live
  const setChosen = (next) => setDraft({
    ...live,
    chosen: typeof next === 'function' ? next(live.chosen) : next,
    stamp,
  })

  const persist = useCallback((nextState, pool) => {
    onFinish.snapshot({
      levelId,
      stageNumber,
      index: nextState.index,
      answered: nextState.answered.map((a) => ({ id: questions[a.index]?.id, correct: a.correct, firstTry: a.firstTry })),
      score: nextState.score,
      session,
      pool,
    })
  }, [levelId, stageNumber, questions, session, onFinish])

  /**
   * Submit one response.
   *
   * `given` is passed by the tap-to-answer types (a choice IS its own submit —
   * one tap, not tap-then-confirm), because `chosen` state set in the same
   * event has not applied yet. The written and tapped-region types pass
   * nothing and are read from state, since their Check button is a second act.
   */
  const check = (given) => {
    if (!machine.canSubmit(state) || !question) return
    const response = given !== undefined
      ? given
      : (question.type === 'write' ? entry : chosen)
    const result = machine.submit(state, question, response, {
      pointsFor: ({ firstTry }) => (firstTry ? answerGain(1) : Math.round(answerGain(1) / 2)),
    })
    setState(result.state)
    if (!result.outcome) return

    // The skill pool moves HERE, on the outcome, once. A miss is recorded on
    // the wrong answer rather than when the question finally resolves, so a
    // reload in between cannot lose it.
    let pool = poolRef.current
    if (result.outcome.correct && result.outcome.firstTry) {
      pool = recordCorrect(pool, question.skill, { session, stage: ordinal, at: Date.now() })
      playCorrect()
    } else if (result.outcome.recovery) {
      pool = recordRecovery(pool, question.skill, { stage: ordinal, at: Date.now() })
      playCorrect()
    } else {
      pool = recordMiss(pool, question.skill, { stage: ordinal, code: result.outcome.misconception, at: Date.now() })
      playWrong()
    }
    poolRef.current = pool
    persist(result.state, pool)
  }

  const advance = () => {
    const nextState = machine.next(state)
    setState(nextState)
    if (nextState.phase === 'complete') {
      const summary = machine.tally(nextState)
      onFinish.complete({
        levelId,
        stageNumber,
        stars: starsForStage(summary.firstTry, summary.total),
        summary,
        score: nextState.score,
        pool: poolRef.current,
        reviewIds: composed.review,
      })
    } else {
      persist(nextState, poolRef.current)
    }
  }

  if (!question && state.phase !== 'complete') {
    return <div className="lhx-fl-empty">This stage has no questions yet.</div>
  }

  if (state.phase === 'intro') {
    return (
      <>
        <div className="lhx-nt-head">
          <div className="lhx-nt-top">
            <button type="button" className="lhx-nt-x" aria-label="Leave the stage" onClick={onExit}>✕</button>
            <div className="lhx-nt-title">{stage?.title || `Stage ${stageNumber}`}</div>
          </div>
        </div>
        <div className="lhx-fl-intro">
          <div className="lhx-fl-intro-n" aria-hidden="true">{stageNumber}</div>
          <h2>{stage?.title}</h2>
          <p>{stage?.blurb}</p>
          {composed.review.length > 0 && (
            <p className="lhx-fl-intro-rev">
              📌 {composed.review.length} {composed.review.length === 1 ? 'question' : 'questions'} you missed before
              {' '}will come up in here again.
            </p>
          )}
          <p className="lhx-fl-intro-count">{questions.length} questions · no timer</p>
        </div>
        <button type="button" className="lhx-fl-check" onClick={() => setState(machine.begin(state))}>Start ▸</button>
      </>
    )
  }

  if (machine.showsWorking(state)) {
    return (
      <>
        <div className="lhx-nt-head">
          <GameTopBar onExit={onExit} done={state.answered.length} total={questions.length} score={state.score} />
        </div>
        <FractionWorking
          question={question}
          steps={steps}
          revealed={state.revealed}
          onReveal={() => setState(machine.revealStep(state, steps.length))}
          onRetry={() => setState(machine.startRetry(state))}
        />
      </>
    )
  }

  const retrying = state.phase === 'retrying'
  const settled = machine.isSettled(state)
  const verdict = state.verdict
  const isWrite = question.type === 'write'
  const answerState = settled ? (verdict?.correct ? 'ok' : 'no') : null
  const tappable = question.type === 'shade' || question.type === 'select'
  // A naming round is the one shape that reads picture-first.
  const promptFirst = !(question.type === 'choice' && question.visual)

  /**
   * The picture, wherever it sits. `chosen` is passed for a tappable question
   * even once it is settled, so the learner's own shading stays on the screen
   * while they are being told about it; `interactive` decides only whether the
   * regions are still buttons.
   */
  function Picture() {
    return (
      <>
        {question.visual && (
          <FractionVisual
            visual={question.visual}
            interactive={tappable && !settled}
            chosen={tappable ? (chosen || []) : null}
            onToggle={(index) => {
              if (settled) return
              setChosen((current) => {
                const list = current || []
                return list.includes(index) ? list.filter((i) => i !== index) : [...list, index]
              })
            }}
            caption={question.caption}
          />
        )}
        {question.fraction && (
          <div className="lhx-fl-shown"><Frac n={question.fraction.n} d={question.fraction.d} size="lg" /></div>
        )}
        {question.compare && (
          <div className="lhx-fl-sidebyside">
            {question.compare.map((side, index) => (
              <div key={index} className="lhx-fl-side">
                <FractionVisual visual={side.visual} size="sm" />
                {side.fraction && <Frac n={side.fraction.n} d={side.fraction.d} />}
              </div>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} done={state.answered.length} total={questions.length} score={state.score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">{(stage?.title || levelById(levelId)?.name || '').toUpperCase()}</div>
        </div>
        <div className="lhx-nt-best">
          Question {state.index + 1} of {questions.length}
          {composed.review.includes(question.id) && ' · one you missed before'}
        </div>
      </div>

      {retrying && (
        <div className="lhx-fl-retry" role="status">
          Your turn — no help this time.
        </div>
      )}

      {/* From 900px the question and the answer sit side by side rather than a
          scroll apart, so the picture stays on screen while the pad is used.
          Below that the grid collapses and this is one ordinary column. */}
      <div className="lhx-fl-play">
      <div className="lhx-fl-card">
        {question.kicker && !retrying && <div className="lhx-fl-kick">{question.kicker}</div>}

        {/* WHERE THE QUESTION SITS DEPENDS ON WHAT IT ASKS.
            "See it, then name it" is the whole order of level 1 (§4), so a
            naming round shows the picture, says what it is, and only then asks
            — the child meets the thing before the question about it. A round
            that asks the learner to DO something is an instruction, and an
            instruction printed under the thing it is about is read second. */}
        {!promptFirst && <Picture />}
        <div className="lhx-fl-q"><MathLine text={question.prompt} /></div>
        {promptFirst && <Picture />}
        {!question.visual && question.caption && <p className="lhx-fl-cap">{question.caption}</p>}
      </div>

      {question.type === 'choice' && (
        <ChoiceOptions
          question={question}
          chosen={chosen}
          locked={settled}
          correct={!!verdict?.correct}
          onPick={(id) => { setChosen(id); check(id) }}
        />
      )}
      {question.type === 'compare' && (
        <CompareOptions
          question={question}
          chosen={chosen}
          locked={settled}
          correct={!!verdict?.correct}
          onPick={(symbol) => { setChosen(symbol); check(symbol) }}
        />
      )}
      {question.type === 'order' && (
        <>
          <OrderOptions
            question={question}
            chosen={chosen}
            locked={settled}
            onPick={(id) => setChosen((current) => [...(current || []), String(id)])}
            onClear={() => setChosen([])}
          />
          {!settled && (
            <button
              type="button"
              className="lhx-fl-check"
              disabled={(chosen || []).length < question.options.length}
              onClick={() => check()}
            >
              Check my answer
            </button>
          )}
        </>
      )}
      {(question.type === 'shade' || question.type === 'select') && !settled && (
        <button
          type="button"
          className="lhx-fl-check"
          disabled={!(chosen || []).length}
          onClick={() => check()}
        >
          Check my answer
        </button>
      )}
      {isWrite && (
        <FractionAnswerPad
          question={question}
          entry={entry}
          field={field}
          onChange={({ entry: nextEntry, field: nextField }) => setDraft({ ...live, entry: nextEntry, field: nextField, stamp })}
          onFocusField={(next) => setDraft({ ...live, field: next, stamp })}
          onCheck={() => check()}
          disabled={settled}
          state={answerState}
        />
      )}

      </div>

      <div className="lhx-fl-feedback" aria-live="polite">
        {verdict && (
          <div className={`lhx-fl-fb ${verdict.correct ? 'is-ok' : 'is-no'}`}>
            <div className="lhx-fl-fb-title">
              <span aria-hidden="true">{verdict.correct ? '✓' : '✗'}</span>
              <span>{verdict.headline}</span>
            </div>
            {verdict.body && <div><MathLine text={verdict.body} /></div>}
            {verdict.correct && !retrying && <Reveal reveal={question.reveal} />}
            {verdict.correct && state.phase === 'recovered' && (
              <div className="lhx-fl-fb-note">
                This one goes on your practice list — it will come back later with no help.
              </div>
            )}
          </div>
        )}
      </div>

      {settled && (
        <div className="lhx-fl-actions">
          {state.phase === 'wrong' && hasWorking(question) && (
            <button
              type="button"
              className="lhx-fl-check"
              onClick={() => setState(machine.openWorking(state, question))}
            >
              📝 Show me the working
            </button>
          )}
          {state.phase === 'wrong' && (
            <button
              type="button"
              className="lhx-fl-ghost"
              onClick={() => { const next = machine.skip(state); setState(next); }}
            >
              {hasWorking(question) ? 'Skip — I see it' : 'I see it'}
            </button>
          )}
          {state.phase !== 'wrong' && (
            <button type="button" className="lhx-fl-check" onClick={advance}>
              {state.index + 1 >= questions.length ? 'Finish the stage ▸' : 'Next question ▸'}
            </button>
          )}
        </div>
      )}
    </>
  )

}

/* ── stage complete ────────────────────────────────────────────────── */

function StageDoneScreen({ outcome, saveNote, onContinue, onReplay }) {
  const { summary, stars } = outcome
  return (
    <WinScreen
      stars={stars}
      title={stars >= 3 ? 'Stage cleared!' : stars ? 'Stage done' : 'Have another go'}
      sub={`${summary.firstTry} of ${summary.total} right first time${summary.recovered ? ` · ${summary.recovered} got there after the working` : ''}`}
      score={outcome.score}
      saveNote={saveNote}
      continueLabel="BACK TO THE STAGES ▸"
      onContinue={onContinue}
    >
      <button type="button" className="lhx-fl-ghost" onClick={onReplay}>Practise this stage again</button>
    </WinScreen>
  )
}

/* ── the engine ────────────────────────────────────────────────────── */

export default function FractionLadderGame({ game }) {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [screen, setScreen] = useState('ladder')
  const [levelId, setLevelId] = useState(null)
  const [stageNumber, setStageNumber] = useState(1)
  const [outcome, setOutcome] = useState(null)
  const [progress, setProgress] = useState(() => readProgress(readJson(progressKey(game?.id), null)))
  const { saveResult, newBadges, streakResult, finish } = useGameFinish()

  // One session id per mount. It is what makes "three corrects in three
  // separate sessions" mean anything — a second right answer for the same
  // skill in this sitting carries the same id and is refused by recordCorrect.
  const sessionRef = useRef(`s${Date.now().toString(36)}`)
  const stageStartedAt = useRef(Date.now())

  useEffect(() => {
    primeSounds()
    reportGameStart(game)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback((next) => {
    setProgress(next)
    writeJson(progressKey(game?.id), next)
  }, [game?.id])

  // A stage abandoned mid-way is resumable. Offered on the ladder rather than
  // forced, because a learner who left is allowed to have meant it.
  const pending = useMemo(() => resumable(progress, game), [progress, game])

  const stageHandlers = useMemo(() => ({
    snapshot: ({ pool, ...rest }) => {
      save({ ...progress, pool, resume: snapshotStage(rest) })
    },
    complete: ({ levelId: lid, stageNumber: sn, stars, summary, score, pool }) => {
      // The snapshot is cleared in the SAME write that records the stage: a
      // snapshot outliving its stage is how a finished stage reopens itself.
      const recorded = clearResume(recordStage({ ...progress, pool }, lid, sn, stars))
      save(recorded)
      setOutcome({ levelId: lid, stageNumber: sn, stars, summary, score })
      playWin()
      setScreen('done')
      finish({
        game,
        score,
        correct: summary.correct,
        total: summary.total,
        peakCombo: 1,
        timeSpent: Math.round((Date.now() - stageStartedAt.current) / 1000),
      })
    },
  }), [progress, save, game, finish])

  const openStage = (lid, sn) => {
    setLevelId(lid)
    setStageNumber(sn)
    stageStartedAt.current = Date.now()
    setScreen('stage')
  }

  return (
    <div className="lhx lhx-bare">
      <div className="lhx-page">
        {screen === 'ladder' && (
          <>
            {pending && (
              <button
                type="button"
                className="lhx-fl-resume"
                onClick={() => openStage(pending.levelId, pending.stageNumber)}
              >
                ▸ Carry on where you stopped — {levelById(pending.levelId)?.name}, stage {pending.stageNumber}
              </button>
            )}
            <LadderScreen
              game={game}
              progress={progress}
              onExit={() => navigate('/games')}
              onReview={() => setScreen('review')}
              onPick={(id) => { setLevelId(id); setScreen('level') }}
            />
          </>
        )}
        {screen === 'level' && (
          <LevelScreen
            game={game}
            levelId={levelId}
            progress={progress}
            onBack={() => setScreen('ladder')}
            onPlay={(sn) => openStage(levelId, sn)}
          />
        )}
        {screen === 'review' && (
          <ReviewScreen progress={progress} onBack={() => setScreen('ladder')} />
        )}
        {screen === 'stage' && (
          <StageScreen
            key={`${levelId}:${stageNumber}:${screen}`}
            game={game}
            levelId={levelId}
            stageNumber={stageNumber}
            progress={progress}
            session={sessionRef.current}
            onExit={() => setScreen('level')}
            onFinish={stageHandlers}
          />
        )}
        {screen === 'done' && outcome && (
          <StageDoneScreen
            outcome={outcome}
            saveNote={buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}
            onContinue={() => setScreen('level')}
            onReplay={() => openStage(outcome.levelId, outcome.stageNumber)}
          />
        )}
        {screen === 'done' && outcome && levelPassed(progress, game, outcome.levelId) && (
          <div className="lhx-sr-only" role="status">Level passed. The next level is open.</div>
        )}
      </div>
      <BadgePop badges={newBadges} />
    </div>
  )
}

export { Frac }
