/**
 * The five map modes that are not place-the-province.
 *
 * Ported from docs/learner/zedexams-zambia-map-modes.html. They share the
 * engine's shell, its scoring and its map (ZambiaMap); what differs is the
 * question each asks and — the part worth the code — what each says when the
 * answer is wrong.
 *
 * NOTHING HERE IS TIMED, in any mode. A round ends when everything has been
 * answered, including the items that caught the learner, which come back once
 * the queue empties. The only timers in this file hold a piece of feedback on
 * screen before advancing; none of them takes information away or scores a
 * learner for being slow.
 *
 * JOURNEY IS THE ONE WORTH HAVING. It teaches adjacency and scale — which
 * province touches which, and what 1,300 km actually costs — and neither is
 * reachable by a place-the-label game. Its wrong-tap answer is composed from
 * the map rather than read from a hint field: see `journeyVerdict` in the core.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { GameTopBar } from './protoGameChrome'
import ZambiaMap from './ZambiaMap'
import { playCorrect, playWrong } from '../lib/gameSounds'
import { ZAMBIA_FACTS, ZAMBIA_PROVINCES_GEO } from '../../../data/zambiaGeography'
import {
  journeyVerdict,
  journeysFor,
  nameIn,
  placeGain,
  richSegments,
  stepsFor,
} from '../lib/knowZambiaCore'

const PROVINCES = ZAMBIA_PROVINCES_GEO.provinces
const PROJECTION = ZAMBIA_PROVINCES_GEO.projection
const VIEW_MAIN = ZAMBIA_PROVINCES_GEO.viewBox || '0 0 100 81.5'
/* The neighbour boxes sit outside the country, so that mode pulls the camera
   back rather than shrinking the map for every other mode. */
const VIEW_WORLD = '-27 -23 154 130'

/** Feedback block — the same shape in every mode. */
function Feedback({ feedback }) {
  if (!feedback) return null
  const glyph = feedback.tone === 'ok' ? '✓' : feedback.tone === 'no' ? '✗' : '•'
  return (
    <div className="lhx-kz-feedback" aria-live="polite">
      <div className={`lhx-kz-fb is-${feedback.tone}`}>
        <div className="lhx-kz-fb-title">
          <span aria-hidden="true">{glyph}</span>
          <span>{feedback.title}</span>
        </div>
        <div className="lhx-kz-fb-body">{feedback.body}</div>
      </div>
    </div>
  )
}

/**
 * Everything a round needs that is the same in all five modes: the score, the
 * combo, the missed-item replay, and the one call that ends the round.
 *
 * The replay is the whole of the "tricky pool" — one pass, then the items that
 * caught the learner, then done. It is not a spaced-repetition schedule and
 * cannot loop for ever.
 */
function useRound({ steps, onEnd }) {
  const [index, setIndex] = useState(0)
  const [queue, setQueue] = useState(steps)
  const [score, setScore] = useState(0)
  const [pass, setPass] = useState(1)
  const [feedback, setFeedback] = useState(null)

  const missed = useRef([])
  const stats = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const startedAt = useRef(Date.now())
  const timers = useRef([])
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const ended = useRef(false)
  const onEndRef = useRef(onEnd)
  useEffect(() => { onEndRef.current = onEnd }, [onEnd])

  const endRound = (finalScore) => {
    if (ended.current) return
    ended.current = true
    onEndRef.current({
      score: finalScore,
      solved: stats.current.solved,
      misses: stats.current.misses,
      peakCombo: stats.current.peakCombo,
      timeSpent: Math.round((Date.now() - startedAt.current) / 1000),
    })
  }

  const award = () => {
    const gained = placeGain(stats.current.combo)
    stats.current.solved += 1
    stats.current.peakCombo = Math.max(stats.current.peakCombo, stats.current.combo)
    stats.current.combo += 1
    const next = score + gained
    setScore(next)
    return next
  }

  const penalise = (step) => {
    stats.current.misses += 1
    stats.current.combo = 1
    if (pass === 1 && step && !missed.current.includes(step)) missed.current.push(step)
  }

  /** Advance, replaying what was missed once the first pass runs out. */
  const advance = (finalScore) => {
    setFeedback(null)
    if (index + 1 < queue.length) { setIndex(index + 1); return }
    if (pass === 1 && missed.current.length) {
      setQueue(missed.current.slice())
      missed.current = []
      setIndex(0)
      setPass(2)
      return
    }
    endRound(finalScore)
  }

  return {
    step: queue[index],
    index,
    total: queue.length,
    pass,
    score,
    stats,
    feedback,
    setFeedback,
    award,
    penalise,
    advance,
    later,
    ended,
    endRound,
  }
}

