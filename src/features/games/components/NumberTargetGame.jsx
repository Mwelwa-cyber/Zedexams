/**
 * NumberTargetGame — the prototype-v3 "Number Path" engine for
 * `type: 'number_target'` games (learner redesign step 4, the first of
 * the four rebuilt mechanics).
 *
 * Three screens, exactly the prototype's flow:
 *   path — the 8-node level path under the indigo stats head. Only the
 *          current level starts a round; cleared nodes show their star.
 *   play — the tap-to-sum board: a 4×4 tile grid, a target that is by
 *          construction the sum of tiles on the board, 20 × combo per
 *          match, a per-level countdown driving the yellow timebar.
 *   win  — stars, "Level N complete!", the XP + SCORE cards, confetti.
 *
 * The backend contract is UNCHANGED (locked scope): the finished round
 * flows through useGameFinish → saveScore / badges / daily streak, the
 * same plumbing every engine shares, and reportGameStart keeps the
 * start/completion funnel intact. What is new and local is the level
 * path itself — per-game progress lives in localStorage (there is no
 * server-side per-game level model, and building one is out of scope),
 * so the path survives reloads on this device while score/XP/badges
 * remain the server-backed truth.
 *
 * Renders full-screen in the learner design system: PlayGame mounts it
 * bare (no GamesShell chrome), and the ✕ / back controls navigate
 * path ↔ play ↔ /games like the prototype's views.
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
import {
  NODE_POS,
  PATH_VIEW_HEIGHT,
  TOTAL_LEVELS,
  applyRound,
  currentLevel,
  fillTiles,
  judgeSelection,
  levelTimeMax,
  matchGain,
  newTarget,
  nodeStates,
  normalizeProgress,
  replaceMatched,
  roundResult,
  starsForScore,
  sumOf,
  toggleTile,
  totalStars,
} from '../lib/numberPathCore'

const ZED_ART = '/images/characters/zed-zara-reading.webp'

const progressKey = (gameId) => `zx:number-path:${gameId || 'default'}`

function loadProgress(gameId) {
  try {
    return normalizeProgress(JSON.parse(window.localStorage.getItem(progressKey(gameId))))
  } catch {
    return normalizeProgress(null)
  }
}

function saveProgress(gameId, progress) {
  try {
    window.localStorage.setItem(progressKey(gameId), JSON.stringify(progress))
  } catch { /* private mode — the path just won't persist */ }
}

/* ── Level path screen ─────────────────────────────────────────── */

