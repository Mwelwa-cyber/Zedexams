/**
 * KnowZambiaGame — the tap-to-place map engine for `type: 'map_place'`
 * games, and the fifth catalogue mechanic.
 *
 * Ported from the prototype at docs/learner/zedexams-zambia-game.html. A
 * round places the ten provinces in three waves — three, then two more,
 * then the last five — and everything already placed stays on the map in
 * grey WITH ITS NAME, because that is what the next hint points at.
 *
 * Four decisions the prototype made that survive the port intact:
 *
 *   TAP, THEN TAP. Tap a name, then tap the province. Dragging on a phone
 *   puts a finger over the target, so drag is not offered at all here —
 *   the desktop affordance is not worth a second code path on a surface
 *   that is overwhelmingly Android.
 *
 *   EVERY TARGET IS 44px. Lusaka is the smallest province and measures
 *   about 32px tall on a 360px screen, so each province carries an
 *   invisible halo that `haloRadius` switches on only when the shape
 *   itself comes up short AT THE MEASURED WIDTH — and the halos are
 *   stacked smallest-last so Lusaka wins the tap over Central.
 *
 *   A WRONG TAP TEACHES DIRECTION. It names what was tapped, then gives
 *   the hint for what was being placed. The selected name stays selected,
 *   so a second try costs one tap. Nothing is taken away.
 *
 *   CORRECT AND WRONG ARE NOT COLOURS. A placed province carries a ✓ and
 *   its name; a wrong tap flashes a ✗. The palette agrees with the glyph
 *   rather than carrying the message, which is what makes the map readable
 *   to a colour-blind learner and on a photocopied classroom projector.
 *
 * No clock (PROMPT 7b): the head's bar fills with progress through the ten
 * rather than draining. The backend contract is the shared one — the round
 * ends through useGameFinish → saveScore / badges / daily streak, with
 * reportGameStart keeping the funnel intact.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useGameFinish } from '../hooks/useGameFinish'
import { reportGameStart } from '../services/gamesService'
import { playCorrect, playWrong, playWin, primeSounds } from '../lib/gameSounds'
import { BadgePop, GameTopBar, WinScreen, buildSaveNote } from './protoGameChrome'
import { ZAMBIA_FACTS, ZAMBIA_PROVINCES_GEO } from '../../../data/zambiaGeography'
import {
  anchorsBefore,
  buildGeometry,
  factFor,
  haloRadius,
  hintFor,
  placeGain,
  placementsIn,
  roundResult,
  starsForScore,
  wavesFor,
} from '../lib/knowZambiaCore'

const GEO = buildGeometry(ZAMBIA_PROVINCES_GEO.provinces)
const VIEW_BOX = ZAMBIA_PROVINCES_GEO.viewBox || '0 0 100 81.5'
const VIEW_WIDTH = Number(VIEW_BOX.split(/\s+/)[2]) || 100

/** Label size that fits the province it sits in, clamped either side. */
function labelSize(code) {
  const shape = GEO[code]
  if (!shape) return 2.4
  const chars = Math.max(1, shape.name.length)
  return Math.max(1.9, Math.min(3.1, (shape.bbox.w * 0.86) / (chars * 0.55)))
}

/* ── Play screen ───────────────────────────────────────────────── */