/** The head every mode shares: exit, progress, score, and the ask. */
function ModeHead({ onExit, round, goal, note }) {
  return (
    <div className="lhx-nt-head">
      <GameTopBar onExit={onExit} done={round.index} total={round.total} score={round.score} />
      <div className="lhx-nt-goal">
        <div className="lhx-nt-goal-lab">{goal}</div>
      </div>
      <div className="lhx-nt-best">
        {round.pass === 2 ? 'The ones that caught you · ' : ''}
        {round.index + 1} of {round.total} · combo ×{round.stats.current.combo}
        {note ? ` · ${note}` : ''}
      </div>
    </div>
  )
}

/* ── 1. Where's the capital? ───────────────────────────────────────── */

export function CapitalScreen({ game, geo, onExit, onEnd }) {
  const steps = useMemo(() => stepsFor({ game, facts: ZAMBIA_FACTS, geo: ZAMBIA_PROVINCES_GEO }), [game])
  const round = useRound({ steps, onEnd })
  const [marks, setMarks] = useState({})
  const [settled, setSettled] = useState(false)
  const step = round.step
  if (!step) return null

  const tap = (code) => {
    if (settled) return
    if (code === step.answer) {
      playCorrect()
      const next = round.award()
      setMarks({ [step.answer]: 'ok' })
      setSettled(true)
      round.setFeedback({ tone: 'ok', title: `${nameIn(ZAMBIA_PROVINCES_GEO, step.answer)} — correct`, body: step.fact })
      round.later(() => { setMarks({}); setSettled(false); round.advance(next) }, 2200)
    } else {
      playWrong()
      round.penalise(step)
      setMarks({ [code]: 'no', [step.answer]: 'ok' })
      setSettled(true)
      round.setFeedback({
        tone: 'no',
        title: `It is ${nameIn(ZAMBIA_PROVINCES_GEO, step.answer)}`,
        body: `You tapped ${nameIn(ZAMBIA_PROVINCES_GEO, code)}. ${step.hint}`,
      })
      round.later(() => { setMarks({}); setSettled(false); round.advance(round.score) }, 2600)
    }
  }

  return (
    <>
      <ModeHead onExit={onExit} round={round} goal={`WHICH PROVINCE IS ${String(step.town).toUpperCase()} THE CAPITAL OF?`} />
      <ZambiaMap
        geo={geo}
        provinces={PROVINCES}
        viewBox={VIEW_MAIN}
        projection={PROJECTION}
        state={marks}
        pin={{ lon: step.lon, lat: step.lat, label: step.town }}
        onTapProvince={settled ? null : tap}
      />
      <div className="lhx-kz-ask">
        <b>{step.town}</b> is the capital of which province?
        <span className="lhx-kz-ask-sub">Tap the province on the map</span>
      </div>
      <Feedback feedback={round.feedback} />
    </>
  )
}

/* ── 2. Journey ────────────────────────────────────────────────────── */