function PathScreen({ game, progress, onBack, onStart }) {
  const p = normalizeProgress(progress)
  const states = nodeStates(p)
  const current = currentLevel(p)
  const pathD = NODE_POS.map((pos, i) => `${i === 0 ? 'M' : 'L'} ${pos[0]} ${pos[1]}`).join(' ')
  // Zed cheers from beside the last cleared node once the path has begun.
  const mascotAt = p.completed > 0 && p.completed < TOTAL_LEVELS ? NODE_POS[p.completed - 1] : null

  return (
    <>
      <div className="lhx-path-head">
        <div className="lhx-back-row">
          <button type="button" className="lhx-back-btn" aria-label="Back to games" onClick={onBack}>‹</button>
          <div>
            <div className="lhx-back-title">🔢 {game.title || 'Number Path'}</div>
            <div className="lhx-back-sub">Mathematics{game.grade ? ` · Grade ${game.grade}` : ''}</div>
          </div>
        </div>
        <div className="lhx-path-stats">
          <div className="lhx-stat-box"><div className="lhx-stat-num">{p.completed}</div><div className="lhx-stat-lab">LEVELS DONE</div></div>
          <div className="lhx-stat-box"><div className="lhx-stat-num">{p.best}</div><div className="lhx-stat-lab">BEST SCORE</div></div>
          <div className="lhx-stat-box"><div className="lhx-stat-num">⭐ {totalStars(p)}</div><div className="lhx-stat-lab">STARS</div></div>
        </div>
      </div>

      <div className="lhx-path-wrap">
        <svg className="lhx-path-svg" viewBox={`0 0 100 ${PATH_VIEW_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <path
            d={pathD}
            fill="none"
            stroke="#c3c8ef"
            strokeWidth="2.2"
            strokeDasharray="1.5 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {states.map(({ level, state }) => {
          const [x, y] = NODE_POS[level - 1]
          const label =
            state === 'done' ? `Level ${level} done`
            : state === 'current' ? `Start level ${level}`
            : `Level ${level} locked — finish level ${current} first`
          return (
            <button
              key={level}
              type="button"
              className={`lhx-node is-${state}`}
              style={{ left: `${x}%`, top: `${(y / PATH_VIEW_HEIGHT) * 100}%` }}
              aria-label={label}
              disabled={state === 'locked'}
              onClick={state === 'current' ? () => onStart(level) : undefined}
            >
              {state === 'done' ? '⭐' : state === 'current' ? level : '🔒'}
            </button>
          )
        })}
        {states.map(({ level, state }) =>
          state === 'current' ? (
            <div
              key={`bubble-${level}`}
              className="lhx-start-bubble"
              style={{
                left: `${NODE_POS[level - 1][0]}%`,
                top: `${(NODE_POS[level - 1][1] / PATH_VIEW_HEIGHT) * 100}%`,
              }}
              aria-hidden="true"
            >
              START ▸
            </div>
          ) : null,
        )}
        {mascotAt && (
          <div
            className="lhx-path-mascot"
            style={{
              left: `${mascotAt[0] + (mascotAt[0] < 50 ? 18 : -18)}%`,
              top: `${(mascotAt[1] / PATH_VIEW_HEIGHT) * 100}%`,
            }}
            aria-hidden="true"
          >
            <img src={ZED_ART} alt="" style={{ width: 48, height: 64, objectFit: 'contain' }} />
          </div>
        )}
      </div>
    </>
  )
}

/* ── Play screen ───────────────────────────────────────────────── */

function PlayScreen({ level, best, onExit, onEnd }) {
  const timeMax = useMemo(() => levelTimeMax(level), [level])
  const [{ tiles, target }, setBoard] = useState(() => {
    const board = fillTiles(level)
    return { tiles: board, target: newTarget(board, level) }
  })
  const [sel, setSel] = useState([])
  const [score, setScore] = useState(0)
  const [time, setTime] = useState(timeMax)
  const [popped, setPopped] = useState([])
  const [combo, setCombo] = useState({ text: '', show: false })

  // Round tallies that outlive renders but never draw anything.
  const round = useRef({ combo: 1, peakCombo: 1, matches: 0, busts: 0 })
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  // Refs mirroring what the countdown needs at expiry — the interval
  // closure is created once, so it must not read state directly.
  const endedRef = useRef(false)
  const scoreRef = useRef(0)
  useEffect(() => { scoreRef.current = score }, [score])
  const onEndRef = useRef(onEnd)
  useEffect(() => { onEndRef.current = onEnd }, [onEnd])

  useEffect(() => {
    const iv = setInterval(() => {
      setTime((t) => {
        if (t <= 1) {
          clearInterval(iv)
          if (!endedRef.current) {
            endedRef.current = true
            onEndRef.current({
              score: scoreRef.current,
              matches: round.current.matches,
              busts: round.current.busts,
              peakCombo: round.current.peakCombo,
              timeMax,
            })
          }
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [timeMax])

  const tap = (index) => {
    if (endedRef.current) return
    const nextSel = toggleTile(sel, index)
    setSel(nextSel)
    const verdict = judgeSelection(tiles, nextSel, target)
    if (verdict === 'match') {
      const comboNow = round.current.combo
      const gained = matchGain(comboNow)
      round.current.matches += 1
      round.current.peakCombo = Math.max(round.current.peakCombo, comboNow)
      playCorrect()
      setScore((s) => s + gained)
      setPopped(nextSel)
      setCombo({ text: `${comboNow > 1 ? `Combo ×${comboNow}! ` : 'Nice! '}+${gained}`, show: true })
      later(() => setCombo((c) => ({ ...c, show: false })), 700)
      later(() => {
        const fresh = replaceMatched(tiles, nextSel)
        round.current.combo = comboNow + 1
        setBoard({ tiles: fresh, target: newTarget(fresh, level) })
        setSel([])
        setPopped([])
      }, 320)
    } else if (verdict === 'bust') {
      round.current.busts += 1
      playWrong()
      later(() => {
        round.current.combo = 1
        setSel([])
      }, 250)
    }
  }

  const total = sumOf(tiles, sel)

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} time={time} timeMax={timeMax} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">MAKE THIS NUMBER</div>
          <div className="lhx-nt-goal-num">{target}</div>
        </div>
        <div className="lhx-nt-best">Your best: {best}</div>
      </div>
      <div className="lhx-nt-sum" aria-live="polite">
        {sel.length ? <>Your total: <b>{total}</b> / {target}</> : <>Combine tiles to make <b>{target}</b></>}
      </div>
      <div className="lhx-nt-grid">
        {tiles.map((n, i) => (
          <button
            key={i}
            type="button"
            className={`lhx-nt-tile ${sel.includes(i) ? 'is-sel' : ''} ${popped.includes(i) ? 'is-pop' : ''}`}
            onClick={() => tap(i)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className={`lhx-nt-combo ${combo.show ? 'is-show' : ''}`} aria-hidden="true">{combo.text}</div>
    </>
  )
}

/* ── The engine ────────────────────────────────────────────────── */

export default function NumberTargetGame({ game }) {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [screen, setScreen] = useState('path')
  const [progress, setProgress] = useState(() => loadProgress(game?.id))
  const [playingLevel, setPlayingLevel] = useState(1)
  const [finalScore, setFinalScore] = useState(0)
  const { saveResult, newBadges, streakResult, finish, reset } = useGameFinish()

  const start = (level) => {
    reset()
    primeSounds()
    reportGameStart(game)
    setPlayingLevel(level)
    setScreen('play')
  }

  const endRound = (outcome) => {
    setFinalScore(outcome.score)
    const next = applyRound(progress, { level: playingLevel, score: outcome.score })
    setProgress(next)
    saveProgress(game?.id, next)
    playWin()
    setScreen('win')
    // The shared end-of-round plumbing: score save, badges, daily streak.
    finish(roundResult({ game, ...outcome }))
  }

  return (
    <div className="lhx">
      <div className="lhx-page">
        {screen === 'path' && (
          <PathScreen
            game={game}
            progress={progress}
            onBack={() => navigate('/games')}
            onStart={start}
          />
        )}
        {screen === 'play' && (
          <PlayScreen
            key={playingLevel}
            level={playingLevel}
            best={progress.best}
            onExit={() => setScreen('path')}
            onEnd={endRound}
          />
        )}
        {screen === 'win' && (
          <WinScreen
            stars={starsForScore(finalScore)}
            title={`Level ${playingLevel} complete!`}
            sub={
              playingLevel < TOTAL_LEVELS
                ? `You've unlocked Level ${playingLevel + 1}. Keep going!`
                : 'You finished the whole path! 🎉'
            }
            score={finalScore}
            saveNote={buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}
            onContinue={() => setScreen('path')}
          />
        )}
      </div>
      <BadgePop badges={newBadges} />
    </div>
  )
}