function PlayScreen({ game, onExit, onEnd }) {
  const waves = useMemo(() => wavesFor(game), [game])
  const total = useMemo(() => placementsIn(waves).length, [waves])

  const [waveIndex, setWaveIndex] = useState(0)
  const [placed, setPlaced] = useState({})     // code → the wave it was placed in
  const [selected, setSelected] = useState(null)
  const [wrong, setWrong] = useState(null)     // the code flashing ✗
  const [score, setScore] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [scale, setScale] = useState(0)        // renderedPx / viewBox units

  const svgRef = useRef(null)
  const round = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const startedAtRef = useRef(Date.now())
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  // The halo radius depends on the width the map is ACTUALLY rendered at, so
  // it is measured rather than assumed — and re-measured when the window
  // changes, which is what a rotated phone does.
  useEffect(() => {
    const measure = () => {
      const width = svgRef.current?.getBoundingClientRect().width || 0
      if (width) setScale(width / VIEW_WIDTH)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const wave = waves[waveIndex] || []
  const remaining = wave.filter((code) => !(code in placed))
  const anchors = useMemo(() => anchorsBefore(waves, waveIndex), [waves, waveIndex])

  const endedRef = useRef(false)
  const onEndRef = useRef(onEnd)
  useEffect(() => { onEndRef.current = onEnd }, [onEnd])
  const endRound = (finalScore) => {
    if (endedRef.current) return
    endedRef.current = true
    onEndRef.current({
      score: finalScore,
      solved: round.current.solved,
      misses: round.current.misses,
      peakCombo: round.current.peakCombo,
      timeSpent: Math.round((Date.now() - startedAtRef.current) / 1000),
    })
  }

  const tapName = (code) => {
    if (endedRef.current || code in placed) return
    setSelected((current) => (current === code ? null : code))
  }

  const tapProvince = (code) => {
    if (endedRef.current || wrong) return
    if (!selected) {
      setFeedback({ tone: 'say', title: 'Pick a name first', body: 'Tap one of the names below, then tap where it goes on the map.' })
      return
    }
    if (code === selected) {
      const comboNow = round.current.combo
      const gained = placeGain(comboNow)
      round.current.solved += 1
      round.current.peakCombo = Math.max(round.current.peakCombo, comboNow)
      round.current.combo = comboNow + 1
      playCorrect()
      const nextScore = score + gained
      setScore(nextScore)
      setPlaced((current) => ({ ...current, [code]: waveIndex }))
      setSelected(null)
      setFeedback({
        tone: 'ok',
        title: `${GEO[code].name} — correct`,
        body: factFor(ZAMBIA_FACTS, ZAMBIA_PROVINCES_GEO.provinces, code),
      })
      const done = round.current.solved
      if (done >= total) later(() => endRound(nextScore), 900)
      else if (remaining.length <= 1) later(() => { setWaveIndex((i) => i + 1); setFeedback(null) }, 900)
    } else {
      round.current.misses += 1
      round.current.combo = 1
      playWrong()
      setWrong(code)
      setFeedback({
        tone: 'no',
        title: `That one is ${GEO[code].name}`,
        body: `${hintFor(ZAMBIA_FACTS, ZAMBIA_PROVINCES_GEO.provinces, selected)} Try again — nothing is lost.`,
      })
      later(() => setWrong(null), 800)
    }
  }

  // Smallest-last, so a small province's halo is on top of a big neighbour's.
  const haloOrder = useMemo(
    () => Object.values(GEO).slice().sort((a, b) => b.area - a.area),
    [],
  )

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} done={round.current.solved} total={total} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">
            {selected ? `NOW TAP WHERE ${GEO[selected].name.toUpperCase()} GOES` : 'TAP A NAME, THEN TAP WHERE IT GOES'}
          </div>
        </div>
        <div className="lhx-nt-best">
          Round {waveIndex + 1} of {waves.length} · {round.current.solved} of {total} placed · combo ×{round.current.combo}
        </div>
      </div>

      <div className="lhx-kz-map">
        <svg
          ref={svgRef}
          className="lhx-kz-svg"
          viewBox={VIEW_BOX}
          role="group"
          aria-label="Map of Zambia and its ten provinces"
        >
          <defs>
            <pattern id="lhx-kz-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="3" height="3" fill="#fbe3d2" />
              <rect width="1.4" height="3" fill="#d55e00" />
            </pattern>
          </defs>

          {Object.values(GEO).map((shape) => {
            const isPlaced = shape.code in placed
            const isAnchor = isPlaced && placed[shape.code] !== waveIndex
            const state = wrong === shape.code ? 'is-wrong' : isAnchor ? 'is-anchor' : isPlaced ? 'is-placed' : ''
            const stateWord = wrong === shape.code ? ', wrong' : isPlaced ? ', placed' : ''
            return (
              <path
                key={shape.code}
                className={`lhx-kz-prov ${state}`}
                d={ZAMBIA_PROVINCES_GEO.provinces[shape.code].d}
                role="button"
                tabIndex={0}
                aria-label={`${shape.name} Province${stateWord}`}
                onClick={() => tapProvince(shape.code)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  tapProvince(shape.code)
                }}
              >
                <title>{shape.name} Province</title>
              </path>
            )
          })}

          {Object.values(GEO).filter((shape) => shape.code in placed).map((shape) => {
            const size = labelSize(shape.code)
            const isAnchor = placed[shape.code] !== waveIndex
            return (
              <g key={`label-${shape.code}`} aria-hidden="true">
                <text
                  className={`lhx-kz-label ${isAnchor ? 'is-anchor' : ''}`}
                  x={shape.anchor[0]}
                  y={shape.anchor[1]}
                  style={{ fontSize: `${size.toFixed(2)}px` }}
                >
                  {shape.name}
                </text>
                {!isAnchor && (
                  <text className="lhx-kz-mark" x={shape.anchor[0]} y={shape.anchor[1] - size - 1.2}>✓</text>
                )}
              </g>
            )
          })}

          {wrong && (
            <text className="lhx-kz-mark is-wrong" aria-hidden="true" x={GEO[wrong].anchor[0]} y={GEO[wrong].anchor[1]}>✗</text>
          )}

          {/* Touch halos — 0 radius until the map has been measured, and 0 for
              any province already big enough to tap. */}
          <g className="lhx-kz-halos">
            {haloOrder.map((shape) => {
              const radius = haloRadius(Math.min(shape.bbox.w, shape.bbox.h), scale)
              if (!radius) return null
              return (
                <circle
                  key={`halo-${shape.code}`}
                  className="lhx-kz-halo"
                  cx={shape.anchor[0]}
                  cy={shape.anchor[1]}
                  r={radius}
                  aria-hidden="true"
                  onClick={() => tapProvince(shape.code)}
                />
              )
            })}
          </g>
        </svg>
      </div>

      <div className="lhx-kz-names">
        {wave.map((code) => {
          const done = code in placed
          return (
            <button
              key={code}
              type="button"
              className={`lhx-kz-name ${done ? 'is-done' : ''} ${selected === code ? 'is-sel' : ''}`}
              disabled={done}
              aria-pressed={selected === code}
              onClick={() => tapName(code)}
            >
              {done ? '✓ ' : ''}{GEO[code].name}
            </button>
          )
        })}
      </div>

      <div className="lhx-kz-feedback" aria-live="polite">
        {feedback && (
          <div className={`lhx-kz-fb is-${feedback.tone}`}>
            <div className="lhx-kz-fb-title">
              <span aria-hidden="true">{feedback.tone === 'ok' ? '✓' : feedback.tone === 'no' ? '✗' : '•'}</span>
              <span>{feedback.title}</span>
            </div>
            <div className="lhx-kz-fb-body">{feedback.body}</div>
          </div>
        )}
        {!feedback && anchors.length > 0 && (
          <div className="lhx-kz-anchor-note">
            Still on the map: {anchors.map((code) => GEO[code].name).join(', ')}
          </div>
        )}
      </div>
    </>
  )
}

/* ── The engine ────────────────────────────────────────────────── */

export default function KnowZambiaGame({ game }) {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [screen, setScreen] = useState('play')
  const [outcome, setOutcome] = useState({ score: 0, solved: 0 })
  const { saveResult, newBadges, streakResult, finish } = useGameFinish()

  useEffect(() => {
    primeSounds()
    reportGameStart(game)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endRound = (result) => {
    setOutcome(result)
    playWin()
    setScreen('win')
    finish(roundResult({ game, ...result }))
  }

  return (
    <div className="lhx">
      <div className="lhx-page">
        {screen === 'play' && (
          <PlayScreen game={game} onExit={() => navigate('/games')} onEnd={endRound} />
        )}
        {screen === 'win' && (
          <WinScreen
            stars={starsForScore(outcome.score)}
            title="You know Zambia!"
            sub={`You placed ${outcome.solved} of the ten provinces.`}
            score={outcome.score}
            saveNote={buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}
            onContinue={() => navigate('/games')}
          />
        )}
      </div>
      <BadgePop badges={newBadges} />
    </div>
  )
}