export function JourneyScreen({ game, geo, onExit, onEnd }) {
  const routes = useMemo(() => journeysFor(ZAMBIA_FACTS, game), [game])
  const [routeIndex, setRouteIndex] = useState(0)
  const route = routes[routeIndex]
  const total = route ? route.provinces.length : 0

  const [at, setAt] = useState(0)
  const [wrong, setWrong] = useState(null)
  const [score, setScore] = useState(0)
  const [feedback, setFeedback] = useState(null)

  const stats = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const startedAt = useRef(Date.now())
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const ended = useRef(false)
  const onEndRef = useRef(onEnd)
  useEffect(() => { onEndRef.current = onEnd }, [onEnd])

  if (!route) return null

  const finish = (finalScore) => {
    if (ended.current) return
    ended.current = true
    onEndRef.current({
      score: finalScore,
      solved: stats.current.solved,
      misses: stats.current.misses,
      peakCombo: stats.current.peakCombo,
      timeSpent: Math.round((Date.now() - startedAt.current) / 1000),
    })
  }

  const tap = (code) => {
    if (ended.current || at >= total) return
    const verdict = journeyVerdict({ geo: ZAMBIA_PROVINCES_GEO, route, atIndex: at, tapped: code })
    if (verdict.ok) {
      playCorrect()
      const gained = placeGain(stats.current.combo)
      stats.current.solved += 1
      stats.current.peakCombo = Math.max(stats.current.peakCombo, stats.current.combo)
      stats.current.combo += 1
      const next = score + gained
      setScore(next)
      setWrong(null)
      const stepped = at + 1
      setAt(stepped)
      if (stepped >= total) {
        const last = routeIndex + 1 >= routes.length
        setFeedback({
          tone: 'ok',
          title: `You made it to ${route.to}`,
          body: `${route.endNote} The route ran ${route.provinces.map((c) => nameIn(ZAMBIA_PROVINCES_GEO, c)).join(' → ')}.`,
        })
        timers.current.push(setTimeout(() => {
          if (last) { finish(next); return }
          setRouteIndex(routeIndex + 1)
          setAt(0)
          setFeedback(null)
        }, 3400))
      } else {
        setFeedback({ tone: 'ok', title: nameIn(ZAMBIA_PROVINCES_GEO, code), body: verdict.body })
      }
    } else {
      playWrong()
      stats.current.misses += 1
      stats.current.combo = 1
      setWrong(code)
      setFeedback({ tone: 'no', title: verdict.title, body: verdict.body })
      timers.current.push(setTimeout(() => setWrong(null), 1400))
    }
  }

  const state = {}
  const order = {}
  route.provinces.slice(0, at).forEach((code, i) => { state[code] = 'step'; order[code] = i + 1 })
  if (wrong) state[wrong] = 'no'

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} done={at} total={total} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">{`${route.from.toUpperCase()} → ${route.to.toUpperCase()}`}</div>
        </div>
        <div className="lhx-nt-best">
          {route.road} · about {route.approxKm.toLocaleString()} km · route {routeIndex + 1} of {routes.length}
        </div>
      </div>

      <ZambiaMap
        geo={geo}
        provinces={PROVINCES}
        viewBox={VIEW_MAIN}
        state={state}
        order={order}
        onTapProvince={at >= total ? null : tap}
      />

      <div className="lhx-kz-ask">
        Tap each province you pass through, <b>in order</b>.
        <div className="lhx-kz-route">
          {route.provinces.map((code, i) => (
            <span key={code} className={`lhx-kz-rs ${i < at ? 'is-on' : ''}`}>
              <span className="lhx-kz-rs-n">{i + 1}</span>
              {i < at ? nameIn(ZAMBIA_PROVINCES_GEO, code) : '?'}
            </span>
          ))}
        </div>
      </div>
      <Feedback feedback={feedback} />
    </>
  )
}

/* ── 3. Odd one out ────────────────────────────────────────────────── */

export function OddOneOutScreen({ game, geo, onExit, onEnd }) {
  const steps = useMemo(() => stepsFor({ game, facts: ZAMBIA_FACTS, geo: ZAMBIA_PROVINCES_GEO }), [game])
  const round = useRound({ steps, onEnd })
  const [marks, setMarks] = useState({})
  const [settled, setSettled] = useState(false)
  const step = round.step
  if (!step) return null

  const tap = (code) => {
    if (settled || !step.set.includes(code)) return
    const right = code === step.answer
    let next = round.score
    if (right) {
      playCorrect()
      next = round.award()
    } else {
      playWrong()
      round.penalise(step)
    }
    setMarks(right ? { [step.answer]: 'ok' } : { [code]: 'no', [step.answer]: 'ok' })
    setSettled(true)
    round.setFeedback(
      right
        ? { tone: 'ok', title: nameIn(ZAMBIA_PROVINCES_GEO, step.answer), body: step.why }
        : {
            tone: 'no',
            title: `It is ${nameIn(ZAMBIA_PROVINCES_GEO, step.answer)}`,
            body: `You tapped ${nameIn(ZAMBIA_PROVINCES_GEO, code)}, which does belong with the other two. ${step.why}`,
          },
    )
    round.later(() => { setMarks({}); setSettled(false); round.advance(next) }, 3200)
  }

  // Four lit, six dimmed — and the dimmed six are excluded from the markup, so
  // they carry no hit target, no tabIndex and no halo.
  const state = {}
  for (const shape of Object.values(geo)) state[shape.code] = step.set.includes(shape.code) ? 'live' : 'dim'
  Object.assign(state, marks)

  return (
    <>
      <ModeHead onExit={onExit} round={round} goal="ONE OF THE FOUR DOES NOT BELONG" />
      <ZambiaMap
        geo={geo}
        provinces={PROVINCES}
        viewBox={VIEW_MAIN}
        state={state}
        labels={step.set}
        tappable={step.set}
        onTapProvince={settled ? null : tap}
      />
      <div className="lhx-kz-ask">
        <span>
          {richSegments(step.q).map((seg, i) => (
            seg.bold ? <b key={i}>{seg.text}</b> : <span key={i}>{seg.text}</span>
          ))}
        </span>
        <span className="lhx-kz-ask-sub">Tap one of the four lit provinces</span>
      </div>
      <Feedback feedback={round.feedback} />
    </>
  )
}

/* ── 4. Our neighbours ─────────────────────────────────────────────── */

export function NeighboursScreen({ game, geo, onExit, onEnd }) {
  const steps = useMemo(() => stepsFor({ game, facts: ZAMBIA_FACTS, geo: ZAMBIA_PROVINCES_GEO }), [game])
  const round = useRound({ steps, onEnd })
  const [placed, setPlaced] = useState({})
  const [selected, setSelected] = useState(null)
  const [wrongZone, setWrongZone] = useState(null)

  const byCode = useMemo(() => Object.fromEntries(steps.map((s) => [s.answer, s])), [steps])
  const done = Object.keys(placed).length
  const left = steps.filter((s) => !placed[s.answer])

  const tapZone = (code) => {
    if (round.ended.current) return
    if (!selected) {
      round.setFeedback({ tone: 'say', title: 'Pick a country first', body: 'Tap one of the eight names, then tap the box you think it goes in.' })
      return
    }
    if (code === selected) {
      playCorrect()
      const next = round.award()
      const now = { ...placed, [code]: true }
      setPlaced(now)
      setSelected(null)
      setWrongZone(null)
      round.setFeedback({ tone: 'ok', title: byCode[code].name, body: byCode[code].fact })
      if (Object.keys(now).length >= steps.length) round.later(() => round.endRound(next), 2600)
    } else {
      playWrong()
      round.penalise(byCode[selected])
      setWrongZone(code)
      round.setFeedback({
        tone: 'no',
        title: `That box is ${byCode[code].name}’s`,
        body: `${byCode[selected].name} is ${byCode[selected].side} of Zambia. ${byCode[selected].hint}`,
      })
      round.later(() => setWrongZone(null), 1400)
    }
  }

  const zoneState = {}
  for (const code of Object.keys(placed)) zoneState[code] = 'ok'
  if (wrongZone) zoneState[wrongZone] = 'no'
  const provinceState = {}
  for (const shape of Object.values(geo)) provinceState[shape.code] = 'anchor'

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} done={done} total={steps.length} score={round.score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">
            {selected ? `NOW TAP WHERE ${byCode[selected].name.toUpperCase()} GOES` : 'EIGHT COUNTRIES TOUCH ZAMBIA'}
          </div>
        </div>
        <div className="lhx-nt-best">{done} of {steps.length} placed · combo ×{round.stats.current.combo}</div>
      </div>

      <ZambiaMap
        geo={geo}
        provinces={PROVINCES}
        viewBox={VIEW_WORLD}
        state={provinceState}
        zones={steps.map((s) => ({ code: s.answer, name: s.name, zone: s.zone, side: s.side }))}
        zoneState={zoneState}
        onTapZone={left.length ? tapZone : null}
        ariaLabel="Map of Zambia with a box for each of the eight countries that border it"
      />

      <div className="lhx-kz-names">
        {steps.map((s) => (
          <button
            key={s.answer}
            type="button"
            className={`lhx-kz-name ${placed[s.answer] ? 'is-done' : ''} ${selected === s.answer ? 'is-sel' : ''}`}
            disabled={!!placed[s.answer]}
            aria-pressed={selected === s.answer}
            onClick={() => setSelected((cur) => (cur === s.answer ? null : s.answer))}
          >
            {placed[s.answer] ? '✓ ' : ''}{s.name}
          </button>
        ))}
      </div>
      <Feedback feedback={round.feedback} />
    </>
  )
}

/* ── 5. Where's the ceremony? ──────────────────────────────────────── */

export function CeremonyScreen({ game, geo, onExit, onEnd }) {
  const steps = useMemo(() => stepsFor({ game, facts: ZAMBIA_FACTS, geo: ZAMBIA_PROVINCES_GEO }), [game])
  const round = useRound({ steps, onEnd })
  const [marks, setMarks] = useState({})
  const [picked, setPicked] = useState(null)
  const [settled, setSettled] = useState(false)
  const step = round.step
  if (!step) return null

  const settle = (right, feedback, next) => {
    setSettled(true)
    round.setFeedback(feedback)
    round.later(() => { setMarks({}); setPicked(null); setSettled(false); round.advance(next) }, right ? 2600 : 3200)
  }

  const tapProvince = (code) => {
    if (settled || step.kind !== 'ceremonyWhere') return
    if (code === step.answer) {
      playCorrect()
      const next = round.award()
      setMarks({ [step.answer]: 'ok' })
      settle(true, { tone: 'ok', title: nameIn(ZAMBIA_PROVINCES_GEO, step.answer), body: step.fact }, next)
    } else {
      playWrong()
      round.penalise(step)
      setMarks({ [code]: 'no', [step.answer]: 'ok' })
      settle(false, {
        tone: 'no',
        title: `It is in ${nameIn(ZAMBIA_PROVINCES_GEO, step.answer)}`,
        body: `You tapped ${nameIn(ZAMBIA_PROVINCES_GEO, code)}. ${step.fact}`,
      }, round.score)
    }
  }

  const pickOption = (option) => {
    if (settled) return
    setPicked(option)
    if (option === step.answer) {
      playCorrect()
      const next = round.award()
      settle(true, { tone: 'ok', title: step.answer, body: step.why }, next)
    } else {
      playWrong()
      round.penalise(step)
      settle(false, { tone: 'no', title: `It is ${step.answer}`, body: `You chose ${option}. ${step.why}` }, round.score)
    }
  }

  const onMap = step.kind === 'ceremonyWhere'
  const goal = onMap
    ? `WHERE DOES THE ${String(step.name).toUpperCase()} TAKE PLACE?`
    : step.kind === 'ceremonyWho' ? 'WHOSE CEREMONY IS IT?' : 'WHEN IS IT HELD?'

  return (
    <>
      <ModeHead onExit={onExit} round={round} goal={goal} note={step.name} />
      <ZambiaMap
        geo={geo}
        provinces={PROVINCES}
        viewBox={VIEW_MAIN}
        state={marks}
        onTapProvince={onMap && !settled ? tapProvince : null}
      />
      {onMap ? (
        <div className="lhx-kz-ask">
          Where does the <b>{step.name}</b> take place?
          <span className="lhx-kz-ask-sub">Tap the province</span>
        </div>
      ) : (
        /* Two of the three questions are deliberately OFF the map. A learner
           who only ever taps a map stops reading the question. */
        <div className="lhx-kz-opts">
          {step.options.map((option) => {
            const mark = !picked ? '' : option === step.answer ? 'is-ok' : picked === option ? 'is-no' : ''
            return (
              <button
                key={option}
                type="button"
                className={`lhx-kz-opt ${mark}`}
                disabled={settled}
                onClick={() => pickOption(option)}
              >
                <span className="lhx-kz-opt-g" aria-hidden="true">
                  {!picked ? '·' : option === step.answer ? '✓' : picked === option ? '✗' : '·'}
                </span>
                {option}
              </button>
            )
          })}
        </div>
      )}
      <Feedback feedback={round.feedback} />
    </>
  )
}

export const MODE_SCREENS = {
  capital: CapitalScreen,
  journey: JourneyScreen,
  odd: OddOneOutScreen,
  neighbours: NeighboursScreen,
  ceremony: CeremonyScreen,
}
